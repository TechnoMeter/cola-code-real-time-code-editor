import { Pool } from 'pg';
import * as Y from 'yjs';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DB,
  password: process.env.PG_PASSWORD,
  port: parseInt(process.env.PG_PORT || '5432', 10),
});

export async function flushDocumentToDB(docId: string, ydoc: Y.Doc): Promise<void> {
  const stateVector = Y.encodeStateAsUpdate(ydoc);
  const buffer = Buffer.from(stateVector);

  const query = `
    INSERT INTO documents (id, content, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (id) DO UPDATE
    SET content = EXCLUDED.content, updated_at = NOW();
  `;
  
  await pool.query(query, [docId, buffer]);
  console.log(`[PG] Flushed document ${docId} (${buffer.byteLength} bytes)`);
}