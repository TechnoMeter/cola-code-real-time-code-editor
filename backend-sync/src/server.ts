import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import * as Y from 'yjs';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import * as sync from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { flushDocumentToDB } from './persistence';

dotenv.config();

const PORT = process.env.PORT || 3000;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const redisPub = new Redis(process.env.REDIS_URL as string);
const redisSub = new Redis(process.env.REDIS_URL as string);

class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Set<WebSocket>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super();
    this.name = name;
    this.conns = new Set();
    this.awareness = new awarenessProtocol.Awareness(this);

    const awarenessHandler = ({ added, updated, removed }: any, origin: any) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // messageAwareness type
      
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
      encoding.writeVarUint8Array(encoder, awarenessUpdate);
      
      const packet = encoding.toUint8Array(encoder);
      this.conns.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(packet);
        }
      });
    };
    this.awareness.on('update', awarenessHandler);
  }
}

const docs = new Map<string, WSSharedDoc>();
const connControlledIds = new Map<WebSocket, Set<number>>();

redisSub.psubscribe('doc-update-*');
redisSub.on('pmessage', (pattern, channel, message) => {
  const docName = channel.replace('doc-update-', '');
  const update = Buffer.from(message, 'base64');
  const doc = docs.get(docName);
  
  if (doc) {
    Y.applyUpdate(doc, update, 'redis-sync');
  }
});

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const docName = url.pathname.slice(1).split('?')[0] || 'default-room';

  let doc = docs.get(docName);
  if (!doc) {
    doc = new WSSharedDoc(docName);
    docs.set(docName, doc);

    // Track client IDs per connection natively using the transaction origin parameters
    doc.awareness.on('update', ({ added, updated }: any, origin: any) => {
      const controlled = connControlledIds.get(origin);
      if (controlled) {
        added.forEach((id: number) => controlled.add(id));
        updated.forEach((id: number) => controlled.add(id));
      }
    });

    doc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'redis-sync') {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        sync.writeUpdate(encoder, update);
        const packet = encoding.toUint8Array(encoder);
        doc!.conns.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(packet);
        });
        return;
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      sync.writeUpdate(encoder, update);
      const packet = encoding.toUint8Array(encoder);
      doc!.conns.forEach((client) => {
        if (client !== origin && client.readyState === WebSocket.OPEN) {
          client.send(packet);
        }
      });

      const payload = Buffer.from(update).toString('base64');
      redisPub.publish(`doc-update-${docName}`, payload);
    });
  }

  doc.conns.add(ws);
  connControlledIds.set(ws, new Set<number>());

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, 0); 
  sync.writeSyncStep1(syncEncoder, doc);
  ws.send(encoding.toUint8Array(syncEncoder));

  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, 1);
    const initialAwareness = awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()));
    encoding.writeVarUint8Array(awarenessEncoder, initialAwareness);
    ws.send(encoding.toUint8Array(awarenessEncoder));
  }

  ws.on('message', (message: Buffer) => {
    if (!doc) return;
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const messageType = decoding.readVarUint(decoder);
    
    if (messageType === 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      sync.readSyncMessage(decoder, encoder, doc, ws);
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
    } else if (messageType === 1) {
      const awarenessUpdate = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(doc.awareness, awarenessUpdate, ws);
    }
  });

  ws.on('close', async () => {
    if (!doc) return;
    doc.conns.delete(ws);
    
    // Instantly evict all client IDs owned by this connection to eliminate session clones
    const controlled = connControlledIds.get(ws);
    if (controlled) {
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlled), 'local-eviction');
      connControlledIds.delete(ws);
    }
    
    if (doc.conns.size === 0) {
      try {
        await flushDocumentToDB(docName, doc);
        doc.destroy();
        docs.delete(docName);
        console.log(`[Sync Gateway] Room evicted from cache: ${docName}`);
      } catch (error) {
        console.error(`[DB Error] Cold storage flush failed for ${docName}:`, error);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Sync Gateway] Active on port ${PORT}`);
});