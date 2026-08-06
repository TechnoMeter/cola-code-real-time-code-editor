import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

interface EditorContainerProps {
  ydoc: Y.Doc | null;
  provider: WebsocketProvider | null;
  theme: 'vs-dark' | 'vs-light';
}

export function EditorContainer({ ydoc, provider, theme }: EditorContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current || !ydoc || !provider) return;

    const styleTag = document.createElement('style');
    styleTag.id = 'yjs-native-cursor-styles';
    document.head.appendChild(styleTag);

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'typescript',
      theme: theme,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontLigatures: false,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollbar: { useShadows: false, verticalHasArrows: false },
      padding: { top: 16 },
      contextmenu: false,
    });
    editorRef.current = editor;

    setTimeout(() => editor.layout(), 50);

    const yText = ydoc.getText('monaco-content');
    const model = editor.getModel();
    let binding: MonacoBinding | null = null;

    if (model) {
      // 1. Force Monaco's internal buffer to strictly use LF (\n)
      // This natively intercepts and normalizes Windows pastes and Android IME inputs.
      model.setEOL(monaco.editor.EndOfLineSequence.LF);

      const initializeBinding = () => {
        const str = yText.toString();
        
        // 2. Safe, ONE-TIME historical cleanup BEFORE y-monaco maps the indices
        if (str.includes('\r')) {
          ydoc.transact(() => {
            for (let i = str.length - 1; i >= 0; i--) {
              if (str[i] === '\r') {
                yText.delete(i, 1);
              }
            }
          }, 'init-crlf-sanitize');
        }

        // 3. Connect the binding only after the CRDT state is perfectly clean
        binding = new MonacoBinding(
          yText,
          model,
          new Set([editor]),
          provider.awareness
        );
      };

      // Ensure we only clean and bind after historical Yjs data is fully downloaded
      if (provider.synced) {
        initializeBinding();
      } else {
        provider.once('synced', initializeBinding);
      }
    }

    const handleAwarenessStyleUpdate = () => {
      const styleRules: string[] = [];
      provider.awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === provider.awareness.clientID) return;
        if (!state.user) return;

        const color = state.user.color || '#3b82f6';
        const name = state.user.name || 'Collaborator';

        styleRules.push(`
          .yRemoteSelectionHead-${clientId} { border-left: 2px solid ${color} !important; }
          .yRemoteSelectionHead-${clientId}::after { content: "${name}" !important; background-color: ${color} !important; }
          .yRemoteSelection-${clientId} { background-color: ${color}26 !important; }
        `);
      });
      styleTag.innerHTML = styleRules.join('\n');
    };

    provider.awareness.on('change', handleAwarenessStyleUpdate);
    handleAwarenessStyleUpdate();

    return () => {
      provider.awareness.off('change', handleAwarenessStyleUpdate);
      if (binding) binding.destroy();
      editor.dispose();
      styleTag.remove();
    };
  }, [ydoc, provider]);

  useEffect(() => {
    if (editorRef.current) {
      monaco.editor.setTheme(theme);
    }
  }, [theme]);

  return <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden shadow-inner" />;
}