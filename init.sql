-- init.sql
-- Executed automatically by the Postgres container on first boot.

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,
    -- Yjs document state vectors are encoded as binary Uint8Arrays.
    -- BYTEA is the optimal PostgreSQL type for this.
    document_state BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookup by updated_at (useful for cleanup or periodic jobs)
CREATE INDEX idx_documents_updated_at ON documents(updated_at);

-- Trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();