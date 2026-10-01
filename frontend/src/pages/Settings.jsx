import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Sun,
  Moon,
  LogIn,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import Logo from "../components/Logo";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import HonestyAuditView from "../components/HonestyAuditView";

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
  const { user, setUser, logout } = useAuth();
  const isGuest = !user || user.is_guest;

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

  const providers = useProviders();
  const cur = providers.find((p) => p.id === provider);
  const displayLabel = cur?.label || provider || "…";
  const displayModel = cur?.model || "";

  // Theme toggle lives in the main header now — see Header.js.

  const changeProvider = async (p) => {
    setProvider(p);
    try {
      await api.setProvider(p);
      setUser((u) => (u ? { ...u, model_provider: p } : u));
      toast.success(`Model switched to ${p}`);
    } catch {
      toast.error("Could not switch model");
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
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      {/* Minimal settings header — back nav, logo, theme */}
      <header className="h-16 shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_85%,transparent)] backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50">
        <button
          onClick={() => navigate("/")}
          title="Back to Coach"
          className="flex items-center gap-2 h-9 px-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Coach</span>
        </button>

        <div className="w-px h-5 bg-[var(--border)]" />

        <Logo className="w-6 h-6 text-[var(--accent)] shrink-0" />
        <span className="font-display font-bold tracking-tight text-sm">Settings</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Audit */}
          <button
            onClick={() => setAuditOpen(true)}
            className="h-9 flex items-center gap-1.5 px-2.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">Audit</span>
          </button>

          {/* Theme toggle lives in the main header (Coach.js) so it's
              reachable on every page; this Settings page no longer
              duplicates it. */}
          {/* Sign in / out */}
          {isGuest ? (
            <button
              onClick={() => navigate("/")}
              className="h-9 flex items-center gap-2 px-3.5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-xs hover:opacity-90 transition-opacity"
            >
              <LogIn className="w-3.5 h-3.5" /> Sign in
            </button>
          ) : (
            <button
              onClick={doLogout}
              className="h-9 flex items-center gap-2 px-3.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] font-medium text-xs transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          )}
        </div>
      </header>

      {/* Settings content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          <Tabs defaultValue="coach">
            <TabsList className="mb-6 w-full justify-start border-b border-[var(--border)] rounded-none bg-transparent p-0 h-auto gap-0">
              <TabsTrigger
                value="coach"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent shadow-none text-xs font-mono uppercase tracking-widest px-4 py-2.5"
              >
                Coach
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent shadow-none text-xs font-mono uppercase tracking-widest px-4 py-2.5"
              >
                Account
              </TabsTrigger>
              <TabsTrigger
                value="audit"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent shadow-none text-xs font-mono uppercase tracking-widest px-4 py-2.5"
              >
                Audit
              </TabsTrigger>
            </TabsList>

            {/* Coach tab — model, persona, honesty tone */}
            <TabsContent value="coach" className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">Model</h3>
                <div className="space-y-2">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => changeProvider(p.id)}
                      className={`w-full flex items-center justify-between px-4 py-3 border rounded-lg transition-colors ${
                        p.id === provider
                          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]"
                          : "border-[var(--border)] hover:border-[var(--border-accent)]"
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="font-mono text-[11px] text-[var(--text-muted)]">{p.model}</div>
                      </div>
                      {p.id === provider && (
                        <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            </TabsContent>

            {/* Account tab — sign in/out (theme moved to main header) */}
            <TabsContent value="account" className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">Session</h3>
                {isGuest ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      You're using a preview session. Log in to persist this session and access all advanced features.
                    </p>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      Sign in with Google to migrate this session to your account.
                    </p>
                    <button
                      onClick={() => navigate("/")}
                      className="h-10 px-5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-sm hover:opacity-90 transition-opacity"
                    >
                      Sign in with Google →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-lg">
                      {user?.picture ? (
                        <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs font-mono">
                          {user?.name?.[0] || "?"}
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-medium">{user?.name}</div>
                        <div className="font-mono text-[11px] text-[var(--text-muted)]">{user?.email}</div>
                      </div>
                    </div>
                    <button
                      onClick={doLogout}
                      className="h-10 px-5 border border-[var(--border)] hover:border-[var(--danger)] text-[var(--text-secondary)] hover:text-[var(--danger)] font-medium text-sm transition-colors"
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
                className="h-10 px-5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] font-medium text-sm hover:text-[var(--text-primary)] transition-colors"
              >
                Open Honesty Audit ↗
              </button>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
