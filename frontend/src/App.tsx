import { useState, useEffect } from 'react';
import { useColaCode } from './hooks/useColaCode';
import { EditorContainer } from './components/EditorContainer';
import {
  Sun, Moon, Terminal, Users, LogOut, ArrowRight, Menu, X,
  Download, HelpCircle, Play, CheckCircle2, ChevronDown, Loader2
} from 'lucide-react';

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

// Type declarations for CDN‑loaded libraries
declare global {
  interface Window {
    loadPyodide: any;
    pyodide: any;
    initSqlJs: any;
    SQL: any;
  }
}

export default function App() {
  const [theme, setTheme] = useState<'vs-dark' | 'vs-light'>('vs-dark');
  const [sessionRoom, setSessionRoom] = useState('');
  const [sessionUser, setSessionUser] = useState('');
  const [activeRoom, setActiveRoom] = useState('');
  const [activeUser, setActiveUser] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Execution state
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [outputLogs, setOutputLogs] = useState<string[]>([]);
  const [sqlTableData, setSqlTableData] = useState<any[] | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [language, setLanguage] = useState('javascript');
  const [pyodideReady, setPyodideReady] = useState(false);
  const [sqlJsReady, setSqlJsReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const { ydoc, provider, activeUsers } = useColaCode(activeRoom, activeUser);

  // Load Pyodide and SQL.js once
  useEffect(() => {
    const loadRuntimes = async () => {
      if (typeof window.loadPyodide !== 'undefined' && !window.pyodide) {
        setLoadingMessage('Loading Python runtime...');
        try {
          window.pyodide = await window.loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.1/full/',
          });
          setPyodideReady(true);
        } catch (e) {
          console.error('Pyodide load failed', e);
          setOutputLogs(prev => [...prev, 'ERROR: Failed to load Python runtime.']);
        }
      }
      if (typeof window.initSqlJs !== 'undefined' && !window.SQL) {
        setLoadingMessage('Loading SQL runtime...');
        try {
          window.SQL = await window.initSqlJs({
            locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
          });
          setSqlJsReady(true);
        } catch (e) {
          console.error('SQL.js load failed', e);
          setOutputLogs(prev => [...prev, 'ERROR: Failed to load SQL runtime.']);
        }
      }
      setLoadingMessage('');
    };
    loadRuntimes();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'vs-dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  const handleJoinSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (sessionRoom.trim() && sessionUser.trim()) {
      setActiveRoom(sessionRoom.trim().toLowerCase());
      setActiveUser(sessionUser.trim());
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
    const extensions: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py' };
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeRoom}-workspace.${extensions[language] || 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ----- EXECUTION LOGIC (WASM-BASED) -----

  // 1. JavaScript / TypeScript (Web Worker)
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
            if (result !== undefined) {
              output += String(result) + '\\n';
            }
            console.log = originalLog;
            self.postMessage({ type: 'success', output });
          } catch (err) {
            console.log = originalLog;
            self.postMessage({ type: 'error', error: err.message || String(err) });
          }
        };
      `], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerUrl);
      worker.onmessage = (e) => {
        if (e.data.type === 'success') {
          resolve(e.data.output);
        } else {
          reject(new Error(e.data.error));
        }
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };
      worker.onerror = (err) => {
        reject(new Error(err.message));
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };
      worker.postMessage(code);
    });
  };

  // 2. Python (Pyodide)
  const runPython = async (code: string): Promise<string> => {
    if (!window.pyodide) throw new Error('Python runtime not loaded');
    window.pyodide.runPython(`
      import sys
      from io import StringIO
      sys.stdout = StringIO()
    `);
    try {
      await window.pyodide.runPythonAsync(code);
      const output = window.pyodide.runPython('sys.stdout.getvalue()');
      return output;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  // 3. SQL (SQL.js)
  const runSQL = (code: string): Promise<{ output: string; tableData?: any[] }> => {
    return new Promise((resolve, reject) => {
      if (!window.SQL) reject(new Error('SQL.js not loaded'));
      try {
        const db = new window.SQL.Database();
        // Execute the query (assume a single SELECT statement for simplicity)
        const result = db.exec(code);
        let output = '';
        let tableData: any[] | null = null;
        if (result && result.length > 0) {
          const firstResult = result[0];
          const columns = firstResult.columns;
          const values = firstResult.values;
          output = columns.join('\t') + '\n' + values.map(row => row.join('\t')).join('\n');
          tableData = values.map(row => {
            const obj: any = {};
            columns.forEach((col, idx) => { obj[col] = row[idx]; });
            return obj;
          });
        } else {
          output = 'Query executed successfully (no results).';
        }
        resolve({ output, tableData });
      } catch (err: any) {
        reject(new Error(err.message));
      }
    });
  };

  // Main execution handler
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

      switch (language) {
        case 'javascript':
        case 'typescript': {
          // For TS we run as JS (types are ignored). For full TS support, include the TypeScript compiler.
          output = await runJavaScript(code);
          break;
        }
        case 'python': {
          if (!pyodideReady) {
            throw new Error('Python runtime is still loading. Please wait.');
          }
          output = await runPython(code);
          break;
        }
        case 'sql': {
          if (!sqlJsReady) {
            throw new Error('SQL runtime is still loading. Please wait.');
          }
          const result = await runSQL(code);
          output = result.output;
          tableData = result.tableData || null;
          break;
        }
        default:
          throw new Error(`Unsupported language: ${language}`);
      }

      setOutputLogs(prev => [...prev, output || 'Execution completed (no output).']);
      if (tableData && tableData.length > 0) {
        setSqlTableData(tableData);
      }
    } catch (err: any) {
      setOutputLogs(prev => [...prev, `ERROR: ${err.message}`]);
    } finally {
      setIsExecuting(false);
    }
  };

  // ---- Login screen ----
  if (!activeRoom || !activeUser) {
    return (
      <div className="w-screen h-screen flex flex-col md:flex-row items-center justify-center bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-blue-100 p-4 gap-8">
        <div className="hidden md:flex flex-col gap-6 max-w-sm">
          <div className="flex items-center gap-3 text-blue-400">
            <CodeCoreLogo className="w-12 h-12" />
            <h1 className="text-5xl font-handwritten font-bold tracking-wide text-blue-100">ColaCode</h1>
          </div>
          <p className="text-sm text-blue-200/80 leading-relaxed">
            A high-performance, real-time collaborative coding environment engineered for modern software teams.
          </p>
          <div className="flex flex-col gap-4 mt-4">
            {[
              "Sub-50ms CRDT state synchronization.",
              "Autonomous AI Copilot via LangGraph & Gemini.",
              "Multi-language execution sandbox (WASM).",
              "Google-Docs style live cursor tracking."
            ].map((feature, i) => (
              <div key={i} className="flex items-start gap-3 text-sm font-medium text-blue-300/90">
                <CheckCircle2 size={18} className="text-blue-500 shrink-0 mt-0.5" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full max-w-sm sm:max-w-md glass-panel rounded-3xl p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden bg-slate-900/40">
          <div className="flex flex-col items-center text-center gap-2 md:hidden">
            <div className="p-3 bg-blue-400/10 rounded-2xl text-blue-400 mb-2">
              <CodeCoreLogo className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-handwritten font-bold text-blue-100">ColaCode</h1>
          </div>

          <form onSubmit={handleJoinSession} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-blue-400/60">Workspace Room ID</label>
              <input 
                type="text" 
                value={sessionRoom}
                onChange={(e) => setSessionRoom(e.target.value)}
                placeholder="project-alpha-sync"
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-blue-950 focus:outline-none focus:border-blue-500 text-sm font-mono text-white placeholder-slate-600"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-blue-400/60">Your Identity</label>
              <input 
                type="text" 
                value={sessionUser}
                onChange={(e) => setSessionUser(e.target.value)}
                placeholder="Shriram"
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-blue-950 focus:outline-none focus:border-blue-500 text-sm font-medium text-white placeholder-slate-600"
                required
              />
            </div>

            <button type="submit" className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl tracking-wide shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
              <span>Initialize Workspace</span>
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Main editor UI ----
  return (
    <div className="w-screen h-screen flex flex-col bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-blue-950 dark:to-slate-950 text-slate-700 dark:text-blue-100 p-2 sm:p-4 gap-2 sm:gap-4 transition-colors duration-300">
      <header className="w-full h-16 glass-panel rounded-2xl flex items-center justify-between px-4 sm:px-6 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            className="p-2 rounded-xl bg-blue-200/40 dark:bg-blue-950/40 hover:bg-blue-200/70 border border-blue-300/20 text-blue-700 md:hidden cursor-pointer"
          >
            {isMobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="p-2 bg-blue-200/50 dark:bg-blue-900/40 border border-blue-300/30 rounded-xl text-blue-600 dark:text-blue-400 hidden xs:block">
            <CodeCoreLogo className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <h1 className="text-xl sm:text-2xl h-7 font-handwritten font-bold text-blue-950 dark:text-blue-50">ColaCode</h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="p-1.5 rounded-xl bg-black/10 dark:bg-black/30 border border-blue-300/30 text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300 focus:outline-none cursor-pointer hidden sm:block"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="sql">SQL</option>
          </select>

          <button
            onClick={handleExecuteCode}
            disabled={isExecuting || (language === 'python' && !pyodideReady) || (language === 'sql' && !sqlJsReady)}
            title={`Run ${language.toUpperCase()}`}
            className="p-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExecuting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          </button>
          <button onClick={handleExportCode} title="Export File" className="p-2 rounded-xl bg-blue-200/40 dark:bg-blue-950/40 hover:bg-blue-200/70 border border-blue-300/20 text-blue-700 dark:text-blue-300 cursor-pointer hidden sm:block">
            <Download size={16} />
          </button>
          <button onClick={() => setShowGuide(true)} title="Usage Guide" className="p-2 rounded-xl bg-blue-200/40 dark:bg-blue-950/40 hover:bg-blue-200/70 border border-blue-300/20 text-blue-700 dark:text-blue-300 cursor-pointer">
            <HelpCircle size={16} />
          </button>
          <div className="w-px h-6 bg-blue-200 dark:bg-blue-800 mx-1 hidden sm:block"></div>
          <button onClick={() => setTheme(theme === 'vs-dark' ? 'vs-light' : 'vs-dark')} className="p-2 rounded-xl bg-blue-200/40 dark:bg-blue-950/40 hover:bg-blue-200/70 border border-blue-300/20 text-blue-700 dark:text-blue-300 cursor-pointer">
            {theme === 'vs-dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={handleLeaveSession} className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-600 transition-all cursor-pointer flex items-center gap-2 font-medium text-sm">
            <LogOut size={16} />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex gap-4 overflow-hidden relative">
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 bg-black/10 backdrop-blur-sm z-30 md:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
        )}

        <aside className={`fixed md:relative top-2 left-2 bottom-2 md:top-0 md:left-0 md:bottom-0 z-40 w-64 p-5 flex flex-col gap-6 shrink-0 glass-panel rounded-2xl transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)] md:translate-x-0'}`}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500">
              <Terminal size={14} /><span>Active Room</span>
            </div>
            <div className="text-sm font-mono px-3 py-2 bg-blue-100/50 dark:bg-black/30 rounded-xl border border-blue-200 dark:border-blue-950 font-semibold truncate">
              {activeRoom}
            </div>
          </div>
          <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500 sticky top-0 bg-transparent pb-1">
              <Users size={14} /><span>Collaborators ({activeUsers.length})</span>
            </div>
            <div className="flex flex-col gap-2">
              {activeUsers.map((user) => (
                <div key={user.clientID} className="flex items-center gap-3 p-2 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/40 shadow-sm">
                  <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: user.color }} />
                  <span className="text-sm font-medium tracking-wide truncate">{user.name} {user.name === activeUser && '(You)'}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col gap-4 overflow-hidden min-w-0">
          <div className={`flex-1 glass-panel rounded-2xl p-1.5 relative overflow-hidden bg-white/20 dark:bg-blue-950/10 w-full transition-all duration-300 ${isTerminalOpen ? 'h-2/3' : 'h-full'}`}>
            {ydoc && provider ? <EditorContainer ydoc={ydoc} provider={provider} theme={theme} /> : <div className="w-full h-full flex items-center justify-center font-mono text-xs animate-pulse">Constructing Matrix...</div>}
          </div>

          {isTerminalOpen && (
            <div className="h-1/3 shrink-0 glass-panel rounded-2xl bg-slate-950 border-slate-800 flex flex-col overflow-hidden relative">
              <div className="h-8 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
                <span className="text-xs font-mono font-medium text-emerald-400 flex items-center gap-2">
                  <Terminal size={12} /> Execution Sandbox ({language})
                </span>
                <button onClick={() => setIsTerminalOpen(false)} className="text-slate-500 hover:text-slate-300"><ChevronDown size={14} /></button>
              </div>
              <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                {loadingMessage && <div className="text-yellow-400 animate-pulse">{loadingMessage}</div>}
                {outputLogs.map((log, i) => (
                  <div key={i} className={log.startsWith('ERROR') ? 'text-red-400' : ''}>{log}</div>
                ))}
                {sqlTableData && sqlTableData.length > 0 && (
                  <div className="mt-2 w-full overflow-auto">
                    <table className="w-full text-xs border-collapse border border-slate-700">
                      <thead>
                        <tr>
                          {Object.keys(sqlTableData[0]).map((col) => (
                            <th key={col} className="border border-slate-700 px-2 py-1 text-left text-emerald-300">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sqlTableData.map((row, idx) => (
                          <tr key={idx}>
                            {Object.values(row).map((val, i) => (
                              <td key={i} className="border border-slate-700 px-2 py-1">{String(val)}</td>
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

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-700 rounded-3xl p-6 max-w-lg w-full shadow-2xl relative">
            <button onClick={() => setShowGuide(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"><X size={20}/></button>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-blue-100 mb-4 flex items-center gap-2"><HelpCircle className="text-blue-500"/> User Guide</h2>
            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700/50">
                <h3 className="font-semibold text-slate-800 dark:text-blue-200 mb-1 flex items-center gap-2"><Users size={16}/> Real-Time Collaboration</h3>
                <p>Share your Workspace ID with peers. Cursors, nametags, and text synchronize across all connections instantly via CRDT logic.</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800/30">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-2"><Terminal size={16}/> AI Copilot</h3>
                <p>Type <code className="bg-blue-100 dark:bg-blue-950 px-1 py-0.5 rounded font-mono text-blue-600 dark:text-blue-400">/* @AI [your prompt] */</code> anywhere in the editor. The headless bot will read the context, execute a LangGraph task, and stream the generated code character-by-character directly into your view.</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-800/20">
                <h3 className="font-semibold text-emerald-800 dark:text-emerald-400 mb-1 flex items-center gap-2"><Play size={16}/> Local Execution</h3>
                <p>Select your language (JS/TS, Python, SQL) and click the Play button. Code runs entirely in your browser via WebAssembly – no server required.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}