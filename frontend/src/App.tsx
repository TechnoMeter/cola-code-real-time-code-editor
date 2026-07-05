import React, { useState, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import {
  Sun, Moon, Terminal, Users, LogOut, ArrowRight, Menu, X,
  Download, HelpCircle, Play, ChevronDown, Loader2,
  Sparkles, Code2, Zap, BookOpen, User
} from 'lucide-react';

// --- Type Declarations ---
declare global {
  interface Window {
    loadPyodide: any;
    pyodide: any;
    initSqlJs: any;
    SQL: any;
  }
}

interface UserAwareness {
  clientID: number;
  name: string;
  color: string;
}

// --- Constants & Utilities ---
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ec4899',
  '#06b6d4', '#8b5cf6', '#f97316', '#a855f7'
];

function getVibrantColor(username: string): string {
  let hash = 5381;
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) + hash) + username.charCodeAt(i);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function CodeCoreLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 22L2 16L6 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M26 10L30 16L26 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 7L13 25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M12 13H15M12 17H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// --- Custom Hooks ---
function useColaCode(roomId: string, username: string) {
  const [activeUsers, setActiveUsers] = useState<UserAwareness[]>([]);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!roomId || !username) return;

    // Use environment variable or default to local sync gateway
    const wsUrl = import.meta.env?.VITE_WS_URL || 'ws://localhost:3000';

    const docInstance = new Y.Doc();
    const providerInstance = new WebsocketProvider(wsUrl, roomId, docInstance);

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

// --- Components ---
interface EditorContainerProps {
  ydoc: Y.Doc | null;
  provider: WebsocketProvider | null;
  theme: 'vs-dark' | 'vs-light';
}

function EditorContainer({ ydoc, provider, theme }: EditorContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current || !ydoc || !provider) return;

    // Inject Yjs Native Cursor Styles dynamically
    const styleTag = document.createElement('style');
    styleTag.id = 'yjs-native-cursor-styles';
    document.head.appendChild(styleTag);

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'typescript',
      theme: theme,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontLigatures: true,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollbar: { useShadows: false, verticalHasArrows: false },
      padding: { top: 16 },
      contextmenu: false,
      roundedSelection: false,
    });
    editorRef.current = editor;

    setTimeout(() => editor.layout(), 50);
    const yText = ydoc.getText('monaco-content');
    
    const binding = new MonacoBinding(
      yText,
      editor.getModel()!,
      new Set([editor]),
      provider.awareness
    );

    const handleAwarenessStyleUpdate = () => {
      const styleRules: string[] = [];
      provider.awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === provider.awareness.clientID) return;
        if (!state.user) return;

        const color = state.user.color || '#3b82f6';
        const name = state.user.name || 'User';

        styleRules.push(`
          .yRemoteSelectionHead-${clientId} {
            position: absolute;
            border-left: 2px solid ${color} !important;
            height: 100%;
            box-sizing: border-box;
            z-index: 50;
            transition: all 0.1s ease;
          }
          .yRemoteSelectionHead-${clientId}::after {
            content: "${name}";
            position: absolute;
            top: -18px;
            left: -2px;
            background-color: ${color};
            color: #fff;
            font-size: 10px;
            font-weight: 600;
            font-family: system-ui, sans-serif;
            padding: 2px 6px;
            border-radius: 4px 4px 4px 0;
            white-space: nowrap;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            pointer-events: none;
          }
          .yRemoteSelection-${clientId} {
            background-color: ${color}33 !important;
          }
        `);
      });
      styleTag.innerHTML = styleRules.join('\n');
    };

    provider.awareness.on('change', handleAwarenessStyleUpdate);
    handleAwarenessStyleUpdate();

    return () => {
      provider.awareness.off('change', handleAwarenessStyleUpdate);
      binding.destroy();
      editor.dispose();
      styleTag.remove();
    };
  }, [ydoc, provider]);

  useEffect(() => {
    if (editorRef.current) monaco.editor.setTheme(theme);
  }, [theme]);

  // Make the container transparent so Monaco's base colors look solid against the glass UI
  return <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden bg-transparent" />;
}

