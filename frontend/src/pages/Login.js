import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ArrowUpRight } from "lucide-react";

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/coach", { replace: true });
  }, [user, loading, navigate]);

  const signIn = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/coach";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">
      <header className="border-b border-[var(--border)] px-6 sm:px-10 h-16 flex items-center">
        <span className="font-display font-bold tracking-tight text-lg">GoalCoach</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">v1 · founder build</span>
      </header>

      <main className="flex-1 flex items-center px-6 sm:px-10">
        <div className="max-w-2xl mx-auto w-full gc-fade-up">
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent)] mb-6">
            think through your goals, out loud.
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]">
            A coach that reasons across every horizon you're holding at once.
          </h1>
          <p className="mt-6 text-sm sm:text-base leading-relaxed text-[var(--text-secondary)] max-w-xl">
            You're running a 6-month pivot, a 12-month rebuild, a side project, a relationship goal.
            Each one makes sense alone. What doesn't is what deserves attention this week, what's
            blocking what, and what you promised yourself last Tuesday at 11pm. GoalCoach holds all
            of it, remembers across sessions, and tells you the honest thing — not the warm thing.
          </p>

          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <button
              data-testid="google-signin-button"
              onClick={signIn}
              className="group inline-flex items-center gap-3 bg-[var(--text-primary)] text-[var(--bg-primary)] px-6 py-3.5 rounded-none font-medium text-sm hover:opacity-90 transition-opacity"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
              <ArrowUpRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
            <p className="mt-4 font-mono text-[11px] text-[var(--text-muted)] max-w-md leading-relaxed">
              Google is the only way in — no passwords, no email/magic links. Your conversation and
              tracked state persist across sessions.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
