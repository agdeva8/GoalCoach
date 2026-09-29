import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Sun,
  Moon,
  LogIn,
  LogOut,
  ChevronDown,
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

  const [provider, setProvider] = useState(user?.model_provider || "gemini");
  const [auditOpen, setAuditOpen] = useState(false);

  const providers = useProviders();
  const cur = providers.find((p) => p.id === provider);
  const displayLabel = cur?.label || provider || "…";
  const displayModel = cur?.model || "";

  // Read current theme from the DOM (Coach.js is the single source of truth).
  const [isLight, setIsLight] = useState(() =>
    document.documentElement.classList.contains("light"),
  );
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
    localStorage.setItem("gc_theme", next ? "light" : "dark");
  };

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
    await logout();
    window.location.href = "/";
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      {/* Minimal settings header — back nav, logo, theme */}
      <header className="h-16 shrink-0 border-b border-[var(--border)] bg-[var(--bg-primary)]/85 backdrop-blur-md px-4 sm:px-6 flex items-center gap-4 sticky top-0 z-50">
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
          {/* Model switcher */}
          <div className="relative">
            <button
              title="Switch the coach's model"
              className="flex items-center gap-2 h-9 px-3 border border-[var(--border)] hover:border-[var(--border-accent)] transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              <span className="font-mono text-[11px] uppercase tracking-wider">{displayLabel}</span>
              {displayModel && <span className="font-mono text-[10px] text-[var(--text-muted)] hidden sm:inline">{displayModel}</span>}
              <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
            </button>
            <div className="absolute right-0 mt-1 w-52 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50">
              {providers.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-[var(--text-muted)]">Loading…</div>
              ) : (
                providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => changeProvider(p.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-[var(--bg-tertiary)] border-b border-[var(--border)] last:border-0 transition-colors ${
                      p.id === provider ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    <span className="font-mono uppercase tracking-wider">{p.label}</span>
                    <span className="text-[var(--text-muted)]">{p.model}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Audit */}
          <button
            onClick={() => setAuditOpen(true)}
            className="h-9 flex items-center gap-1.5 px-2.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">Audit</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={isLight ? "Switch to dark" : "Switch to light"}
            className="h-9 w-9 flex items-center justify-center border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] transition-colors"
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

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
                          ? "border-[var(--accent)] bg-[var(--accent)]/5"
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

              <section className="space-y-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">Persona</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  The coach adapts its tone based on the scenario you're in — cold start, returning, routine check-in, or a meta question about your progress.
                  You can pick a scenario from the header or from within the chat.
                </p>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  The persona you pick here sets the default tone for new conversations.
                </p>
              </section>
            </TabsContent>

            {/* Account tab — theme, sign in/out */}
            <TabsContent value="account" className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">Appearance</h3>
                <div className="flex gap-3">
                  <button
                    onClick={toggleTheme}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border rounded-lg transition-colors ${
                      !isLight
                        ? "border-[var(--accent)] bg-[var(--accent)]/5"
                        : "border-[var(--border)] hover:border-[var(--border-accent)]"
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span className="text-sm">Dark</span>
                  </button>
                  <button
                    onClick={toggleTheme}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border rounded-lg transition-colors ${
                      isLight
                        ? "border-[var(--accent)] bg-[var(--accent)]/5"
                        : "border-[var(--border)] hover:border-[var(--border-accent)]"
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span className="text-sm">Light</span>
                  </button>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">Session</h3>
                {isGuest ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      You're using a preview session. Your goals are saved in this browser.
                    </p>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      Sign in with Google to keep your goals across devices and auto-migrate this session.
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