// --- Ambient Background Component for Aero Glassmorphism ---
function AmbientBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-slate-950 dark:to-slate-900">
      <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/30 dark:bg-blue-600/20 blur-[120px]"></div>
      <div className="absolute top-[20%] -right-[10%] w-[40%] h-[40%] rounded-full bg-cyan-400/30 dark:bg-cyan-500/20 blur-[120px]"></div>
      <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[60%] rounded-full bg-indigo-400/20 dark:bg-indigo-600/20 blur-[120px]"></div>
    </div>
  );
}

// --- Main Application ---
export default function App() {
  const [theme, setTheme] = useState<'vs-dark' | 'vs-light'>('vs-dark');
  const [sessionRoom, setSessionRoom] = useState('');
  const [sessionUser, setSessionUser] = useState('');
  
  const [activeRoom, setActiveRoom] = useState('');
  const [activeUser, setActiveUser] = useState('');
  
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Execution State
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [outputLogs, setOutputLogs] = useState<string[]>([]);
  const [sqlTableData, setSqlTableData] = useState<any[] | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [language, setLanguage] = useState('javascript');
  const [pyodideReady, setPyodideReady] = useState(false);
  const [sqlJsReady, setSqlJsReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const { ydoc, provider, activeUsers } = useColaCode(activeRoom, activeUser);

  // Load Runtimes
  useEffect(() => {
    const loadRuntimes = async () => {
      if (typeof window.loadPyodide !== 'undefined' && !window.pyodide) {
        setLoadingMessage('Loading Python runtime...');
        try {
          window.pyodide = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.1/full/' });
          setPyodideReady(true);
        } catch (e) {
          console.error('Pyodide load failed', e);
        }
      }
      if (typeof window.initSqlJs !== 'undefined' && !window.SQL) {
        setLoadingMessage('Loading SQL runtime...');
        try {
          window.SQL = await window.initSqlJs({ locateFile: (file: string) => `https://sql.js.org/dist/${file}` });
          setSqlJsReady(true);
        } catch (e) {
          console.error('SQL.js load failed', e);
        }
      }
      setLoadingMessage('');
    };
    loadRuntimes();
  }, []);

  // Theme Sync
  useEffect(() => {
    if (theme === 'vs-dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  // Handlers
  const handleJoinSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (sessionRoom.trim() && sessionUser.trim()) {
      setActiveRoom(sessionRoom.trim().toLowerCase());
      setActiveUser(sessionUser.trim());
      setShowGuide(true); // Automatically show Readme on enter
    }
  };

  const handleLeaveSession = () => {
    setActiveRoom('');
    setActiveUser('');
    setIsMobileSidebarOpen(false);
    setIsTerminalOpen(false);
    setOutputLogs([]);
    setSqlTableData(null);
  };

  const handleExportCode = () => {
    if (!ydoc) return;
    const text = ydoc.getText('monaco-content').toString();
    const extensions: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', sql: 'sql' };
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeRoom}-workspace.${extensions[language] || 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Execution Logic
  const runJavaScript = (code: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const workerBlob = new Blob([`
        self.onmessage = function(e) {
          const code = e.data;
          let output = '';
          const originalLog = console.log;
          console.log = function(...args) {
            output += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\\n';
          };
          try {
            const result = new Function(code)();
            if (result !== undefined) output += String(result) + '\\n';
            self.postMessage({ type: 'success', output });
          } catch (err) {
            self.postMessage({ type: 'error', error: err.message || String(err) });
          } finally { console.log = originalLog; }
        };
      `], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerUrl);
      worker.onmessage = (e) => {
        e.data.type === 'success' ? resolve(e.data.output) : reject(new Error(e.data.error));
        worker.terminate(); URL.revokeObjectURL(workerUrl);
      };
      worker.onerror = (err) => {
        reject(new Error(err.message));
        worker.terminate(); URL.revokeObjectURL(workerUrl);
      };
      worker.postMessage(code);
    });
  };

  const runPython = async (code: string): Promise<string> => {
    if (!window.pyodide) throw new Error('Python runtime not loaded');
    window.pyodide.runPython(`import sys\nfrom io import StringIO\nsys.stdout = StringIO()`);
    try {
      await window.pyodide.runPythonAsync(code);
      return window.pyodide.runPython('sys.stdout.getvalue()');
    } catch (err: any) { throw new Error(err.message); }
  };

  const runSQL = (code: string): Promise<{ output: string; tableData?: any[] }> => {
    return new Promise((resolve, reject) => {
      if (!window.SQL) reject(new Error('SQL.js not loaded'));
      try {
        const db = new window.SQL.Database();
        const result = db.exec(code);
        if (result && result.length > 0) {
          const { columns, values } = result[0];
          const output = columns.join('\t') + '\n' + values.map((r: any[]) => r.join('\t')).join('\n');
          const tableData = values.map((row: any[]) => {
            const obj: any = {};
            columns.forEach((col: string, idx: number) => { obj[col] = row[idx]; });
            return obj;
          });
          resolve({ output, tableData });
        } else {
          resolve({ output: 'Query executed successfully (no results).' });
        }
      } catch (err: any) { reject(new Error(err.message)); }
    });
  };

  const handleExecuteCode = async () => {
    if (!ydoc) return;
    setIsTerminalOpen(true);
    setIsExecuting(true);
    setOutputLogs([]);
    setSqlTableData(null);

    const code = ydoc.getText('monaco-content').toString();

    try {
      let output = '';
      let tableData: any[] | null = null;
      if (language === 'javascript' || language === 'typescript') {
        output = await runJavaScript(code);
      } else if (language === 'python') {
        if (!pyodideReady) throw new Error('Python runtime is loading.');
        output = await runPython(code);
      } else if (language === 'sql') {
        if (!sqlJsReady) throw new Error('SQL runtime is loading.');
        const res = await runSQL(code);
        output = res.output;
        tableData = res.tableData || null;
      }
      setOutputLogs(prev => [...prev, output || 'Execution completed.']);
      if (tableData) setSqlTableData(tableData);
    } catch (err: any) {
      setOutputLogs(prev => [...prev, `ERROR: ${err.message}`]);
    } finally {
      setIsExecuting(false);
    }
  };

  // --- Render: Login Screen ---
  if (!activeRoom || !activeUser) {
    return (
      <div className="min-h-screen w-full flex relative text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500/30 transition-colors duration-300">
        
        <AmbientBackground />

        {/* Left Side: Brand & Value Props (Hidden on Mobile) */}
        <div className="relative z-10 hidden lg:flex flex-col justify-center flex-1 px-16 xl:px-24 bg-white/20 dark:bg-black/10 backdrop-blur-md border-r border-white/40 dark:border-white/10 shadow-[8px_0_32px_rgba(31,38,135,0.05)]">
          <div className="max-w-xl">
            <div className="flex items-center gap-4 text-blue-600 dark:text-blue-400 mb-8">
              <div className="p-3 bg-white/40 dark:bg-white/10 backdrop-blur-md rounded-2xl border border-white/50 dark:border-white/20 shadow-sm">
                <CodeCoreLogo className="w-10 h-10" />
              </div>
              <h1 className="text-4xl font-bold tracking-tight drop-shadow-sm">ColaCode</h1>
            </div>
            
            <h2 className="text-5xl font-extrabold leading-[1.1] mb-6 text-slate-800 dark:text-white drop-shadow-sm">
              Code together, <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-500 dark:from-blue-400 dark:to-indigo-300">execute anywhere.</span>
            </h2>
            <p className="text-lg text-slate-700 dark:text-slate-300 mb-10 leading-relaxed font-medium">
              A high-performance, real-time collaborative workspace engineered for modern software teams. Zero server configuration required.
            </p>

            <div className="space-y-6">
              {[
                { icon: Users, title: "Sub-50ms CRDT Sync", desc: "True real-time collaboration with precise cursor tracking." },
                { icon: Sparkles, title: "AI Copilot Integration", desc: "Type commands in comments to auto-generate context-aware code." },
                { icon: Terminal, title: "Local WASM Execution", desc: "Run Python, Node, and SQL natively in your browser sandbox." }
              ].map((Feature, i) => (
                <div key={i} className="flex gap-4 items-start p-4 rounded-2xl bg-white/30 dark:bg-white/5 backdrop-blur-md border border-white/40 dark:border-white/10 shadow-sm hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
                  <div className="p-2 rounded-xl bg-blue-100/50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 backdrop-blur-sm border border-white/50 dark:border-white/10">
                    <Feature.icon size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">{Feature.title}</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{Feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="relative z-10 flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            
            {/* Mobile Header */}
<div className="flex lg:hidden flex-col items-center justify-center gap-1 mb-8 text-blue-700 dark:text-blue-400">
  <div className="flex items-center gap-3">
    <CodeCoreLogo className="w-10 h-10 drop-shadow-sm" />
    <h1 className="text-3xl font-bold drop-shadow-sm">ColaCode</h1>
  </div>
  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 drop-shadow-sm mt-1 text-center max-w-xs">
    Real‑time collaborative coding with AI
  </p>
  <p className="text-xs font-medium text-slate-600 dark:text-slate-400 text-center">
    Code together, execute anywhere.
  </p>
</div>

            {/* Aero Glass Form Container */}
            <div className="bg-white/40 dark:bg-[#0f172a]/60 backdrop-blur-2xl p-8 rounded-3xl border border-white/60 dark:border-white/20 shadow-[0_8px_32px_rgba(31,38,135,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] relative overflow-hidden">
              {/* Glass subtle highlight top edge */}
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/60 dark:via-white/20 to-transparent"></div>

              <div className="mb-8 relative z-10">
                <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white drop-shadow-sm">Join Workspace</h2>
                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">Enter a room ID to sync with your team instantly.</p>
              </div>

              <form onSubmit={handleJoinSession} className="space-y-5 relative z-10">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Room ID</label>
                  <div className="relative">
                    <BookOpen size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400 z-10" />
                    <input 
                      type="text" 
                      value={sessionRoom}
                      onChange={(e) => setSessionRoom(e.target.value)}
                      placeholder="e.g. project-technometer"
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-white/50 dark:bg-black/30 backdrop-blur-md border border-white/60 dark:border-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-400 transition-all font-mono text-sm shadow-inner placeholder-slate-500 dark:placeholder-slate-400 text-slate-900 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Display Name</label>
                  <div className="relative">
                    <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400 z-10" />
                    <input 
                      type="text" 
                      value={sessionUser}
                      onChange={(e) => setSessionUser(e.target.value)}
                      placeholder="e.g. Shriram G."
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-white/50 dark:bg-black/30 backdrop-blur-md border border-white/60 dark:border-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-400 transition-all text-sm font-medium shadow-inner placeholder-slate-500 dark:placeholder-slate-400 text-slate-900 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="w-full mt-6 py-3.5 bg-blue-600/90 dark:bg-blue-600/80 hover:bg-blue-600 dark:hover:bg-blue-500 backdrop-blur-md text-white font-bold rounded-xl shadow-[0_4px_15px_rgba(37,99,235,0.3)] dark:shadow-[0_4px_15px_rgba(37,99,235,0.5)] border border-blue-400/50 transition-all flex items-center justify-center gap-2 group">
                  <span>Initialize Connection</span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Render: Main Editor App ---
  return (
    <div className="w-screen h-screen flex flex-col relative text-slate-800 dark:text-slate-200 transition-colors duration-300 font-sans overflow-hidden">
      
      <AmbientBackground />

      {/* Aero Glass Header */}
<header className="h-14 flex items-center justify-between px-4 bg-white/50 dark:bg-[#0f172a]/60 backdrop-blur-xl border-b border-white/60 dark:border-white/10 shadow-sm shrink-0 z-20 relative">
  <div className="absolute top-0 left-0 right-0 h-px bg-white/40 dark:bg-white/5"></div>
  
  <div className="flex items-center gap-2 min-w-0">
    {/* Always show logo + name */}
    <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400 shrink-0">
      <CodeCoreLogo className="w-6 h-6 drop-shadow-sm" />
      <span className="font-bold tracking-tight drop-shadow-sm text-sm sm:text-base whitespace-nowrap">ColaCode</span>
    </div>
    <button
      onClick={() => setIsMobileSidebarOpen(true)}
      className="p-2 rounded-lg bg-white/30 dark:bg-white/5 hover:bg-white/50 dark:hover:bg-white/10 md:hidden text-slate-700 dark:text-slate-300 border border-white/40 dark:border-white/10 transition-colors backdrop-blur-md shrink-0"
    >
      <Menu size={20} />
    </button>
    <div className="flex flex-col min-w-0 ml-1">
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Workspace</span>
      <span className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-[100px] sm:max-w-xs drop-shadow-sm">{activeRoom}</span>
    </div>
  </div>

  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value)}
      className="hidden sm:block py-1.5 px-3 rounded-lg bg-white/50 dark:bg-black/30 backdrop-blur-md border border-white/60 dark:border-white/20 text-xs font-bold uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer text-slate-800 dark:text-slate-200 shadow-inner"
    >
      <option value="javascript">JS/Node</option>
      <option value="typescript">TypeScript</option>
      <option value="python">Python</option>
      <option value="sql">SQL</option>
    </select>

    <button
      onClick={handleExecuteCode}
      disabled={isExecuting || (language === 'python' && !pyodideReady) || (language === 'sql' && !sqlJsReady)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 dark:bg-emerald-500/30 backdrop-blur-md border border-emerald-400/30 dark:border-emerald-400/20 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/30 dark:hover:bg-emerald-500/40 font-bold text-sm transition-all disabled:opacity-50 shadow-sm"
    >
      {isExecuting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
      <span className="hidden sm:inline">{isExecuting ? 'Running...' : 'Run'}</span>
    </button>

    <div className="w-px h-6 bg-slate-300/50 dark:bg-white/10 mx-1 hidden sm:block"></div>

    <div className="flex items-center gap-1">
      <button onClick={() => setShowGuide(true)} className="p-2 rounded-lg bg-white/30 dark:bg-white/5 hover:bg-white/50 dark:hover:bg-white/10 border border-transparent hover:border-white/40 dark:hover:border-white/10 text-slate-700 dark:text-slate-300 transition-all backdrop-blur-md" title="Readme / Help">
        <HelpCircle size={18} />
      </button>
      <button onClick={handleExportCode} className="hidden sm:block p-2 rounded-lg bg-white/30 dark:bg-white/5 hover:bg-white/50 dark:hover:bg-white/10 border border-transparent hover:border-white/40 dark:hover:border-white/10 text-slate-700 dark:text-slate-300 transition-all backdrop-blur-md" title="Download Code">
        <Download size={18} />
      </button>
      <button onClick={() => setTheme(theme === 'vs-dark' ? 'vs-light' : 'vs-dark')} className="p-2 rounded-lg bg-white/30 dark:bg-white/5 hover:bg-white/50 dark:hover:bg-white/10 border border-transparent hover:border-white/40 dark:hover:border-white/10 text-slate-700 dark:text-slate-300 transition-all backdrop-blur-md" title="Toggle Theme">
        {theme === 'vs-dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button onClick={handleLeaveSession} className="hidden sm:flex items-center gap-2 p-2 ml-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-700 dark:text-red-400 transition-all backdrop-blur-md" title="Leave Session">
        <LogOut size={18} />
      </button>
    </div>
  </div>
</header>

      {/* Main Layout Area */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        
        {/* Aero Glass Sidebar */}
        <aside className={`absolute md:relative z-30 h-full w-64 bg-white/40 dark:bg-[#0f172a]/40 backdrop-blur-xl border-r border-white/60 dark:border-white/10 flex flex-col transition-transform duration-300 ease-out shadow-[4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-[4px_0_24px_rgba(0,0,0,0.2)] ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="flex items-center justify-between p-4 border-b border-white/40 dark:border-white/10 md:hidden bg-white/20 dark:bg-black/20">
            <span className="font-bold text-slate-900 dark:text-white">Menu</span>
            <button onClick={() => setIsMobileSidebarOpen(false)} className="p-2 text-slate-700 dark:text-slate-300"><X size={20}/></button>
          </div>
          
          <div className="p-4 flex-1 overflow-y-auto">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-2 drop-shadow-sm">
              <Users size={14} /> Collaborators ({activeUsers.length})
            </h3>
            <div className="space-y-2">
              {activeUsers.map((user) => (
                <div key={user.clientID} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/50 dark:bg-black/30 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm">
                  <div className="w-3 h-3 rounded-full shadow-md ring-2 ring-white/80 dark:ring-black/50" style={{ backgroundColor: user.color }} />
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate flex-1 drop-shadow-sm">{user.name}</span>
                  {user.name === activeUser && <span className="text-[10px] uppercase font-extrabold bg-blue-500/20 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-400/30">You</span>}
                </div>
              ))}
            </div>

            {/* Mobile-only actions inside sidebar */}
            <div className="md:hidden mt-8 space-y-4 border-t border-white/40 dark:border-white/10 pt-6">
               <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-2">Language</label>
               <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full py-2 px-3 rounded-xl bg-white/50 dark:bg-black/40 backdrop-blur-md border border-white/60 dark:border-white/20 text-sm font-bold focus:outline-none shadow-inner"
              >
                <option value="javascript">JavaScript / Node</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="sql">SQL</option>
              </select>
              
              <button onClick={handleExportCode} className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10 border border-white/50 dark:border-white/10 text-slate-800 dark:text-slate-200 transition-colors backdrop-blur-md shadow-sm">
                <Download size={18} /> <span className="font-bold text-sm">Download File</span>
              </button>
              <button onClick={handleLeaveSession} className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-700 dark:text-red-400 transition-colors backdrop-blur-md shadow-sm">
                <LogOut size={18} /> <span className="font-bold text-sm">Disconnect</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Backdrop for Mobile Sidebar */}
        {isMobileSidebarOpen && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-20 md:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
        )}

        {/* Editor & Terminal Container */}
        <main className="flex-1 flex flex-col min-w-0 bg-white/30 dark:bg-black/20 backdrop-blur-sm">
          <div className={`flex-1 relative transition-all duration-300 ${isTerminalOpen ? 'h-[60%]' : 'h-full'}`}>
            {ydoc && provider ? (
              <EditorContainer ydoc={ydoc} provider={provider} theme={theme} />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-600 dark:text-slate-400 drop-shadow-sm">
                <Loader2 size={32} className="animate-spin text-blue-600 dark:text-blue-400" />
                <span className="font-mono font-bold text-sm bg-white/40 dark:bg-black/40 backdrop-blur-md px-4 py-2 rounded-lg border border-white/50 dark:border-white/10 shadow-sm">Initializing Collaborative Editor...</span>
              </div>
            )}
          </div>

          {/* Frosted Glass Terminal / Output Console */}
          {isTerminalOpen && (
            <div className="h-[40%] min-h-[200px] border-t border-white/30 dark:border-white/10 bg-slate-900/80 dark:bg-[#0f111a]/80 backdrop-blur-2xl flex flex-col z-10 shrink-0 shadow-[0_-8px_30px_rgba(0,0,0,0.15)] relative">
              <div className="absolute top-0 left-0 right-0 h-px bg-white/20"></div>
              
              <div className="h-10 px-4 bg-black/20 dark:bg-black/40 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal size={14} className="text-blue-300" />
                  <span className="text-xs font-mono font-bold text-slate-200 tracking-wider">OUTPUT</span>
                </div>
                <button onClick={() => setIsTerminalOpen(false)} className="text-slate-400 hover:text-white p-1 rounded transition-colors hover:bg-white/10">
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="flex-1 p-4 overflow-y-auto font-mono text-[13px] leading-relaxed text-slate-200 bg-transparent selection:bg-blue-500/50">
                {loadingMessage && <div className="text-yellow-300 flex items-center gap-2 mb-2 bg-yellow-900/30 w-fit px-3 py-1 rounded border border-yellow-500/30 backdrop-blur-md"><Loader2 size={14} className="animate-spin"/> {loadingMessage}</div>}
                
                {outputLogs.map((log, i) => (
                  <div key={i} className={`whitespace-pre-wrap ${log.startsWith('ERROR') ? 'text-red-400' : 'text-slate-200'}`}>
                    {log}
                  </div>
                ))}

                {sqlTableData && sqlTableData.length > 0 && (
                  <div className="mt-4 w-full overflow-x-auto rounded-xl border border-white/10 bg-black/20 backdrop-blur-md shadow-inner">
                    <table className="w-full text-left collapse">
                      <thead className="bg-white/5 dark:bg-white/5 border-b border-white/10">
                        <tr>
                          {Object.keys(sqlTableData[0]).map((col) => (
                            <th key={col} className="border-r border-white/5 px-4 py-3 text-emerald-300 font-bold uppercase text-xs tracking-wider">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sqlTableData.map((row, idx) => (
                          <tr key={idx} className="hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0">
                            {Object.values(row).map((val, i) => (
                              <td key={i} className="border-r border-white/5 px-4 py-3 text-slate-300">{String(val)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Prominent Onboarding / Guide Modal (Aero Glass) */}
      {showGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 dark:bg-slate-900/60 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-white/70 dark:bg-[#0f172a]/80 backdrop-blur-3xl w-full max-w-2xl rounded-[2rem] shadow-[0_16px_64px_rgba(0,0,0,0.2)] dark:shadow-[0_16px_64px_rgba(0,0,0,0.6)] border border-white/60 dark:border-white/20 flex flex-col max-h-[90vh] relative overflow-hidden">
            
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent"></div>

            <div className="p-6 sm:p-10 flex-1 overflow-y-auto">
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-2 drop-shadow-sm">Welcome to ColaCode</h2>
                  <p className="text-slate-700 dark:text-slate-300 font-medium">Your real-time workspace is ready. Here's how to maximize your flow.</p>
                </div>
                <div className="p-4 bg-white/50 dark:bg-blue-500/20 backdrop-blur-md rounded-2xl border border-white/60 dark:border-blue-400/20 shadow-sm text-blue-600 dark:text-blue-400 hidden sm:block">
                  <CodeCoreLogo className="w-8 h-8 drop-shadow-sm" />
                </div>
              </div>

              <div className="space-y-4">
                {/* Feature 1 */}
                <div className="group p-5 rounded-2xl bg-white/40 dark:bg-black/20 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm hover:border-blue-400/50 hover:bg-white/50 dark:hover:bg-black/40 transition-all">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2.5 bg-emerald-500/20 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-400/30">
                      <Users size={20} />
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">Real-Time Sync</h3>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pl-14 font-medium">
                    Invite peers to <strong className="text-slate-900 dark:text-white bg-white/50 dark:bg-white/10 px-1.5 py-0.5 rounded border border-white/40 dark:border-white/5">{activeRoom}</strong>. Watch cursors, nametags, and text synchronize instantly without latency.
                  </p>
                </div>

                {/* Feature 2 */}
                <div className="group p-5 rounded-2xl bg-white/40 dark:bg-black/20 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm hover:border-blue-400/50 hover:bg-white/50 dark:hover:bg-black/40 transition-all">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2.5 bg-purple-500/20 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded-xl border border-purple-400/30">
                      <Sparkles size={20} />
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">AI Copilot</h3>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pl-14 font-medium">
                    Type <code className="px-2 py-1 rounded-lg bg-white/60 dark:bg-black/40 border border-white/50 dark:border-white/10 text-slate-800 dark:text-slate-200 font-mono text-xs shadow-inner">/* @AI Create a fetch request */</code>. The integrated AI will read context and stream code directly into your editor view.
                  </p>
                </div>

                {/* Feature 3 */}
                <div className="group p-5 rounded-2xl bg-white/40 dark:bg-black/20 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm hover:border-blue-400/50 hover:bg-white/50 dark:hover:bg-black/40 transition-all">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2.5 bg-blue-500/20 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-xl border border-blue-400/30">
                      <Zap size={20} />
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">Local Sandbox Execution</h3>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pl-14 font-medium">
                    Select JS, Python, or SQL from the header and click <strong className="text-slate-900 dark:text-white">Run</strong>. Code executes entirely within your browser's WebAssembly sandbox.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-white/30 dark:bg-black/20 backdrop-blur-md border-t border-white/50 dark:border-white/10 flex justify-end shrink-0">
              <button 
                onClick={() => setShowGuide(false)}
                className="w-full sm:w-auto px-8 py-3.5 bg-blue-600/90 dark:bg-blue-600/80 hover:bg-blue-600 dark:hover:bg-blue-500 backdrop-blur-md text-white font-bold rounded-xl shadow-[0_4px_15px_rgba(37,99,235,0.4)] border border-blue-400/50 transition-all flex items-center justify-center gap-2"
              >
                Start Coding <Code2 size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}