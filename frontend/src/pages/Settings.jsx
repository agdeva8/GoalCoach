import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  LogIn,
  LogOut,
  Type,
  Check,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import Logo from "../components/Logo";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import HonestyAuditView from "../components/HonestyAuditView";

// Text size — 5 options, with the 3rd as the product default (16px,
// the platform browser default). The CSS variable `--sutra-font-scale`
// is the same number in px, applied to <html> so every rem-based
// Tailwind text utility scales with it. Persisted to localStorage so
// the choice survives reloads and is restored pre-paint via
// public/index.html — no flash of the previous size on first load.
const FONT_SIZE_OPTIONS = [
  { value: 14, label: "Small", short: "S", hint: "Compact" },
  { value: 15, label: "Default small", short: "S+", hint: "Tight" },
  { value: 16, label: "Medium", short: "M", hint: "Default" },
  { value: 17, label: "Default large", short: "L+", hint: "Comfortable" },
  { value: 18, label: "Large", short: "L", hint: "Easy reading" },
];
const FONT_SIZE_DEFAULT_PX = 16;
const FONT_SIZE_STORAGE_KEY = "sutra_font_size";

// Settings sections render as an iOS-style SEGMENTED CONTROL: a single
// pill track with a raised "selected" segment. Same trigger for every
// breakpoint (the control is `w-full` on phones, auto-width on desktop).
const SECTION_TAB_TRIGGER =
  "flex-1 sm:flex-none font-medium rounded-lg text-[13px] px-3.5 py-1.5 " +
  "text-[var(--text-secondary)] transition-colors whitespace-nowrap " +
  "hover:text-[var(--text-primary)] " +
  "data-[state=active]:bg-[var(--bg-primary)] data-[state=active]:text-[var(--text-primary)] " +
  "data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.12)]";

// iOS grouped inset list: one rounded card, hairline dividers between
// rows, no outer border.
const INSET_LIST = "rounded-2xl bg-[var(--bg-secondary)] overflow-hidden divide-y divide-[var(--border)]";
const INSET_ROW =
  "w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors " +
  "hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)] disabled:opacity-60";
const GROUP_LABEL = "px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";

