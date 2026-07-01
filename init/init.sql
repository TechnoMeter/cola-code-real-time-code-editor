-- Enable UUID extension (required for UUID generation)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================
-- CORE TABLE: stores the binary Yjs document state (BYTEA)
-- =========================================================================
CREATE TABLE IF NOT EXISTS yjs_documents (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_name     TEXT NOT NULL UNIQUE,          -- unique identifier for the collaboration room
    yjs_binary    BYTEA NOT NULL,                -- binary snapshot/update from Yjs
    last_updated  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_yjs_documents_room_name ON yjs_documents(room_name);

-- =========================================================================
-- OPTIONAL TABLE 1: Document Metadata (title, description, owner, etc.)
-- =========================================================================
CREATE TABLE IF NOT EXISTS document_metadata (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_name     TEXT NOT NULL UNIQUE REFERENCES yjs_documents(room_name) ON DELETE CASCADE,
    title         TEXT,
    description   TEXT,
    owner_id      TEXT,                           -- could be a user ID from auth system
    is_public     BOOLEAN DEFAULT FALSE,
    language      TEXT DEFAULT 'plaintext',       -- e.g., 'javascript', 'python'
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_document_metadata_owner ON document_metadata(owner_id);

-- =========================================================================
-- OPTIONAL TABLE 2: Awareness states (if you want to persist cursor/selection data)
-- Note: Awareness is usually ephemeral, but storing historical data can be useful.
-- =========================================================================
CREATE TABLE IF NOT EXISTS awareness_history (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_name     TEXT NOT NULL REFERENCES yjs_documents(room_name) ON DELETE CASCADE,
    client_id     INTEGER NOT NULL,               -- client ID from Yjs awareness
    user_name     TEXT,
    user_color    TEXT,
    cursor_pos    JSONB,                          -- store cursor position as JSON
    selection     JSONB,                          -- store selection range
    timestamp     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_awareness_history_room ON awareness_history(room_name);
CREATE INDEX idx_awareness_history_timestamp ON awareness_history(timestamp);

-- =========================================================================
-- OPTIONAL TABLE 3: Update log (for auditing / replay / debugging)
-- Stores each incremental update received from clients.
-- =========================================================================
CREATE TABLE IF NOT EXISTS update_log (
    id            BIGSERIAL PRIMARY KEY,
    room_name     TEXT NOT NULL REFERENCES yjs_documents(room_name) ON DELETE CASCADE,
    update_data   BYTEA NOT NULL,                 -- binary update chunk
    sender_id     TEXT,                           -- client ID or user ID
    received_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_update_log_room ON update_log(room_name);
CREATE INDEX idx_update_log_received_at ON update_log(received_at);

-- =========================================================================
-- OPTIONAL TABLE 4: Active rooms / sessions (for monitoring)
-- =========================================================================
CREATE TABLE IF NOT EXISTS active_rooms (
    room_name     TEXT PRIMARY KEY,
    client_count  INTEGER DEFAULT 0,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================================================
-- OPTIONAL TABLE 5: User profiles (if you have an auth system)
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE,
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================================================
-- TRIGGER: Automatically update `updated_at` on metadata changes
-- =========================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_document_metadata_updated_at
BEFORE UPDATE ON document_metadata
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =========================================================================
-- Optional: Add a view for active rooms with document info
-- =========================================================================
CREATE OR REPLACE VIEW active_documents AS
SELECT 
    ar.room_name,
    ar.client_count,
    ar.last_activity,
    dm.title,
    dm.owner_id,
    dm.language,
    EXTRACT(EPOCH FROM (NOW() - ar.last_activity)) AS idle_seconds
FROM active_rooms ar
LEFT JOIN document_metadata dm ON ar.room_name = dm.room_name;