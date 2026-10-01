import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Info, LogIn, Settings, Menu, X, Sun, Moon } from "lucide-react";
import Logo from "./Logo";
import PersonaMenu from "./PersonaMenu";

// Header — top-level navigation. The model switcher and audit
// buttons used to live here, but both duplicate surface in /settings
// (see Settings.jsx). The header now keeps only what's used on every
// route: navigation, theme toggle (persisted), account, and About.
export default function Header({ user, authLoading, onOpenChat, onOpenAbout, onSignIn, onLogout, devLoginAvailable = false, currentUserId }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isLight, setIsLight] = useState(() => {
    // Mirror the html class — the inline script in public/index.html
    // already set it from localStorage before React mounted, so this
    // is just a sync-up on first render.
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("light");
  });
  const isGuest = !user || user.is_guest;
  const rootRef = useRef(null);

  // Keep the header in sync with theme changes from elsewhere (Coach.js
  // also writes the class when the user toggles there).
  useEffect(() => {
    const mo = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("light");
    document.documentElement.classList.toggle("light", next);
    try { localStorage.setItem("sutra_theme", next ? "light" : "dark"); } catch { /* ignore */ }
    setIsLight(next);
  };

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setMoreOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <header
      data-testid="app-header"
      className="h-16 shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_85%,transparent)] backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Logo className="w-7 h-7 text-[var(--accent)] shrink-0" />
        <span className="font-display font-bold tracking-tight text-base sm:text-lg">Sutra</span>
        <span className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] truncate">
          let's sort your life - together.
        </span>
      </div>

      <div ref={rootRef} className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {/* Desktop secondary controls */}
        <div className="hidden sm:flex items-center gap-1.5 sm:gap-2">
          <button
            data-testid="open-about-button"
            onClick={onOpenAbout}
            title="About Sutra, privacy & the founder"
            className="h-10 w-10 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <Info className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            data-testid="header-theme-toggle"
            onClick={toggleTheme}
            title={isLight ? "Switch to dark theme" : "Switch to light theme"}
            aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
            aria-pressed={isLight}
            className="h-10 w-10 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            {isLight ? <Moon className="w-4 h-4" aria-hidden="true" /> : <Sun className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>

        {/* Mobile "more" menu — collapses secondary controls */}
        <div className="relative sm:hidden">
          <button
            data-testid="header-more-button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="More options"
            className="h-10 w-10 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            {moreOpen ? <X className="w-4 h-4" aria-hidden="true" /> : <Menu className="w-4 h-4" aria-hidden="true" />}
          </button>
          {moreOpen && (
            <div role="menu" aria-label="More options" className="absolute right-0 mt-1 w-48 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50 py-1">
              <button
                role="menuitem"
                onClick={() => { onOpenAbout(); setMoreOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Info className="w-4 h-4" aria-hidden="true" /> About Sutra
              </button>
              <button
                role="menuitem"
                onClick={toggleTheme}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                {isLight ? <Moon className="w-4 h-4" aria-hidden="true" /> : <Sun className="w-4 h-4" aria-hidden="true" />}
                {isLight ? "Dark theme" : "Light theme"}
              </button>
              <button
                role="menuitem"
                onClick={() => { setMoreOpen(false); navigate("/settings"); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Settings className="w-4 h-4" aria-hidden="true" /> Settings
              </button>
            </div>
          )}
        </div>

        {authLoading ? (
          <div className="h-10 w-10" aria-hidden="true" />
        ) : isGuest ? (
          <>
            {devLoginAvailable && <PersonaMenu currentName={user?.name} currentUserId={currentUserId} />}
            <button
              data-testid="header-signin-button"
              onClick={onSignIn}
              title="Sign in with Google to save your work"
              className="h-9 flex items-center gap-2 px-3.5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-xs hover:opacity-90 transition-opacity"
            >
              <LogIn className="w-3.5 h-3.5" /> Sign in
            </button>
          </>
        ) : (
          <>
            {devLoginAvailable && <PersonaMenu currentName={user?.name} currentUserId={currentUserId} />}
        <div className="relative">
          <button
            data-testid="user-menu-trigger"
            onClick={() => setMenuOpen((v) => !v)}
            title="Account"
            className="h-10 w-10 rounded-full overflow-hidden border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
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
                data-testid="user-menu-settings"
                onClick={() => { setMenuOpen(false); navigate("/settings"); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Settings className="w-3.5 h-3.5" aria-hidden="true" /> Settings
              </button>
              <div className="border-t border-[var(--border)]" />
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
          </>
        )}
      </div>
    </header>
  );
}
