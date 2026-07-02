import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

interface UserAwareness {
  clientID: number;
  name: string;
  color: string;
}

// Expanded vivid palette to differentiate collaborative developers
const PALETTE = [
  '#3b82f6', // Electric Blue
  '#10b981', // Emerald Green
  '#f59e0b', // Vivid Amber
  '#ec4899', // Deep Pink
  '#06b6d4', // Bright Cyan
  '#8b5cf6', // Purple
  '#f97316', // Orange
  '#a855f7'  // Violet
];

// DJB2 String Hashing implementation to eliminate color mapping collisions
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

    const docInstance = new Y.Doc();
    const providerInstance = new WebsocketProvider(
      'ws://localhost:3000',
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