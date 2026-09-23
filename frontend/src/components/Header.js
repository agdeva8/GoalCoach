import { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut, History, Sun, Moon, Sparkles, Info, LogIn } from "lucide-react";
import Logo from "./Logo";

const PROVIDERS = [
  { id: "gemini", label: "Gemini", model: "3 Flash" },
  { id: "anthropic", label: "Claude", model: "Sonnet 4.6" },
  { id: "openai", label: "OpenAI", model: "GPT-5.4" },
];

const STORYBOARDS = [
  { id: "multi", label: "Cold start · multiple goals", text: "I've got a few things going at once: a 6-month career pivot into product management, a 12-month fitness rebuild, a 3-month side project I keep neglecting, and I want to be more present with my partner. Help me figure out this week." },
  { id: "one", label: "Cold start · one goal", text: "I want to start learning to draw." },
  { id: "over", label: "Cold start · over-committed", text: "Okay, dumping everything: career pivot, fitness rebuild, the side project, learn Spanish, read 30 books this year, launch a newsletter, fix my sleep schedule, and be a better partner. Where do I even start?" },
  { id: "gap", label: "Returning after a gap", text: "It's been about a week. Where were we?" },
  { id: "meta", label: "Long-term · meta question", text: "Didn't I tell you I'd protect two mornings a week for the side project? What actually happened to that?" },
  { id: "routine", label: "Routine return", text: "Done with the gym for today. What's next on the pivot?" },
];

export default function Header({ user, authLoading, provider, onProvider, onOpenAudit, onOpenAbout, onSignIn, theme, onToggleTheme, onLogout, onStoryboard }) {
  const [provOpen, setProvOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const cur = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
  const isGuest = !user || user.is_guest;
  const rootRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setProvOpen(false);
        setStoryOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <header
      data-testid="app-header"
      className="h-16 shrink-0 border-b border-[var(--border)] bg-[var(--bg-primary)]/85 backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Logo className="w-7 h-7 text-[var(--accent)] shrink-0" />
        <span className="font-display font-bold tracking-tight text-base sm:text-lg">GoalCoach</span>
        <span className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] truncate">
          let's sort your life — together.
        </span>
      </div>

      <div ref={rootRef} className="ml-auto flex items-center gap-2">
        {/* Storyboard picker */}
        <div className="relative">
          <button
            data-testid="storyboard-trigger"
            onClick={() => { setStoryOpen((v) => !v); setProvOpen(false); setMenuOpen(false); }}
            title="Load a scenario prompt"
            className="hidden sm:flex items-center gap-1.5 h-9 px-3 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] font-mono text-[11px] uppercase tracking-wider transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Scenarios <ChevronDown className="w-3 h-3" />
          </button>
          {storyOpen && (
            <div className="absolute right-0 mt-1 w-72 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50" data-testid="storyboard-menu">
              {STORYBOARDS.map((s) => (
                <button
                  key={s.id}
                  data-testid={`storyboard-${s.id}`}
                  onClick={() => { onStoryboard(s.text); setStoryOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] border-b border-[var(--border)] last:border-0 transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Model provider switcher */}
        <div className="relative">
          <button
            data-testid="model-switcher-trigger"
            onClick={() => { setProvOpen((v) => !v); setStoryOpen(false); setMenuOpen(false); }}
            title="Switch the coach's model"
            className="flex items-center gap-2 h-9 px-3 border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-primary)]">{cur.label}</span>
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          </button>
          {provOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50" data-testid="model-switcher-menu">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  data-testid={`model-option-${p.id}`}
                  onClick={() => { onProvider(p.id); setProvOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-[var(--bg-tertiary)] border-b border-[var(--border)] last:border-0 transition-colors ${p.id === provider ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}
                >
                  <span className="font-mono uppercase tracking-wider">{p.label}</span>
                  <span className="text-[var(--text-muted)]">{p.model}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          data-testid="open-about-button"
          onClick={onOpenAbout}
          title="About GoalCoach, privacy & the founder"
          className="h-9 w-9 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors"
        >
          <Info className="w-4 h-4" />
        </button>

        <button
          data-testid="open-audit-button"
          onClick={onOpenAudit}
          title="Every change the coach made — timestamped and exportable"
          className="h-9 flex items-center gap-1.5 px-2.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors rounded-md"
        >
          <History className="w-4 h-4" /> <span className="hidden sm:inline text-xs">Audit</span>
        </button>

        <button
          data-testid="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "light" ? "Switch to dark" : "Switch to light"}
          className="h-9 w-9 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors"
        >
          {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        {authLoading ? (
          <div className="h-9 w-9" aria-hidden="true" />
        ) : isGuest ? (
          <button
            data-testid="header-signin-button"
            onClick={onSignIn}
            title="Sign in with Google to save your work"
            className="h-9 flex items-center gap-2 px-3.5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-xs hover:opacity-90 transition-opacity"
          >
            <LogIn className="w-3.5 h-3.5" /> Sign in
          </button>
        ) : (
        <div className="relative">
          <button
            data-testid="user-menu-trigger"
            onClick={() => { setMenuOpen((v) => !v); setProvOpen(false); setStoryOpen(false); }}
            title="Account"
            className="h-9 w-9 rounded-full overflow-hidden border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors"
          >
            {user?.picture ? (
              <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <span className="flex items-center justify-center w-full h-full text-xs font-mono">{user?.name?.[0] || "?"}</span>
            )}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50">
              <div className="px-3 py-2.5 border-b border-[var(--border)]">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">{user?.name}</div>
                <div className="text-[11px] text-[var(--text-muted)] font-mono truncate">{user?.email}</div>
              </div>
              <button
                data-testid="logout-button"
                onClick={onLogout}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--danger)] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          )}
        </div>
        )}
      </div>
    </header>
  );
}
