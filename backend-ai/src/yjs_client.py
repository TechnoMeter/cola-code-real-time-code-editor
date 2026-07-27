import asyncio
import websockets
import y_py as Y
import re
import logging
import os
from langchain_core.messages import HumanMessage
from .agent import agent_engine

logger = logging.getLogger(__name__)

# Active locks to enforce single concurrent AI generation per room
room_locks = {}

def read_varuint(data: bytes, offset: int) -> tuple[int, int]:
    val = 0
    shift = 0
    while True:
        if offset >= len(data):
            raise IndexError("Buffer overrun while reading varuint")
        byte = data[offset]
        offset += 1
        val |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            break
        shift += 7
    return val, offset

def encode_varuint(val: int) -> bytearray:
    buf = bytearray()
    while val > 127:
        buf.append((val & 0x7F) | 0x80)
        val >>= 7
    buf.append(val & 0x7F)
    return buf

def utf16_len(s: str) -> int:
    return len(s.encode('utf-16-le')) // 2

async def process_ai_generation(prompt_text, marker_text, doc, text, websocket, room_id, user_payload):
    lock = room_locks.setdefault(room_id, asyncio.Lock())
    
    async with lock:
        try:
            logger.info(f"[AI Worker-{room_id}] Requesting LLM completion...")
            
            # Enforce 30 second global timeout for AI generation
            result = await asyncio.wait_for(
                agent_engine.ainvoke({"messages": [user_payload]}), 
                timeout=30.0
            )
            ai_response = str(result["messages"][-1].content)
            formatted_response = f"\n{ai_response}\n"

            current_text = str(text)
            py_marker_idx = current_text.find(marker_text)
            
            if py_marker_idx != -1:
                yjs_marker_idx = utf16_len(current_text[:py_marker_idx])
                yjs_marker_len = utf16_len(marker_text)

                sv_before = Y.encode_state_vector(doc)
                with doc.begin_transaction() as tx:
                    for _ in range(yjs_marker_len):
                        text.delete(tx, yjs_marker_idx)
                    text.insert(tx, yjs_marker_idx, formatted_response)
                
                delta_update = Y.encode_state_as_update(doc, sv_before)
                packet = bytearray([0, 2])
                packet.extend(encode_varuint(len(delta_update)))
                packet.extend(delta_update)
                
                await websocket.send(packet)
                logger.info(f"[AI Worker-{room_id}] Atomic CRDT update emitted.")
        except Exception as e:
            logger.error(f"[AI Worker-{room_id}] Generation failed or timed out: {e}. Cleaning up placeholder.")
            # Ensure loading marker is deleted if generation fails
            current_text = str(text)
            py_marker_idx = current_text.find(marker_text)
            if py_marker_idx != -1:
                yjs_marker_idx = utf16_len(current_text[:py_marker_idx])
                yjs_marker_len = utf16_len(marker_text)
                sv_before = Y.encode_state_vector(doc)
                
                with doc.begin_transaction() as tx:
                    for _ in range(yjs_marker_len):
                        text.delete(tx, yjs_marker_idx)
                    text.insert(tx, yjs_marker_idx, f"\n/* [AI Generation Error: {str(e)[:50]}] */\n")
                    
                delta_update = Y.encode_state_as_update(doc, sv_before)
                packet = bytearray([0, 2])
                packet.extend(encode_varuint(len(delta_update)))
                packet.extend(delta_update)
                await websocket.send(packet)

async def listen_and_sync(room_id: str):
    gateway_url = os.getenv("SYNC_GATEWAY_URL", "ws://backend-sync:3000")
    uri = f"{gateway_url}/{room_id}"
    doc = Y.YDoc()
    text = doc.get_text("monaco-content")
    backoff_delay = 2

    logger.info(f"[AI Worker-{room_id}] Initializing socket channel to {uri}")

    while True:  # Infinite resilient worker loop
        try:
            # Enable ping/pong keep-alive frames
            async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as websocket:
                backoff_delay = 2  # Reset delay on successful connection
                
                init_handshake = bytearray([0, 0, 1, 0])
                await websocket.send(init_handshake)

                async for message in websocket:
                    if not isinstance(message, bytes) or len(message) < 2:
                        continue
                    
                    try:
                        offset = 0
                        message_length = len(message)
                        
                        while offset < message_length:
                            msg_type, offset = read_varuint(message, offset)
                            
                            if msg_type == 0:  # messageSync
                                sync_msg_type, offset = read_varuint(message, offset)
                                
                                if sync_msg_type == 0:
                                    length, offset = read_varuint(message, offset)
                                    remote_state_vector = message[offset:offset + length]
                                    local_update = Y.encode_state_as_update(doc, bytes(remote_state_vector))
                                    reply = bytearray([0, 1])
                                    reply.extend(encode_varuint(len(local_update)))
                                    reply.extend(local_update)
                                    await websocket.send(reply)
                                    
                                elif sync_msg_type in (1, 2):
                                    length, offset = read_varuint(message, offset)
                                    update_data = message[offset:offset + length]
                                    Y.apply_update(doc, bytes(update_data))
                                    
                            elif msg_type in (1, 2, 3):  # awareness / auth / query
                                length, offset = read_varuint(message, offset)
                                offset += length
                            else:
                                break
                    except Exception as e:
                        logger.error(f"[AI Worker-{room_id}] Binary parse error: {e}")
                        continue

                    current_text = str(text)
                    match = re.search(r'/\*\s*@AI\s+(.*?)\s*\*/', current_text, re.DOTALL)
                    
                    lock = room_locks.setdefault(room_id, asyncio.Lock())
                    if match and not lock.locked():
                        full_match = match.group(0)
                        prompt_text = match.group(1).strip()
                        
                        py_start_idx = current_text.find(full_match)
                        yjs_start_idx = utf16_len(current_text[:py_start_idx])
                        yjs_match_len = utf16_len(full_match)
                        
                        marker_text = f"/* [AI Copilot generating code for: '{prompt_text[:20]}...'] */\n"
                        
                        sv_before = Y.encode_state_vector(doc)
                        with doc.begin_transaction() as tx:
                            for _ in range(yjs_match_len):
                                text.delete(tx, yjs_start_idx)
                            text.insert(tx, yjs_start_idx, marker_text)
                                
                        delta_update = Y.encode_state_as_update(doc, sv_before)
                        packet = bytearray([0, 2])
                        packet.extend(encode_varuint(len(delta_update)))
                        packet.extend(delta_update)
                        await websocket.send(packet)
                        
                        user_payload = HumanMessage(
                            content=f"Surrounding Workspace Code Context:\n{current_text}\n\nUser Instruction: {prompt_text}"
                        )
                        
                        asyncio.create_task(
                            process_ai_generation(prompt_text, marker_text, doc, text, websocket, room_id, user_payload)
                        )

        except asyncio.CancelledError:
            logger.info(f"[AI Worker-{room_id}] Worker teardown requested.")
            break
        except Exception as e:
            logger.error(f"[AI Worker-{room_id}] WebSocket pipeline error: {e}. Retrying in {backoff_delay}s...")
            await asyncio.sleep(backoff_delay)
            backoff_delay = min(backoff_delay * 2, 60)  # Exponential backoff capped at 60s