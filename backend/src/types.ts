import { Doc } from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export interface RoomState {
  doc: Doc;
  awareness: Awareness;
  clients: Set<WebSocket>;
  flushTimer?: NodeJS.Timeout | null;
}

export interface AwarenessUpdate {
  room: string;
  clientId: number;
  awareness: any;
}

export interface SyncMessage {
  type: 'sync' | 'awareness' | 'queryAwareness';
  payload: Buffer;
}