import * as Y from 'yjs';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const ROOM_ID = 'aaa'; // Change this if you test inside a different room name
const WS_URL = `ws://127.0.0.1:3000/${ROOM_ID}`;

console.log(`[Diagnostic] Initializing headless client for room: ${ROOM_ID}`);

const doc = new Y.Doc();
const text = doc.getText('monaco-content');
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('[Diagnostic] Socket connected. Initiating SyncStep1...');
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync
  syncProtocol.writeSyncStep1(encoder, doc);
  ws.send(encoding.toUint8Array(encoder));
});

ws.on('message', (message: Buffer) => {
  const decoder = decoding.createDecoder(new Uint8Array(message));
  const messageType = decoding.readVarUint(decoder);

  if (messageType === 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
    if (encoding.length(encoder) > 1) {
      ws.send(encoding.toUint8Array(encoder));
    }
  }
});

// Observe the text state and log the mathematical delta changes
text.observe((event) => {
  const delta = event.changes.delta;
  const isFragmented = delta.length > 5;

  console.log('\n--- CRDT DELTA EVENT INTERCEPTED ---');
  console.log(`Delta Array Size: ${delta.length} operations`);
  console.log('Raw Delta:', JSON.stringify(delta, null, 2));

  if (isFragmented) {
    console.error('❌ WARNING: Fragmented delta detected. This will break Monaco cursor mapping.');
  } else {
    console.log('✅ SUCCESS: Clean block delta detected. Cursor anchors will remain stable.');
  }
});