import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Info, LogIn, Settings, Menu, X, Sun, Moon } from "lucide-react";
import Logo from "./Logo";
import PersonaMenu from "./PersonaMenu";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";
import { SCREENS, screenKeyFromSearch } from "../constants/screens";

// Header — top-level navigation. The model switcher and audit
// buttons used to live here, but both duplicate surface in /settings
// (see Settings.jsx). The header now keeps only what's used on every
// route: navigation, theme toggle (persisted), account, About, and the
// entry point to /settings itself. Settings has exactly ONE surface per
// breakpoint: the secondary cluster on desktop (≥640px) and the
// hamburger drawer below it — the drawer is a collapse of that same
// cluster and is the app's primary nav on mobile. It used to also sit
// in the avatar menu, which gave signed-in users two gears at once;
// that duplicate is gone. The cluster/drawer pair is what guarantees
// every state has a path to /settings, since guests never render the
// avatar menu.
export default function Header({ user, authLoading, onOpenChat, onOpenAbout, onSignIn, onLogout, devLoginAvailable = false, currentUserId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const accountTriggerRef = useRef(null);
  const activeScreenKey = screenKeyFromSearch(location.search);
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
  // also writes the class when the user toggles there). The same
  // observer keeps the mobile browser chrome (address bar / status bar
  // tint) following the toggle — a static theme-color would go stale
  // the moment the user switches to dark.
  useEffect(() => {
    const syncThemeColor = () => {
      const light = document.documentElement.classList.contains("light");
      const color = light ? "#FBF6EF" : "#17120E";
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", color);
    };
    syncThemeColor();
    const mo = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
      syncThemeColor();
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
      // The drawer lives in a Radix portal (outside rootRef) but owns its
      // own dismissal — Escape, overlay click, focus trap — so only the
      // avatar menu is handled here.
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // B2#4 — Escape closes the avatar menu and returns focus to its
  // trigger (the custom menu had neither; it only closed on outside
  // mousedown). Mirrors the established pattern in ChatModeSelect /
  // Sources / TodayTimetable, plus the focus return.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      accountTriggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Any navigation (drawer link, tab strip, browser back while the
  // drawer is open) should never leave the drawer sitting over a screen
  // the user has left.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname, location.search]);

  // Shared row style for the drawer's nav items: ≥44px targets, gap-2
  // between them comes from the list container (B1#9), and the active
  // screen is marked with aria-current="page" rather than colour alone.
  const drawerItem = (active) =>
    `min-h-11 flex items-center gap-3 px-3 rounded-md text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
      active
        ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
    }`;

  return (
    <header
      data-testid="app-header"
      className="min-h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_85%,transparent)] backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50"
    >
      {/* The whole lockup is the home affordance — tapping the mark or the
          wordmark always lands on the canonical screen (Goals), on every
          route including /settings. Re-tapping while already home is a
          no-op so we never stack a duplicate history entry. */}
      <Link
        to="/"
        data-testid="header-home-link"
        title="Sutra — go to home"
        className="flex items-center gap-2.5 min-w-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Logo className="w-7 h-7 text-[var(--accent)] shrink-0" />
        <h1 className="font-display font-bold tracking-tight text-base sm:text-lg">Sutra</h1>
        <span className="hidden md:inline text-xs text-[var(--text-muted)] truncate">
          Let's sort your life — together.
        </span>
      </Link>

      <div ref={rootRef} className="ml-auto flex items-center gap-2">
        {/* Desktop secondary controls — a labelled nav landmark (B2#5),
            8px between targets (B1#9). */}
        <nav aria-label="Primary" className="hidden sm:flex items-center gap-2">
          <button
            data-testid="open-about-button"
            onClick={onOpenAbout}
            title="About Sutra, privacy & the founder"
            aria-label="About Sutra, privacy and the founder"
            className="h-11 w-11 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <Info className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            data-testid="header-theme-toggle"
            onClick={toggleTheme}
            title={isLight ? "Switch to dark theme" : "Switch to light theme"}
            aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
            aria-pressed={isLight}
            className="h-11 w-11 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            {isLight ? <Moon className="w-4 h-4" aria-hidden="true" /> : <Sun className="w-4 h-4" aria-hidden="true" />}
          </button>
          {/* Settings is the only route destination in this cluster, and
              the mobile drawer below is literally a collapse of these
              controls — so it has to be here too, or a desktop guest has no
              path to /settings at all (guests never render the avatar menu). */}
          <button
            data-testid="header-settings-button"
            onClick={() => navigate("/settings")}
            title="Settings"
            aria-label="Settings"
            className="h-11 w-11 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
          </button>
        </nav>

        {/* Mobile primary nav — a Radix sheet (Dialog), so Escape, the
            focus trap and focus-return to the trigger all come free.
            Replaces the old custom `div role="menu"` popup (B2#4): it
            had no Escape, no focus management, and only collapsed the
            secondary controls. Now it's the app's primary nav on mobile —
            every screen plus the secondary cluster in one vertical list,
            `<nav>` landmark, aria-current on the active screen, gap-2
            between targets (B1#9). */}
        <div className="sm:hidden">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                data-testid="header-more-button"
                aria-label="Menu"
                title="Menu"
                className="h-11 w-11 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
              >
                {moreOpen ? <X className="w-4 h-4" aria-hidden="true" /> : <Menu className="w-4 h-4" aria-hidden="true" />}
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              aria-describedby={undefined}
              className="p-0 w-72 sm:max-w-72 bg-[var(--bg-secondary)] text-[var(--text-primary)] [&>button]:hidden"
            >
              <div className="flex h-full flex-col overflow-y-auto">
                <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
                  <SheetTitle className="text-sm">Menu</SheetTitle>
                  {/* 44px close target — replaces SheetContent's built-in
                      16px X (hidden via [&>button]:hidden above); SheetClose
                      still gives Radix's focus-return to the hamburger. */}
                  <SheetClose
                    aria-label="Close menu"
                    className="h-11 w-11 -mr-2 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </SheetClose>
                </div>
                <nav aria-label="Primary" className="flex flex-col gap-2 px-4 py-3">
                  {SCREENS.map((s) => {
                    const Icon = s.Icon;
                    const active = s.key === activeScreenKey;
                    return (
                      <Link
                        key={s.key}
                        to={s.to}
                        aria-current={active ? "page" : undefined}
                        data-testid={`nav-${s.key}`}
                        onClick={(e) => {
                          // Re-tapping the current screen just closes the
                          // drawer — never stack duplicate history entries.
                          if (active) e.preventDefault();
                          setMoreOpen(false);
                        }}
                        className={drawerItem(active)}
                      >
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {s.label}
                      </Link>
                    );
                  })}

                  <div className="border-t border-[var(--border)] my-1" aria-hidden="true" />

                  <Link
                    to="/settings"
                    data-testid="nav-settings"
                    onClick={() => setMoreOpen(false)}
                    className={drawerItem(false)}
                  >
                    <Settings className="w-4 h-4 shrink-0" aria-hidden="true" />
                    Settings
                  </Link>
                  <button
                    onClick={() => { onOpenAbout(); setMoreOpen(false); }}
                    className={drawerItem(false)}
                  >
                    <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                    About Sutra
                  </button>
                  <button
                    onClick={toggleTheme}
                    aria-pressed={isLight}
                    className={drawerItem(false)}
                  >
                    {isLight ? <Moon className="w-4 h-4 shrink-0" aria-hidden="true" /> : <Sun className="w-4 h-4 shrink-0" aria-hidden="true" />}
                    {isLight ? "Dark theme" : "Light theme"}
                  </button>
                  {!authLoading && isGuest && (
                    <button
                      onClick={() => { onSignIn(); setMoreOpen(false); }}
                      className={drawerItem(false)}
                    >
                      <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Sign in
                    </button>
                  )}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {authLoading ? (
          <div className="h-11 w-11" aria-hidden="true" />
        ) : isGuest ? (
          <>
            {devLoginAvailable && <PersonaMenu currentName={user?.name} currentUserId={currentUserId} />}
            <button
              data-testid="header-signin-button"
              onClick={onSignIn}
              title="Sign in with Google to save your work"
              aria-label="Sign in with Google to save your work"
              className="h-11 flex items-center gap-2 px-3.5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-xs hover:opacity-90 transition-opacity"
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
            ref={accountTriggerRef}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Account"
            className="h-11 w-11 rounded-full overflow-hidden border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {user?.picture ? (
              <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <span className="flex items-center justify-center w-full h-full text-xs">{user?.name?.[0] || "?"}</span>
            )}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50">
              <div className="px-3 py-2.5 border-b border-[var(--border)]">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">{user?.name}</div>
                <div className="text-xs text-[var(--text-muted)] truncate">{user?.email}</div>
              </div>
              {/* Settings deliberately lives in exactly ONE place — the
                  header cluster on desktop / the hamburger drawer on
                  mobile. It used to be duplicated here, so signed-in
                  users saw two gears at once. Guests never render this
                  menu, so the cluster/drawer stays the guaranteed path. */}
              <button
                data-testid="logout-button"
                onClick={onLogout}
                className="w-full flex items-center gap-2 min-h-11 px-3 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--danger)] transition-colors"
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
