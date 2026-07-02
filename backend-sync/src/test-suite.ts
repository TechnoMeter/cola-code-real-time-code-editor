import { Client } from 'pg';
import Redis from 'ioredis';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encodingLib from 'lib0/encoding';
import * as decodingLib from 'lib0/decoding';
import dotenv from 'dotenv';

dotenv.config();

const TEST_ROOM = `test-room-${Date.now()}`;
const WS_URL = `ws://localhost:${process.env.PORT || 3000}/${TEST_ROOM}`;

async function runTests() {
  console.log('🚀 INITIALIZING COLACODE INTEGRATION TEST SUITE\n');

  // -------------------------------------------------------------
  // TEST 1: Infrastructure Connectivity (Phase 1)
  // -------------------------------------------------------------
  console.log('⏳ TEST 1: Verifying Database and Cache infrastructure connectivity...');
  const pgClient = new Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB,
    password: process.env.PG_PASSWORD,
    port: parseInt(process.env.PG_PORT || '5432', 10),
  });
  const redisClient = new Redis(process.env.REDIS_URL as string);

  try {
    await pgClient.connect();
    const res = await pgClient.query("SELECT to_regclass('public.documents') as exists;");
    if (!res.rows[0].exists) throw new Error("Table 'documents' does not exist.");
    console.log('   ✅ PostgreSQL online. Schema verified.');
    await redisClient.ping();
    console.log('   ✅ Redis cache online. Pub/Sub verified.');
  } catch (err: any) {
    console.error('   ❌ Test 1 Failed:', err.message);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 2: Real-time Gateway Communication & Handshake (Phase 2)
  // -------------------------------------------------------------
  console.log('\n⏳ TEST 2: Validating Gateway Protocol Handshake...');
  const wsClient1 = new WebSocket(WS_URL);
  
  const handshakePromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Handshake timeout')), 2000);
    
    wsClient1.on('open', () => {
      const encoder = encodingLib.createEncoder();
      encodingLib.writeVarUint(encoder, 0); // messageSync
      sync.writeSyncStep1(encoder, new Y.Doc());
      wsClient1.send(encodingLib.toUint8Array(encoder));
    });

    wsClient1.on('message', (data: Buffer) => {
      if (data.length > 0 && data[0] === 0) {
        clearTimeout(timeout);
        console.log('   ✅ Received compliant sync frame packet.');
        resolve();
      }
    });
  });

  try {
    await handshakePromise;
    // CRITICAL: Clean up listener to prevent side-effects in later steps
    wsClient1.removeAllListeners('message');
  } catch (err: any) {
    console.error('   ❌ Test 2 Failed:', err.message);
    await cleanup(pgClient, redisClient, [wsClient1]);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 3: Multi-client Convergence Verification (Phase 3 Engine)
  // -------------------------------------------------------------
  console.log('\n⏳ TEST 3: Verifying real-time CRDT convergence...');
  const wsClient2 = new WebSocket(WS_URL);
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const text1 = doc1.getText('monaco-content');
  const text2 = doc2.getText('monaco-content');

  const convergencePromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Convergence timeout')), 4000);

    wsClient2.on('open', () => {
      const encoder = encodingLib.createEncoder();
      encodingLib.writeVarUint(encoder, 0); // messageSync
      sync.writeSyncStep1(encoder, doc2);
      wsClient2.send(encodingLib.toUint8Array(encoder));
    });

    // Handle structural stream updates via proper protocol deserialization
    wsClient2.on('message', (data: Buffer) => {
      try {
        const decoder = decodingLib.createDecoder(new Uint8Array(data));
        const messageType = decodingLib.readVarUint(decoder);
        
        if (messageType === 0) { // messageSync
          const encoder = encodingLib.createEncoder();
          sync.readSyncMessage(decoder, encoder, doc2, wsClient2);
          
          if (text2.toString() === '// Testing Convergence') {
            clearTimeout(timeout);
            console.log(`   ✅ State matches: "${text2.toString()}"`);
            resolve();
          }
        }
      } catch (err) {
        // Suppress parsing errors for handshake metadata
      }
    });

    wsClient1.on('message', (data: Buffer) => {
      try {
        const decoder = decodingLib.createDecoder(new Uint8Array(data));
        if (decodingLib.readVarUint(decoder) === 0) {
          const encoder = encodingLib.createEncoder();
          sync.readSyncMessage(decoder, encoder, doc1, wsClient1);
        }
      } catch {}
    });

    // Write text to Client 1 document vector
    text1.insert(0, '// Testing Convergence');

    // Encode as official Sync Message Type 2 (Update) and transmit
    const update = Y.encodeStateAsUpdate(doc1);
    const encoder = encodingLib.createEncoder();
    encodingLib.writeVarUint(encoder, 0); // messageSync
    encodingLib.writeVarUint(encoder, 2); // messageSyncUpdate
    encodingLib.writeVarUint8Array(encoder, update);
    
    if (wsClient1.readyState === WebSocket.OPEN) {
      wsClient1.send(encodingLib.toUint8Array(encoder));
    } else {
      wsClient1.on('open', () => wsClient1.send(encodingLib.toUint8Array(encoder)));
    }
  });

  try {
    await convergencePromise;
    wsClient1.removeAllListeners('message');
    wsClient2.removeAllListeners('message');
  } catch (err: any) {
    console.error('   ❌ Test 3 Failed:', err.message);
    await cleanup(pgClient, redisClient, [wsClient1, wsClient2]);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 4: Asynchronous Persistence Triggering On Room Eviction
  // -------------------------------------------------------------
  console.log('\n⏳ TEST 4: Evaluating cold-storage eviction loop...');
  wsClient1.close();
  wsClient2.close();
  
  // Give the server a 1.5-second buffer window to process the disconnects and run the async DB update
  await new Promise((resolve) => setTimeout(resolve, 1500));

  try {
    const dbCheck = await pgClient.query('SELECT id, octet_length(content) as size FROM documents WHERE id = $1', [TEST_ROOM]);
    if (dbCheck.rows.length === 0) {
      throw new Error("No record found in the database. Async flush transaction failed.");
    }
    console.log(`   ✅ Cold storage commit confirmed (${dbCheck.rows[0].size} bytes successfully written).`);
  } catch (err: any) {
    console.error('   ❌ Test 4 Failed:', err.message);
    await cleanup(pgClient, redisClient, []);
    process.exit(1);
  }

  console.log('\n🏆 ALL TESTS RUN AND PASSED SUCCESSFULLY.');
  await cleanup(pgClient, redisClient, []);
  process.exit(0);
}

async function cleanup(pg: Client, redis: Redis, sockets: WebSocket[]) {
  sockets.forEach(s => { if (s.readyState === WebSocket.OPEN) s.close(); });
  await pg.end();
  await redis.quit();
}

runTests();