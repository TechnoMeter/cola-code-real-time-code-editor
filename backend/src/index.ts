import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { Awareness } from 'y-protocols/awareness';

const PORT = 1234;
const rooms = new Map();

function getRoom(roomName: string) {
  if (!rooms.has(roomName)) {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    rooms.set(roomName, { doc, awareness, clients: new Set() });
  }
  return rooms.get(roomName);
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[Gateway] Listening on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  const roomName = (req.url || '/').slice(1) || 'default';
  console.log(`[${roomName}] New client connected`);

  const { doc, awareness, clients } = getRoom(roomName);
  clients.add(ws);

  // Send initial sync step2 (full document)
  const initEncoder = encoding.createEncoder();
  encoding.writeVarUint(initEncoder, 0); // message type: SYNC
  syncProtocol.writeSyncStep2(initEncoder, doc);
  ws.send(encoding.toUint8Array(initEncoder));

  ws.on('message', (data: Buffer) => {
    try {
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === 0) {
        // SYNC message – create an encoder for the reply
        const replyEncoder = encoding.createEncoder();
        // Pass the encoder to readSyncMessage; it will write a reply if needed
        const syncMsgType = syncProtocol.readSyncMessage(decoder, replyEncoder, doc, awareness);

        // If the client requested a step1 sync, send the step2 reply we just wrote
        if (syncMsgType === syncProtocol.messageYjsSyncStep1) {
          // The replyEncoder now contains the step2 message; we need to prefix it with the message type (0)
          const replyBuffer = encoding.toUint8Array(replyEncoder);
          if (replyBuffer.length > 0) {
            // The replyEncoder already contains the sync message data, but we need to prepend the message type byte.
            // However, the encoder already writes the sync data without the message type.
            // We need to send a message with type=0 and then the sync payload.
            const fullReply = Buffer.concat([Buffer.from([0]), Buffer.from(replyBuffer)]);
            ws.send(fullReply);
          }
        }

        // Broadcast the original message to all other clients in this room
        for (const client of clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        }
      } else if (messageType === 1) {
        // AWARENESS – forward to all other clients
        for (const client of clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        }
      } else {
        console.warn(`[${roomName}] Unknown message type: ${messageType}`);
      }
    } catch (err) {
      console.error(`[${roomName}] Error processing message:`, err);
      ws.close(1011, 'Invalid message');
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[${roomName}] Client disconnected, ${clients.size} remaining`);
    if (clients.size === 0) {
      console.log(`[${roomName}] Room empty – you can add DB flush here later.`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${roomName}] WebSocket error:`, err);
  });
});