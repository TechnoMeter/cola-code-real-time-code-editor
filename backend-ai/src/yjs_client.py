import asyncio
import websockets
import y_py as Y
import re
import logging
import os  # <-- added for environment variable
from langchain_core.messages import HumanMessage
from .agent import agent_engine

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

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
    """Converts Python string lengths to JavaScript UTF-16 code unit lengths."""
    return len(s.encode('utf-16-le')) // 2

async def process_ai_generation(prompt_text, marker_text, doc, text, websocket, room_id, user_payload):
    try:
        logger.info(f"[AI Worker-{room_id}] Background generation task initiated...")
        result = await agent_engine.ainvoke({"messages": [user_payload]})
        ai_response = str(result["messages"][-1].content)
        
        formatted_response = f"\n{ai_response}\n"

        current_text = str(text)
        py_marker_idx = current_text.find(marker_text)
        
        if py_marker_idx != -1:
            yjs_marker_idx = utf16_len(current_text[:py_marker_idx])
            yjs_marker_len = utf16_len(marker_text)

            # Snapshot the state vector BEFORE making changes
            sv_before = Y.encode_state_vector(doc)

            with doc.begin_transaction() as tx:
                for _ in range(yjs_marker_len):
                    text.delete(tx, yjs_marker_idx)
                text.insert(tx, yjs_marker_idx, formatted_response)
            
            # ATOMIC DELTA: Calculate only the exact changes made above
            delta_update = Y.encode_state_as_update(doc, sv_before)
            
            packet = bytearray([0, 2]) # 0: messageSync, 2: syncUpdate
            packet.extend(encode_varuint(len(delta_update)))
            packet.extend(delta_update)
            
            await websocket.send(packet)
            logger.info(f"[AI Worker-{room_id}] Atomic CRDT delta mutation broadcasted perfectly.")
        else:
            logger.warning(f"[AI Worker-{room_id}] Marker erased by user before generation finished. Aborting.")
    except Exception as e:
        logger.error(f"[AI Worker-{room_id}] Background generation task failed: {e}")

async def listen_and_sync(room_id: str):
    # Use environment variable or default to internal Docker service name
    gateway_url = os.getenv("SYNC_GATEWAY_URL", "ws://backend-sync:3000")
    uri = f"{gateway_url}/{room_id}"
    doc = Y.YDoc()
    text = doc.get_text("monaco-content")
    processing_prompt = False
    retry_count = 0
    max_retries = 5

    logger.info(f"[AI Worker-{room_id}] Connecting to gateway URI: {uri}")

    while retry_count < max_retries:
        try:
            logger.info(f"[AI Worker-{room_id}] Opening socket channel (Attempt {retry_count + 1}/{max_retries})...")
            
            async with websockets.connect(uri) as websocket:
                retry_count = 0 
                
                # Send a syncStep1 message to initiate the Yjs sync protocol
                init_handshake = bytearray([0, 0, 1, 0])  # messageSync, syncStep1, length=1, data=0
                await websocket.send(init_handshake)
                logger.info(f"[AI Worker-{room_id}] Wire handshake dispatched successfully.")

                async for message in websocket:
                    if not isinstance(message, bytes) or len(message) < 2:
                        continue
                    
                    # Exhaustive buffer reading loop
                    try:
                        offset = 0
                        message_length = len(message)
                        
                        while offset < message_length:
                            msg_type, offset = read_varuint(message, offset)
                            
                            if msg_type == 0:  # messageSync
                                sync_msg_type, offset = read_varuint(message, offset)
                                
                                if sync_msg_type == 0: # syncStep1 from server
                                    length, offset = read_varuint(message, offset)
                                    remote_state_vector = message[offset:offset + length]
                                    
                                    # Respond with syncStep2 (our doc is empty, but we send our state)
                                    local_update = Y.encode_state_as_update(doc, bytes(remote_state_vector))
                                    reply = bytearray([0, 1]) # 0: messageSync, 1: syncStep2
                                    reply.extend(encode_varuint(len(local_update)))
                                    reply.extend(local_update)
                                    await websocket.send(reply)
                                    
                                elif sync_msg_type == 1 or sync_msg_type == 2: # syncStep2 or syncUpdate
                                    length, offset = read_varuint(message, offset)
                                    update_data = message[offset:offset + length]
                                    Y.apply_update(doc, bytes(update_data))
                                    
                            elif msg_type == 1:  # messageAwareness (Cursor Tracking) – skip
                                length, offset = read_varuint(message, offset)
                                offset += length
                                
                            elif msg_type == 2 or msg_type == 3: # Auth or Query – skip
                                length, offset = read_varuint(message, offset)
                                offset += length
                                
                            else:
                                break
                    except Exception as e:
                        logger.error(f"[AI Worker-{room_id}] Buffer parse error (skipping malformed tail): {e}")
                        continue

                    # Evaluate AI Prompts only after full buffer sync is completed
                    current_text = str(text)
                    match = re.search(r'/\*\s*@AI\s+(.*?)\s*\*/', current_text, re.DOTALL)
                    
                    if match and not processing_prompt:
                        processing_prompt = True
                        full_match = match.group(0)
                        prompt_text = match.group(1).strip()
                        
                        logger.info(f"[AI Worker-{room_id}] Macro trigger matched! Queueing task for: '{prompt_text}'")
                        
                        py_start_idx = current_text.find(full_match)
                        yjs_start_idx = utf16_len(current_text[:py_start_idx])
                        yjs_match_len = utf16_len(full_match)
                        
                        marker_text = f"/* [AI Copilot generating code for: '{prompt_text[:20]}...'] */\n"
                        
                        # Generate minimal delta for marker swap
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
                        
                        processing_prompt = False

                logger.warning(f"[AI Worker-{room_id}] Connection terminated cleanly by host.")
                retry_count += 1
                await asyncio.sleep(2)

        except (websockets.exceptions.ConnectionClosed, OSError) as e:
            retry_count += 1
            logger.error(f"[AI Worker-{room_id}] Underlying network pipeline dropped exception: {e}")
            await asyncio.sleep(2)
            
    logger.error(f"[AI Worker-{room_id}] Execution threshold exhausted. Shutting down worker thread.")