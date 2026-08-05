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
  ssl: {
    rejectUnauthorized: false, // Required for Neon cloud PostgreSQL
  },
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

export async function loadDocumentFromDB(docId: string): Promise<Uint8Array | null> {
  const query = `SELECT content FROM documents WHERE id = $1;`;
  const result = await pool.query(query, [docId]);

  if (result.rows.length === 0 || !result.rows[0].content) {
    return null;
  }

  return new Uint8Array(result.rows[0].content);
}