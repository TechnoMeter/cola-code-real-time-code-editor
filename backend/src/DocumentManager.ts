import { Doc, encodeStateAsUpdate, applyUpdate } from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Pool } from 'pg';
import { RedisPubSub } from './RedisPubSub';

export class DocumentManager {
  private rooms = new Map<string, RoomState>();
  private pgPool: Pool;
  private redis: RedisPubSub;
  private flushDelay = 5000; // milliseconds

  constructor(pgPool: Pool, redis: RedisPubSub) {
    this.pgPool = pgPool;
    this.redis = redis;
  }

  // Get or create a document for a room, optionally loading from DB
  async getOrCreateRoom(room: string): Promise<{ doc: Doc; awareness: Awareness }> {
    if (this.rooms.has(room)) {
      const state = this.rooms.get(room)!;
      return { doc: state.doc, awareness: state.awareness };
    }

    // Create new Yjs doc and Awareness instance
    const doc = new Doc();
    const awareness = new Awareness(doc);

    // Try to load existing state from PostgreSQL
    try {
      const result = await this.pgPool.query(
        'SELECT yjs_binary FROM yjs_documents WHERE room_name = $1',
        [room]
      );
      if (result.rows.length > 0) {
        const binary = result.rows[0].yjs_binary;
        if (binary && binary.length > 0) {
          applyUpdate(doc, binary);
          console.log(`[DocManager] Loaded existing state for room: ${room}`);
        }
      }
    } catch (err) {
      console.error(`[DocManager] DB load error for room ${room}:`, err);
      // Continue with empty doc
    }

    const roomState: RoomState = {
      doc,
      awareness,
      clients: new Set(),
      flushTimer: null,
    };
    this.rooms.set(room, roomState);
    return { doc, awareness };
  }

  // Add a WebSocket client to a room
  addClient(room: string, ws: WebSocket): void {
    const roomState = this.rooms.get(room);
    if (!roomState) {
      throw new Error(`Room ${room} not initialized`);
    }

    // Cancel any pending flush for this room
    if (roomState.flushTimer) {
      clearTimeout(roomState.flushTimer);
      roomState.flushTimer = null;
      console.log(`[DocManager] Canceled flush for room: ${room}`);
    }

    roomState.clients.add(ws);

    // Subscribe to Redis channel if this is the first client
    if (roomState.clients.size === 1) {
      this.redis.subscribe(room, (channel, message) => {
        // Broadcast Redis message to all local clients
        for (const client of roomState.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        }
      });
    }
  }

  // Remove a client; if room becomes empty, schedule flush
  removeClient(room: string, ws: WebSocket): void {
    const roomState = this.rooms.get(room);
    if (!roomState) return;

    roomState.clients.delete(ws);

    if (roomState.clients.size === 0) {
      // Room is empty – schedule flush after delay
      console.log(`[DocManager] Room ${room} empty, scheduling flush in ${this.flushDelay}ms`);
      if (roomState.flushTimer) clearTimeout(roomState.flushTimer);
      roomState.flushTimer = setTimeout(() => {
        this.flushRoom(room);
        // Unsubscribe from Redis after flush
        this.redis.unsubscribe(room);
        // Remove from map after flush
        this.rooms.delete(room);
      }, this.flushDelay);
    }
  }

  // Flush the current Yjs document state to PostgreSQL
  private async flushRoom(room: string): Promise<void> {
    const roomState = this.rooms.get(room);
    if (!roomState) return;

    const { doc } = roomState;
    try {
      const binaryState = encodeStateAsUpdate(doc);
      await this.pgPool.query(
        `INSERT INTO yjs_documents (room_name, yjs_binary, last_updated)
         VALUES ($1, $2, NOW())
         ON CONFLICT (room_name) 
         DO UPDATE SET yjs_binary = EXCLUDED.yjs_binary, last_updated = NOW()`,
        [room, binaryState]
      );
      console.log(`[DocManager] Flushed room ${room} to DB (${binaryState.length} bytes)`);
    } catch (err) {
      console.error(`[DocManager] Failed to flush room ${room}:`, err);
    }
  }

  // Apply a Yjs update to the local document and broadcast to Redis
  applyUpdate(room: string, update: Buffer, senderWs: WebSocket): void {
    const roomState = this.rooms.get(room);
    if (!roomState) return;

    const { doc, clients } = roomState;
    try {
      applyUpdate(doc, update);
    } catch (err) {
      console.error(`[DocManager] Error applying update to room ${room}:`, err);
      return;
    }

    // Broadcast to all other local clients
    for (const client of clients) {
      if (client !== senderWs && client.readyState === WebSocket.OPEN) {
        client.send(update);
      }
    }

    // Broadcast to other Node instances via Redis
    this.redis.publish(room, update).catch(err => console.error('Redis publish error:', err));
  }

  // Broadcast awareness message to all local clients and Redis
  broadcastAwareness(room: string, message: Buffer, senderWs: WebSocket): void {
    const roomState = this.rooms.get(room);
    if (!roomState) return;

    // Broadcast locally
    for (const client of roomState.clients) {
      if (client !== senderWs && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
    // Broadcast via Redis (awareness messages are sent as binary with type 1)
    this.redis.publish(room, message).catch(err => console.error('Redis publish error:', err));
  }
}