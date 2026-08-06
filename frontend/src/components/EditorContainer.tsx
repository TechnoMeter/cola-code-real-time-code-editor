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
  const bindingRef = useRef<MonacoBinding | null>(null);

  useEffect(() => {
    if (!containerRef.current || !ydoc || !provider) return;

    // Inject dynamic remote cursor styles
    const styleTag = document.createElement('style');
    styleTag.id = 'yjs-native-cursor-styles';
    document.head.appendChild(styleTag);

    // Initialize Monaco with standardized layout
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
      eol: '\n', // Default to LF line endings
      quickSuggestions: { other: true, comments: false, strings: false },
    });
    editorRef.current = editor;

    setTimeout(() => editor.layout(), 50);

    const model = editor.getModel();
    const yText = ydoc.getText('monaco-content');

    if (model) {
      // 1. Enforce LF (\n) on Monaco model
      model.setEOL(monaco.editor.EndOfLineSequence.LF);

      // 2. Intercept raw Android IME / paste input in Monaco BEFORE reaching Yjs
      const contentListener = model.onDidChangeContent((e) => {
        if (e.isFlush) return;
        const val = model.getValue();
        if (val.includes('\r')) {
          model.setValue(val.replace(/\r/g, ''));
        }
      });

      // 3. Connect y-monaco binding
      const binding = new MonacoBinding(
        yText,
        model,
        new Set([editor]),
        provider.awareness
      );
      bindingRef.current = binding;

      // 4. Safe post-sync cleanup: Runs ONLY AFTER y-websocket initial sync finishes
      const handleSynced = (isSynced: boolean) => {
        if (!isSynced) return;
        const str = yText.toString();
        if (str.includes('\r')) {
          ydoc.transact(() => {
            for (let i = str.length - 1; i >= 0; i--) {
              if (str[i] === '\r') {
                yText.delete(i, 1);
              }
            }
          }, 'crlf-post-sync-clean');
        }
      };

      if (provider.synced) {
        handleSynced(true);
      } else {
        provider.once('synced', handleSynced);
      }
    }

    // Dynamic Awareness Cursor Styles
    const handleAwarenessStyleUpdate = () => {
      const styleRules: string[] = [];
      provider.awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === provider.awareness.clientID) return;
        if (!state.user) return;

        const color = state.user.color || '#3b82f6';
        const name = state.user.name || 'Collaborator';

        styleRules.push(`
          .yRemoteSelectionHead-${clientId} {
            border-left: 2px solid ${color} !important;
          }
          .yRemoteSelectionHead-${clientId}::after {
            content: "${name}" !important;
            background-color: ${color} !important;
          }
          .yRemoteSelection-${clientId} {
            background-color: ${color}26 !important;
          }
        `);
      });
      styleTag.innerHTML = styleRules.join('\n');
    };

    provider.awareness.on('change', handleAwarenessStyleUpdate);
    handleAwarenessStyleUpdate();

    return () => {
      provider.awareness.off('change', handleAwarenessStyleUpdate);
      bindingRef.current?.destroy();
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