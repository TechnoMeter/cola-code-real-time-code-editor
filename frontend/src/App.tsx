import { useState, useEffect } from 'react';
import { useColaCode } from './hooks/useColaCode';
import { EditorContainer } from './components/EditorContainer';
import { Sun, Moon, Terminal, Users, LogOut, ArrowRight, Menu, X } from 'lucide-react';

// Production Code-Centric Micro Branding Icon Vector
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

export default function App() {
  const [theme, setTheme] = useState<'vs-dark' | 'vs-light'>('vs-dark');
  const [sessionRoom, setSessionRoom] = useState('');
  const [sessionUser, setSessionUser] = useState('');
  const [activeRoom, setActiveRoom] = useState('');
  const [activeUser, setActiveUser] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const { ydoc, provider, activeUsers } = useColaCode(activeRoom, activeUser);

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
  };

  // -------------------------------------------------------------
  // Viewport State 1: Onboarding Entryway (Mobile Fluid Boundaries)
  // -------------------------------------------------------------
  if (!activeRoom || !activeUser) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-blue-100 p-4">
        <div className="w-full max-w-sm sm:max-w-md glass-panel rounded-3xl p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden bg-slate-900/40">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="p-3 bg-blue-400/10 rounded-2xl text-blue-400 mb-2">
              <CodeCoreLogo className="w-10 h-10" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-handwritten font-bold tracking-wide text-blue-100">ColaCode</h1>
            <p className="text-[10px] sm:text-xs font-medium tracking-widest text-blue-400/70 uppercase">
              multi user ai assisted coding platform
            </p>
          </div>

          <form onSubmit={handleJoinSession} className="flex flex-col gap-4 mt-2">
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
              <span>Initialize Synchronization</span>
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Viewport State 2: Active Working Session Frame (Fluid Core Mechanics)
  // -------------------------------------------------------------
  return (
    <div className="w-screen h-screen flex flex-col bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-blue-950 dark:to-slate-950 text-slate-700 dark:text-blue-100 p-2 sm:p-4 gap-2 sm:gap-4 box-border transition-colors duration-300">
      
      {/* Structural Adaptive Header Component */}
      <header className="w-full h-16 glass-panel rounded-2xl flex items-center justify-between px-4 sm:px-6 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile Navigation Panel Trigger toggle button */}
          <button
            onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            className="p-2 rounded-xl bg-blue-200/40 dark:bg-blue-950/40 hover:bg-blue-200/70 dark:hover:bg-blue-900/40 border border-blue-300/20 dark:border-blue-500/20 text-blue-700 dark:text-blue-300 md:hidden cursor-pointer"
            aria-label="Toggle Navigation Control Drawer"
          >
            {isMobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="p-2 bg-blue-200/50 dark:bg-blue-900/40 border border-blue-300/30 dark:border-blue-500/20 rounded-xl text-blue-600 dark:text-blue-400 shadow-sm hidden xs:block">
            <CodeCoreLogo className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <h1 className="text-xl sm:text-2xl h-7 font-handwritten font-bold tracking-wide text-blue-950 dark:text-blue-50">ColaCode</h1>
              <span className="text-[9px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400/70 hidden sm:inline">Assisted Core</span>
            </div>
            <p className="text-[9px] font-medium tracking-wide text-slate-400 dark:text-blue-300/40 lowercase -mt-1 hidden xs:block">
              multi user ai assisted coding platform
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setTheme(theme === 'vs-dark' ? 'vs-light' : 'vs-dark')}
            className="p-2 sm:p-2.5 rounded-xl bg-blue-200/40 dark:bg-blue-950/40 hover:bg-blue-200/70 dark:hover:bg-blue-900/40 border border-blue-300/20 dark:border-blue-500/20 transition-all text-blue-700 dark:text-blue-300 cursor-pointer"
          >
            {theme === 'vs-dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          
          <button
            onClick={handleLeaveSession}
            className="p-2 sm:p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-600 dark:text-red-400 transition-all cursor-pointer flex items-center gap-2 font-medium text-xs sm:text-sm"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Frame Workspace Layout Wrapper */}
      <div className="w-full h-[calc(100%-4.5rem)] sm:h-[calc(100%-5rem)] flex gap-4 overflow-hidden relative">
        
        {/* Mobile Viewport Ambient Blur Mask Layer */}
        {isMobileSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/10 backdrop-blur-sm z-30 md:hidden transition-all duration-300"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* Fluid Adaptive Sidebar Component */}
        <aside className={`
          fixed md:relative top-2 left-2 bottom-2 md:top-0 md:left-0 md:bottom-0 z-40 
          w-64 h-[calc(100%-1rem)] md:h-full p-5 flex flex-col gap-6 shrink-0 glass-panel rounded-2xl
          transform transition-transform duration-300 ease-in-out
          ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)] md:translate-x-0'}
        `}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400/60">
              <Terminal size={14} />
              <span>Active Room</span>
            </div>
            <div className="text-sm font-mono px-3 py-2 bg-blue-100/50 dark:bg-black/30 rounded-xl border border-blue-200 dark:border-blue-950 text-blue-800 dark:text-blue-300 font-semibold truncate">
              {activeRoom}
            </div>
          </div>

          <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400/60 sticky top-0 bg-transparent pb-1">
              <Users size={14} />
              <span>Collaborators ({activeUsers.length})</span>
            </div>
            <div className="flex flex-col gap-2">
              {activeUsers.map((user) => (
                <div key={user.clientID} className="flex items-center gap-3 p-2 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/40 dark:border-blue-900/20 shadow-sm">
                  <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: user.color }} />
                  <span className="text-sm font-medium tracking-wide truncate">
                    {user.name} {user.name === activeUser && '(You)'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Code Viewport Isolation Box */}
        <main className="flex-1 h-full glass-panel rounded-2xl p-1.5 sm:p-2 relative overflow-hidden bg-white/20 dark:bg-blue-950/10 w-full">
          {ydoc && provider ? (
            <EditorContainer ydoc={ydoc} provider={provider} theme={theme} />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-mono text-xs tracking-wider text-blue-600/60 dark:text-blue-400/60 animate-pulse">
              Constructing Vector Handshake Matrix...
            </div>
          )}
        </main>

      </div>
    </div>
  );
}