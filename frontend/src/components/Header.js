import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, History, Info, LogIn, Settings, Menu, X } from "lucide-react";
import Logo from "./Logo";
import PersonaMenu from "./PersonaMenu";
import { api } from "../lib/api";

// Fetch the LLM provider list from the backend (single source of truth)
// so labels can't drift from the registry. While the fetch is in flight
// we render a disabled placeholder rather than nothing — keeps the
// dropdown reachable on every page.
function useProviders() {
  const [providers, setProviders] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.models().then((r) => {
      if (cancelled || !r?.models) return;
      // Backend shape: { value, label, hint }. Normalize to the
      // {id, label, model} the dropdown uses.
      setProviders(
        r.models.map((m) => ({
          id: m.value,
          label: m.label,
          model: m.hint || m.model || "",
        })),
      );
    }).catch(() => {
      if (!cancelled) setProviders([]);
    });
    return () => { cancelled = true; };
  }, []);
  return providers;
}

export default function Header({ user, authLoading, provider, onProvider, onOpenChat, onOpenAudit, onOpenAbout, onSignIn, onLogout, devLoginAvailable = false, currentUserId }) {
  const navigate = useNavigate();
  const [provOpen, setProvOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const providers = useProviders();
  const cur = providers.find((p) => p.id === provider);
  // Fall back to a stable placeholder when the providers list hasn't
  // loaded yet (or is empty) — keeps the trigger button renderable
  // and avoids a `.label` crash on undefined.
  const displayLabel = cur?.label || provider || "…";
  const displayModel = cur?.model || "";
  const isGuest = !user || user.is_guest;
  const rootRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setProvOpen(false);
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
      className="h-16 shrink-0 border-b border-[var(--border)] bg-[var(--bg-primary)]/85 backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Logo className="w-7 h-7 text-[var(--accent)] shrink-0" />
        <span className="font-display font-bold tracking-tight text-base sm:text-lg">Sutra</span>
        <span className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] truncate">
          let's sort your life — together.
        </span>
      </div>

      <div ref={rootRef} className="ml-auto flex items-center gap-2">
        {/* Settings cog — /settings route ships in Slice 2. */}
        <button
          data-testid="open-settings-button"
          onClick={() => navigate("/settings")}
          title="Settings"
          className="h-11 sm:h-9 w-11 sm:w-9 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Model provider switcher */}
        <div className="relative">
          <button
            data-testid="model-switcher-trigger"
            onClick={() => { setProvOpen((v) => !v); setMenuOpen(false); }}
            title="Switch the coach's model"
            className="flex items-center gap-2 h-11 sm:h-9 px-3 border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-primary)]">{displayLabel}</span>
            {displayModel && <span className="font-mono text-[10px] text-[var(--text-muted)] hidden sm:inline">{displayModel}</span>}
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          </button>
          {provOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50" data-testid="model-switcher-menu">
              {providers.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-[var(--text-muted)]">Loading…</div>
              ) : (
                providers.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`model-option-${p.id}`}
                    onClick={() => { onProvider(p.id); setProvOpen(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-[var(--bg-tertiary)] border-b border-[var(--border)] last:border-0 transition-colors ${p.id === provider ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span className="font-mono uppercase tracking-wider">{p.label}</span>
                    <span className="text-[var(--text-muted)]">{p.model}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Secondary controls — visible on desktop, collapsed behind "more" on mobile */}
        <div className="hidden sm:flex items-center gap-2">
          <button
            data-testid="open-about-button"
            onClick={onOpenAbout}
            title="About Sutra, privacy & the founder"
            className="h-9 w-9 items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <Info className="w-4 h-4" />
          </button>
          <button
            data-testid="open-audit-button"
            onClick={onOpenAudit}
            title="Every change the coach made — timestamped and exportable"
            className="h-9 flex items-center gap-1.5 px-2.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <History className="w-4 h-4" /> <span className="text-xs">Audit</span>
          </button>
        </div>

        {/* Mobile "more" menu — toggles secondary controls */}
        <div className="relative sm:hidden">
          <button
            data-testid="header-more-button"
            onClick={() => setMoreOpen((v) => !v)}
            title="More options"
            className="h-9 w-9 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {moreOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          {moreOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50 py-1">
              <button
                onClick={() => { onOpenAbout(); setMoreOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Info className="w-4 h-4" /> About Sutra
              </button>
              <button
                onClick={() => { onOpenAudit(); setMoreOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <History className="w-4 h-4" /> Audit log
              </button>
              <button
                onClick={() => { setMoreOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Settings className="w-4 h-4" /> Settings
              </button>
            </div>
          )}
        </div>

        {authLoading ? (
          <div className="h-9 w-9" aria-hidden="true" />
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
            onClick={() => { setMenuOpen((v) => !v); setProvOpen(false); }}
            title="Account"
            className="h-11 sm:h-9 w-11 sm:w-9 rounded-full overflow-hidden border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
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
          </>
        )}
      </div>
    </header>
  );
}
