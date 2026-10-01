import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? decodeURIComponent(match[1]) : null;

    if (!sessionId) {
      navigate("/", { replace: true });
      return;
    }

    (async () => {
      try {
        const { user } = await api.session(sessionId);
        setUser(user);
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/", { replace: true, state: { user } });
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]" data-testid="auth-callback">
      <div className="text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">
          {error ? "auth failed" : "establishing session"}
        </div>
        {error && <div className="mt-2 text-sm text-[var(--danger)]">{error}</div>}
      </div>
    </div>
  );
}
