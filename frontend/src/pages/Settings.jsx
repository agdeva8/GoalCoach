import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Sun,
  Moon,
  LogIn,
  LogOut,
  ShieldCheck,
  Check,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import Logo from "../components/Logo";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import useMediaQuery from "../hooks/useMediaQuery";
import HonestyAuditView from "../components/HonestyAuditView";

// Settings sections. Mobile renders them as a vertical list (the
// horizontal tab strip only makes room below 640px) — see the Tabs
// markup below. Trigger styling: below sm each row gets a left accent
// rail + tinted active background; from sm up it's the original
// bottom-border tab strip, byte-for-byte.
const SECTION_TAB_TRIGGER =
  "font-medium rounded-none text-xs px-4 text-left w-full justify-start whitespace-nowrap " +
  "py-3 border-l-2 border-transparent shadow-none " +
  "data-[state=active]:border-[var(--accent)] " +
  "data-[state=active]:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] " +
  "sm:w-auto sm:justify-center sm:py-2.5 sm:border-l-0 sm:border-b-2 " +
  "sm:data-[state=active]:bg-transparent";

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
  const isDesktop = useMediaQuery("(min-width: 640px)");

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
          {/* Audit — the label is `hidden sm:inline`, so below 640px this
              is an icon-only control and needs its own accessible name. */}
          <button
            onClick={() => setAuditOpen(true)}
            aria-label="Honesty audit"
            className="h-11 flex items-center gap-1.5 px-2.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">Honesty audit</span>
          </button>

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
          <Tabs defaultValue="coach" orientation={isDesktop ? "horizontal" : "vertical"}>
            <TabsList className="mb-6 w-full flex-col justify-start rounded-none bg-transparent p-0 h-auto gap-1 border-[var(--border)] sm:flex-row sm:gap-0 sm:border-b">
              <TabsTrigger value="coach" className={SECTION_TAB_TRIGGER}>
                Coach
              </TabsTrigger>
              <TabsTrigger value="account" className={SECTION_TAB_TRIGGER}>
                Account
              </TabsTrigger>
              <TabsTrigger value="audit" className={SECTION_TAB_TRIGGER}>
                Honesty audit
              </TabsTrigger>
            </TabsList>

            {/* Coach tab — model, persona, honesty tone */}
            <TabsContent value="coach" className="space-y-6">
              <section className="space-y-4">
                <h2 className="font-medium text-xs text-[var(--text-muted)]">Model</h2>
                <div
                  className="space-y-2"
                  style={{ position: "relative", zIndex: 1 }}
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
                      className={`w-full flex items-center justify-between px-4 py-3 border rounded-lg transition-colors disabled:opacity-60 touch-manipulation ${
                        p.id === provider
                          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]"
                          : "border-[var(--border)] hover:border-[var(--border-accent)]"
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="text-xs text-[var(--text-muted)]">{p.model}</div>
                      </div>
                      {p.id === provider && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)]">
                          <Check className="w-4 h-4" aria-hidden="true" />
                          <span className="sr-only">Selected: </span>Current
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            </TabsContent>

            {/* Account tab — sign in/out (theme moved to main header) */}
            <TabsContent value="account" className="space-y-6">
              <section className="space-y-4">
                <h2 className="font-medium text-xs text-[var(--text-muted)]">Session</h2>
                {isGuest ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      You're using a preview session. Sign in to keep it and unlock every feature.
                    </p>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      Sign in with Google to migrate this session to your account.
                    </p>
                    <button
                      onClick={leaveSettings}
                      className="h-11 px-5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-sm hover:opacity-90 transition-opacity"
                    >
                      Sign in with Google
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-lg">
                      {user?.picture ? (
                        <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs">
                          {user?.name?.[0] || "?"}
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-medium">{user?.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">{user?.email}</div>
                      </div>
                    </div>
                    <button
                      onClick={doLogout}
                      className="h-11 px-5 border border-[var(--border)] hover:border-[var(--danger)] text-[var(--text-secondary)] hover:text-[var(--danger)] font-medium text-sm transition-colors"
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
                className="h-11 px-5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] font-medium text-sm hover:text-[var(--text-primary)] transition-colors"
              >
                Open the honesty audit
              </button>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
