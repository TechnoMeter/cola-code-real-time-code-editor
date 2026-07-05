import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// Increase max listeners to avoid warning
process.setMaxListeners(20);

const WS_URL = process.env.SYNC_GATEWAY_URL || 'ws://localhost:3000';
const ROOM = `load-test-${Date.now()}`;
const CLIENT_COUNT = 20;
const OPERATIONS = 5;

async function runLoadTest() {
  console.log(`🚀 Local load test: ${CLIENT_COUNT} clients, ${OPERATIONS} ops each`);
  console.log(`📡 Target: ${WS_URL}/${ROOM}`);

  const docs: Y.Doc[] = [];
  const providers: WebsocketProvider[] = [];
  let connectedCount = 0;
  const startTime = performance.now();
  let converged = false;

  return new Promise<void>((resolve) => {
    for (let i = 0; i < CLIENT_COUNT; i++) {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(WS_URL, ROOM, doc);

      docs.push(doc);
      providers.push(provider);

      provider.on('sync', () => {
        connectedCount++;
        const text = doc.getText('monaco-content');
        for (let j = 0; j < OPERATIONS; j++) {
          text.insert(0, `C${i}-Op${j} `);
        }

        if (connectedCount === CLIENT_COUNT) {
          console.log(`✅ All clients connected and wrote data. Polling for convergence...`);

          const checkInterval = setInterval(() => {
            if (converged) return;

            const firstContent = docs[0].getText('monaco-content').toString();
            let allMatch = true;
            for (let k = 1; k < docs.length; k++) {
              if (docs[k].getText('monaco-content').toString() !== firstContent) {
                allMatch = false;
                break;
              }
            }

            if (allMatch) {
              converged = true;
              clearInterval(checkInterval);
              const endTime = performance.now();
              const totalTime = endTime - startTime;
              console.log(`✅ All clients converged!`);
              console.log(`⏱️ Time to convergence: ${totalTime.toFixed(2)}ms`);
              console.log(`📊 Total operations: ${CLIENT_COUNT * OPERATIONS}`);

              // Cleanup
              providers.forEach(p => p.disconnect());
              docs.forEach(d => d.destroy());

              // Resolve the promise
              resolve();
            }
          }, 50);
        }
      });

      provider.on('status', (event: { status: string }) => {
        if (event.status === 'disconnected') {
          console.warn(`⚠️ Client ${i} disconnected`);
        }
      });
    }
  });
}

// Run and exit cleanly
runLoadTest()
  .then(() => {
    console.log('✅ Test completed. Exiting.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });