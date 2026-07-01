import React, { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import * as monaco from 'monaco-editor';
import './y-monaco.css';

interface EditorProps {
  room: string;
  username: string;
}

// Generate a distinct hex color for each user
function getColorForUser(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  // Use a fixed saturation and lightness that work well on dark backgrounds
  return `hsl(${hue}, 80%, 65%)`;
}

const Editor: React.FC<EditorProps> = ({ room, username }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const userColor = getColorForUser(username);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Yjs document
    const doc = new Y.Doc();

    // 2. WebSocket provider
    const provider = new WebsocketProvider('ws://localhost:1234', room, doc);

    // 3. Awareness
    const awareness = provider.awareness;
    awareness.setLocalState({
      user: {
        name: username,
        color: userColor,
      },
    });

    // Debug: log awareness changes
    awareness.on('change', () => {
      console.log('Awareness states:', awareness.getStates());
    });

    // 4. Monaco editor
    const editorInstance = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true,
    });

    // 5. Yjs ↔ Monaco binding
    const binding = new MonacoBinding(
      doc.getText('monaco'),
      editorInstance.getModel()!,
      new Set([editorInstance]),
      awareness
    );

    // ---- Force cursor colors after a short delay (fallback) ----
    // This sets the inline border-color if the binding didn't.
    const applyColors = () => {
      const heads = document.querySelectorAll('.yRemoteSelectionHead');
      heads.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const clientId = htmlEl.dataset.clientId;
        if (clientId) {
          const state = awareness.getStates().get(parseInt(clientId, 10));
          if (state?.user?.color && !htmlEl.style.borderColor) {
            htmlEl.style.borderColor = state.user.color;
          }
        }
      });
    };

    // Run after a short delay to let the binding create elements
    const timeoutId = setTimeout(applyColors, 100);

    // Also watch for new elements (new users joining) with MutationObserver
    const observer = new MutationObserver(() => {
      applyColors();
    });
    observer.observe(containerRef.current, { childList: true, subtree: true });

    // Cleanup
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
      binding.destroy();
      provider.destroy();
      doc.destroy();
      editorInstance.dispose();
    };
  }, [room, username, userColor]);

  return <div ref={containerRef} className="w-full h-full" />;
};

export default Editor;