import React, { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import * as monaco from 'monaco-editor';
import { editor } from 'monaco-editor';

interface EditorProps {
  room: string;
  username: string;
}

// Generate a random color for each user
function getColorForUser(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 80%, 60%)`;
}

const Editor: React.FC<EditorProps> = ({ room, username }) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Create Yjs document
    const doc = new Y.Doc();
    docRef.current = doc;

    // 2. Create WebSocket provider
    // Use the WebSocket URL with room parameter
    const provider = new WebsocketProvider('ws://localhost:1234', room, doc);
    providerRef.current = provider;

    // 3. Set up awareness
    const awareness = provider.awareness;
    awareness.setLocalState({
      user: {
        name: username,
        color: getColorForUser(username),
      },
    });

    // 4. Create Monaco editor instance
    const editorInstance = monaco.editor.create(document.getElementById('editor-container')!, {
      value: '',
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true,
    });
    editorRef.current = editorInstance;

    // 5. Bind Monaco to Yjs
    const monacoBinding = new MonacoBinding(
      doc.getText('monaco'), // the shared text type
      editorInstance.getModel()!,
      new Set([editorInstance]), // editor instances to sync
      awareness
    );

    // 6. Cleanup
    return () => {
      monacoBinding.destroy();
      provider.destroy();
      doc.destroy();
      editorInstance.dispose();
    };
  }, [room, username]);

  return <div id="editor-container" ref={containerRef} className="w-full h-full" />;
};

export default Editor;