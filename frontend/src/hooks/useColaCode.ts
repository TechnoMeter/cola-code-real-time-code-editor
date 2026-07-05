import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

interface UserAwareness {
  clientID: number;
  name: string;
  color: string;
}

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ec4899',
  '#06b6d4', '#8b5cf6', '#f97316', '#a855f7'
];

function getVibrantColor(username: string): string {
  let hash = 5381;
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) + hash) + username.charCodeAt(i);
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}

export function useColaCode(roomId: string, username: string) {
  const [activeUsers, setActiveUsers] = useState<UserAwareness[]>([]);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!roomId || !username) return;

    // Read WebSocket URL from environment (default to localhost for dev)
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

    const docInstance = new Y.Doc();
    const providerInstance = new WebsocketProvider(
      wsUrl,
      roomId,
      docInstance
    );

    const assignedColor = getVibrantColor(username);
    providerInstance.awareness.setLocalStateField('user', {
      name: username,
      color: assignedColor,
    });

    const handleAwarenessChange = () => {
      const states = providerInstance.awareness.getStates();
      const users: UserAwareness[] = [];
      states.forEach((state, clientID) => {
        if (state.user) {
          users.push({
            clientID,
            name: state.user.name,
            color: state.user.color,
          });
        }
      });
      setActiveUsers(users);
    };

    providerInstance.awareness.on('change', handleAwarenessChange);
    setYdoc(docInstance);
    setProvider(providerInstance);

    return () => {
      providerInstance.awareness.off('change', handleAwarenessChange);
      providerInstance.disconnect();
      docInstance.destroy();
      setYdoc(null);
      setProvider(null);
    };
  }, [roomId, username]);

  return { ydoc, provider, activeUsers };
}