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

    // Create a dynamic style element to house client-specific styles
    const styleTag = document.createElement('style');
    styleTag.id = 'yjs-native-cursor-styles';
    document.head.appendChild(styleTag);

    // Initialize Monaco using a standardized layout setup
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
      eol: '\n', // Set default editor newline behavior
    });
    editorRef.current = editor;

    // Force an immediate layout bounds recalculation
    setTimeout(() => editor.layout(), 50);

    const model = editor.getModel();
    const yText = ydoc.getText('monaco-content');

    // Real-Time CRDT Guard: Intercepts mobile IME / paste events and purges \r in real-time
    const sanitizeCRLF = () => {
      const str = yText.toString();
      if (str.includes('\r')) {
        ydoc.transact(() => {
          // Iterate backwards to safely delete \r without index shifting
          for (let i = str.length - 1; i >= 0; i--) {
            if (str[i] === '\r') {
              yText.delete(i, 1);
            }
          }
        }, 'sanitize-crlf');
      }
    };

    // Run initial purge and attach real-time observer to yText
    sanitizeCRLF();
    yText.observe(sanitizeCRLF);

    if (model) {
      // Force Monaco to use pure LF (\n) on ALL operating systems
      model.setEOL(monaco.editor.EndOfLineSequence.LF);

      // Connect text sync and awareness vectors using native y-monaco bindings
      const binding = new MonacoBinding(
        yText,
        model,
        new Set([editor]),
        provider.awareness
      );
      bindingRef.current = binding;
    }

    // Generate style overrides matching the client IDs managed by y-monaco
    const handleAwarenessStyleUpdate = () => {
      const styleRules: string[] = [];
      provider.awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === provider.awareness.clientID) return; // Ignore local client instance
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
      yText.unobserve(sanitizeCRLF);
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