function useProviders() {
  const [providers, setProviders] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.models().then((r) => {
      if (cancelled || !r?.models) return;
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

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser, logout } = useAuth();
  const isGuest = !user || user.is_guest;

  // Leaving Settings is a *back* action (header back arrow, guest
  // sign-in shortcuts all return to the coach), so pop real history
  // when we have any — that keeps App.js' ViewTransition direction
  // (POP → nav-back) correct. Guarded for a direct load of /settings,
  // where popping would walk out of the app: replace with the coach
  // screen instead.
  const leaveSettings = () => {
    if (location.key === "default") navigate("/", { replace: true });
    else navigate(-1);
  };

  // Model provider — must re-sync when the user loads. The first
  // render usually runs before AuthContext resolves (user is null),
  // so we keep provider in state but mirror user.model_provider
  // whenever the user object changes.
  const [provider, setProvider] = useState(user?.model_provider || "gemini");
  useEffect(() => {
    if (user?.model_provider && user.model_provider !== provider) {
      setProvider(user.model_provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id, user?.model_provider]);

  const [auditOpen, setAuditOpen] = useState(false);
  // B3#15 — in-flight provider switch; disables the list + lets the
  // catch below revert the optimistic selection.
  const [switchingProvider, setSwitchingProvider] = useState(false);

  // Text size — read from localStorage at mount (the index.html
  // pre-paint script already applied it to <html>, so this only
  // drives the Settings control). Falls back to the 3rd option
  // (16px) which matches the product default — see FONT_SIZE_OPTIONS.
  const [fontSizePx, setFontSizePx] = useState(() => {
    try {
      const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && FONT_SIZE_OPTIONS.some((o) => o.value === parsed)) {
        return parsed;
      }
    } catch { /* localStorage blocked — keep default */ }
    return FONT_SIZE_DEFAULT_PX;
  });

  // Apply the choice live: write to the CSS variable on <html>
  // (the variable `index.css` reads as the root font-size, so every
  // rem-based Tailwind text utility scales together) AND mirror to
  // localStorage so the next reload boots at the same scale with no
  // flash (the index.html pre-paint script does the read side).
  useEffect(() => {
    document.documentElement.style.setProperty("--sutra-font-scale", `${fontSizePx}px`);
    try { window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSizePx)); } catch { /* ignore */ }
  }, [fontSizePx]);

  const providers = useProviders();
  const cur = providers.find((p) => p.id === provider);
  const displayLabel = cur?.label || provider || "…";
  const displayModel = cur?.model || "";

  // Theme toggle lives in the main header now — see Header.js.

  const changeProvider = async (p) => {
    if (p === provider || switchingProvider) return;
    const prev = provider;
    setProvider(p);
    setSwitchingProvider(true);
    try {
      await api.setProvider(p);
      setUser((u) => (u ? { ...u, model_provider: p } : u));
      toast.success(`Model switched to ${p}`);
    } catch {
      // Revert the optimistic selection — the server still has `prev`.
      setProvider(prev);
      toast.error("Couldn't switch the model. Try again.");
    } finally {
      setSwitchingProvider(false);
    }
  };

  const doLogout = async () => {
    // Fire-and-forget the server logout so a slow / hung request
    // can't block the navigation. AuthContext's logout() also clears
    // the in-memory user, which is what gates the redirect.
    logout().catch(() => {});
    // Use replace so the user can't back-button into /settings while
    // signed out.
    window.location.replace("/");
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <a
        href="#main"
        data-testid="skip-link"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[70] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded focus:bg-[var(--accent)] focus:text-[var(--bg-primary)] focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <header className="min-h-16 shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_85%,transparent)] backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50 py-2">
        <button
          onClick={leaveSettings}
          title="Back to Coach"
          aria-label="Back to Coach"
          className="flex items-center gap-2 h-11 px-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Coach</span>
        </button>

        <div className="w-px h-5 bg-[var(--border)]" />

        <Logo className="w-6 h-6 text-[var(--accent)] shrink-0" />
        <h1 className="font-bold tracking-tight text-sm">Settings</h1>

        {/* B2#5 — labelled landmark for the account/session cluster. */}
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          {/* The honesty audit shortcut used to live here as a duplicate
              of the dedicated Audit tab inside the page (where it still
              lives). One canonical surface per breakpoint, matching the
              pattern Header.js establishes: the Settings cog is the entry
              point, the Audit tab inside Settings is the audit surface. */}
          {/* Theme toggle lives in the main header (Coach.js) so it's
              reachable on every page; this Settings page no longer
              duplicates it. */}
          {/* Sign in / out */}
          {isGuest ? (
            <button
              onClick={leaveSettings}
              className="h-11 flex items-center gap-2 px-3.5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-xs hover:opacity-90 transition-opacity"
            >
              <LogIn className="w-3.5 h-3.5" /> Sign in
            </button>
          ) : (
            <button
              onClick={doLogout}
              className="h-11 flex items-center gap-2 px-3.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] font-medium text-xs transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          )}
        </nav>
      </header>

      {/* Settings content */}
      <main id="main" tabIndex={-1} className="flex-1 min-h-0 overflow-y-auto focus:outline-none">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          {/* Mobile: sections are a vertical list (founder directive —
              horizontal rows become vertical below sm). Desktop keeps
              the original horizontal strip. `orientation` keeps Radix's
              arrow-key semantics (aria-orientation) matching whichever
              layout is visible. */}
          <Tabs defaultValue="coach">
            {/* iOS segmented control. */}
            <TabsList className="mb-6 w-full sm:w-auto inline-flex p-[3px] bg-[var(--bg-tertiary)] rounded-[11px] gap-0.5">
              <TabsTrigger value="coach" className={SECTION_TAB_TRIGGER}>
                Coach
              </TabsTrigger>
              <TabsTrigger value="preferences" className={SECTION_TAB_TRIGGER}>
                Preferences
              </TabsTrigger>
              <TabsTrigger value="account" className={SECTION_TAB_TRIGGER}>
                Account
              </TabsTrigger>
              <TabsTrigger value="audit" className={SECTION_TAB_TRIGGER}>
                Audit
              </TabsTrigger>
            </TabsList>

            {/* Coach tab — model, persona, honesty tone */}
            <TabsContent value="coach" className="space-y-7">
              <section>
                <h2 className={GROUP_LABEL}>Model</h2>
                <div
                  className={INSET_LIST}
                  role="group"
                  aria-label="Model provider"
                  aria-busy={switchingProvider || undefined}
                >
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => changeProvider(p.id)}
                      disabled={switchingProvider}
                      aria-pressed={p.id === provider}
                      className={INSET_ROW}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.label}</div>
                        <div className="text-xs text-[var(--text-muted)] truncate">{p.model}</div>
                      </div>
                      {p.id === provider && (
                        <Check className="w-[18px] h-[18px] shrink-0 text-[var(--accent)]" aria-label="Selected" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="px-1 pt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  The coach writes to your goals only after you confirm a proposal.
                </p>
              </section>
            </TabsContent>

            {/* Preferences tab — display settings (text size). */}
            <TabsContent value="preferences" className="space-y-7">
              <section>
                <div className="flex items-center gap-1.5 px-1 pb-2">
                  <Type className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                  <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Text size</h2>
                </div>
                {/* Same grouped-inset shape as the model list so the page
                    has one consistent selection vocabulary. The right
                    column previews the rendered size. */}
                <div
                  role="radiogroup"
                  aria-label="Text size"
                  className={INSET_LIST}
                  data-testid="text-size-options"
                >
                  {FONT_SIZE_OPTIONS.map((opt) => {
                    const selected = opt.value === fontSizePx;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setFontSizePx(opt.value)}
                        className={INSET_ROW}
                      >
                        <div className="text-left min-w-0">
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-xs text-[var(--text-muted)]">{opt.hint}</div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className="text-[var(--text-muted)] tabular-nums"
                            style={{ fontSize: `clamp(12px, ${opt.value}px, 18px)` }}
                            aria-hidden="true"
                          >
                            Aa
                          </span>
                          {selected && (
                            <Check className="w-[18px] h-[18px] text-[var(--accent)]" aria-label="Selected" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </TabsContent>

            {/* Account tab — sign in / out. */}
            <TabsContent value="account" className="space-y-7">
              <section>
                <h2 className={GROUP_LABEL}>Session</h2>
                {isGuest ? (
                  <div className="rounded-2xl bg-[var(--bg-secondary)] p-4 space-y-3">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      You're using a preview session. Sign in to keep it and unlock every feature — Google sign-in migrates this session to your account.
                    </p>
                    <button
                      onClick={leaveSettings}
                      className="h-11 w-full rounded-xl bg-[var(--accent)] text-[var(--bg-primary)] font-semibold text-sm hover:opacity-90 transition-opacity"
                    >
                      Sign in with Google
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 rounded-2xl bg-[var(--bg-secondary)] px-4 py-3.5">
                      {user?.picture ? (
                        <img src={user.picture} alt={user.name} className="w-11 h-11 rounded-full object-cover" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm">
                          {user?.name?.[0] || "?"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{user?.name}</div>
                        <div className="text-xs text-[var(--text-muted)] truncate">{user?.email}</div>
                      </div>
                    </div>
                    <button
                      onClick={doLogout}
                      className="h-11 w-full rounded-xl bg-[var(--bg-secondary)] text-[var(--danger)] font-semibold text-sm hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </section>
            </TabsContent>

            {/* Audit tab */}
            <TabsContent value="audit">
              <button
                onClick={() => setAuditOpen(true)}
                className={INSET_ROW + " rounded-2xl bg-[var(--bg-secondary)]"}
              >
                <span className="text-sm font-medium">Open the honesty audit</span>
                <span className="text-[var(--text-muted)]">›</span>
              </button>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
