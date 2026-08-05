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

def sanitize_doc_line_endings(doc: Y.YDoc, text: Y.YText):
    """
    Strips all \r characters from Y.Text.
    y-monaco requires pure \n (LF) to maintain accurate line/column offsets.
    """
    raw_str = str(text)
    if '\r' in raw_str:
        with doc.begin_transaction() as tx:
            idx = 0
            while idx < len(str(text)):
                if str(text)[idx] == '\r':
                    text.delete(tx, idx)
                else:
                    idx += 1

async def process_ai_generation(prompt_text, marker_text, doc, text, websocket, room_id, user_payload):
    lock = room_locks.setdefault(room_id, asyncio.Lock())
    
    async with lock:
        try:
            logger.info(f"[AI Worker-{room_id}] Requesting LLM completion...")
            
            result = await asyncio.wait_for(
                agent_engine.ainvoke({"messages": [user_payload]}), 
                timeout=30.0
            )
            
            # Enforce strict LF (\n) line endings for y-monaco compatibility
            ai_response = str(result["messages"][-1].content).strip()
            ai_response = ai_response.replace('\r\n', '\n').replace('\r', '')
            formatted_response = f"\n{ai_response}\n"

            sanitize_doc_line_endings(doc, text)
            current_text = str(text)

            safe_prompt = re.escape(prompt_text[:20])
            pattern = r'/\*\s*\[AI Copilot generating code for: \'' + safe_prompt + r'\.\.\.' + r'\'\]\s*\*/[ \t\r\n]*'
            match = re.search(pattern, current_text)

            if match:
                start_idx = match.start()
                match_len = len(match.group(0))

                sv_before = Y.encode_state_vector(doc)
                with doc.begin_transaction() as tx:
                    for _ in range(match_len):
                        text.delete(tx, start_idx)
                    text.insert(tx, start_idx, formatted_response)
                
                delta_update = Y.encode_state_as_update(doc, sv_before)
                packet = bytearray([0, 2])
                packet.extend(encode_varuint(len(delta_update)))
                packet.extend(delta_update)
                
                await websocket.send(packet)
                logger.info(f"[AI Worker-{room_id}] Atomic CRDT update emitted.")
            else:
                logger.warning(f"[AI Worker-{room_id}] Marker text missing during replacement step.")
        except Exception as e:
            logger.error(f"[AI Worker-{room_id}] Generation failed or timed out: {e}. Cleaning up placeholder.")
            sanitize_doc_line_endings(doc, text)
            current_text = str(text)
            
            safe_prompt = re.escape(prompt_text[:20])
            pattern = r'/\*\s*\[AI Copilot generating code for: \'' + safe_prompt + r'\.\.\.' + r'\'\]\s*\*/[ \t\r\n]*'
            match = re.search(pattern, current_text)
                
            if match:
                start_idx = match.start()
                match_len = len(match.group(0))
                sv_before = Y.encode_state_vector(doc)
                
                with doc.begin_transaction() as tx:
                    for _ in range(match_len):
                        text.delete(tx, start_idx)
                    text.insert(tx, start_idx, "\n/* [AI Generation Error] */\n")
                    
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

    while True:
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as websocket:
                backoff_delay = 2 
                
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
                            
                            if msg_type == 0: 
                                sync_msg_type, offset = read_varuint(message, offset)
                                
                                if sync_msg_type == 0:
                                    length, offset = read_varuint(message, offset)
                                    remote_state_vector = message[offset:offset + length]
                                    offset += length
                                    
                                    local_update = Y.encode_state_as_update(doc, bytes(remote_state_vector))
                                    reply = bytearray([0, 1])
                                    reply.extend(encode_varuint(len(local_update)))
                                    reply.extend(local_update)
                                    await websocket.send(reply)
                                    
                                elif sync_msg_type in (1, 2):
                                    length, offset = read_varuint(message, offset)
                                    update_data = message[offset:offset + length]
                                    offset += length
                                    Y.apply_update(doc, bytes(update_data))
                                    
                            elif msg_type in (1, 2, 3):
                                length, offset = read_varuint(message, offset)
                                offset += length
                            else:
                                break
                    except Exception as e:
                        logger.error(f"[AI Worker-{room_id}] Binary parse error: {e}")
                        continue

                    sanitize_doc_line_endings(doc, text)
                    current_text = str(text)
                    match = re.search(r'/\*\s*@AI\s+(.*?)\s*\*/', current_text, re.DOTALL)
                    
                    lock = room_locks.setdefault(room_id, asyncio.Lock())
                    if match and not lock.locked():
                        full_match = match.group(0)
                        prompt_text = match.group(1).strip()
                        
                        start_idx = current_text.find(full_match)
                        match_len = len(full_match)
                        
                        marker_text = f"/* [AI Copilot generating code for: '{prompt_text[:20]}...'] */\n"
                        
                        sv_before = Y.encode_state_vector(doc)
                        with doc.begin_transaction() as tx:
                            for _ in range(match_len):
                                text.delete(tx, start_idx)
                            text.insert(tx, start_idx, marker_text)
                                
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
            backoff_delay = min(backoff_delay * 2, 60)