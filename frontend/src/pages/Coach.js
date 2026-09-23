import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { MessageSquare, LayoutDashboard, CalendarClock, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, API } from "../lib/api";
import Header from "../components/Header";
import OnboardingBanner from "../components/OnboardingBanner";
import ChatConsole from "../components/ChatConsole";
import TrackingDashboard from "../components/TrackingDashboard";
import Timeline from "../components/Timeline";
import HonestyAuditView from "../components/HonestyAuditView";
import SignInModal from "../components/SignInModal";
import AboutModal from "../components/AboutModal";

export default function Coach() {
  const { user, setUser, loading, logout } = useAuth();
  const isGuest = !loading && !user;

  const [messages, setMessages] = useState([]);
  const [state, setState] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [theme, setTheme] = useState(() => localStorage.getItem("gc_theme") || "dark");
  const [mobileView, setMobileView] = useState("chat");
  const [panelView, setPanelView] = useState("state");
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const streamIdRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("gc_theme", theme);
  }, [theme]);

  const refreshState = useCallback(async () => {
    try { setState(await api.state()); } catch (e) { /* noop */ }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (user) {
      setProvider(user.model_provider || "gemini");
      api.history().then(setMessages).catch(() => {});
      refreshState();
    }
  }, [loading, user, refreshState]);

  const doLogout = async () => {
    await logout();
    setMessages([]);
    setState(null);
    window.location.href = "/";
  };

  const openSignIn = () => setSignInOpen(true);

  const changeProvider = async (p) => {
    setProvider(p);
    if (isGuest) { toast.message(`Preview using ${p}`); return; }
    try {
      await api.setProvider(p);
      setUser((u) => (u ? { ...u, model_provider: p } : u));
      toast.success(`Model switched to ${p}`);
    } catch {
      toast.error("Could not switch model");
    }
  };

  const onStoryboard = (text) => {
    setInput(text);
    setMobileView("chat");
  };

  const prefill = (text) => {
    setInput(text);
    setMobileView("chat");
  };

  const refineProposal = (proposal, thought) => {
    const name = proposal.title || proposal.new_title || proposal.goal_title || proposal.text || "";
    const label = (proposal.action || "change").replace(/_/g, " ");
    send(`About your proposed ${label}${name ? ` ("${name}")` : ""}: ${thought}. Please re-propose it with that taken into account.`);
  };

  const send = async (text) => {
    setSending(true);
    setInput("");
    const localUserId = `local_${Date.now()}`;
    const streamId = `stream_${++streamIdRef.current}`;
    const priorHistory = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { id: localUserId, role: "user", content: text, proposals: [] },
      { id: streamId, role: "assistant", content: "", proposals: [], streaming: true },
    ]);

    try {
      const endpoint = isGuest ? `${API}/chat/guest_stream` : `${API}/chat/stream`;
      const payload = isGuest ? { message: text, history: priorHistory, auto_answer: autoAnswer } : { message: text, auto_answer: autoAnswer };
      const resp = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok || !resp.body) throw new Error("stream failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalId = null;

      const handle = (data) => {
        if (data.type === "delta") {
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, content: m.content + data.content } : m)));
        } else if (data.type === "tools") {
          finalId = isGuest ? streamId : data.message_id;
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, id: finalId, proposals: data.proposals } : m)));
        } else if (data.type === "done") {
          const newId = isGuest ? (finalId || streamId) : data.message_id;
          setMessages((prev) => prev.map((m) => (m.id === (finalId || streamId) ? { ...m, id: newId, streaming: false } : m)));
        } else if (data.type === "error") {
          toast.error(data.content || "Model error");
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, streaming: false, content: m.content || "(no response)" } : m)));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (raw.startsWith("data: ")) {
            try { handle(JSON.parse(raw.slice(6))); } catch {}
          }
        }
      }
    } catch (e) {
      toast.error("Connection interrupted");
    } finally {
      setSending(false);
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    }
  };

  const confirmProposal = async (messageId, proposalId) => {
    if (isGuest) { setSignInOpen(true); return; }
    setBusyProposal(proposalId);
    try {
      const { result, state: newState } = await api.confirm(messageId, proposalId);
      setState(newState);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "confirmed" } : p)) }
            : m
        )
      );
      toast.success(result);
    } catch (e) {
      toast.error(e.message || "Could not apply");
    } finally {
      setBusyProposal(null);
    }
  };

  const rejectProposal = async (messageId, proposalId) => {
    if (isGuest) { setSignInOpen(true); return; }
    setBusyProposal(proposalId);
    try {
      await api.reject(messageId, proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "rejected" } : p)) }
            : m
        )
      );
    } catch (e) {
      toast.error(e.message || "Could not reject");
    } finally {
      setBusyProposal(null);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <Header
        user={user}
        provider={provider}
        onProvider={changeProvider}
        onOpenAudit={() => (isGuest ? setSignInOpen(true) : setAuditOpen(true))}
        onOpenAbout={() => setAboutOpen(true)}
        onSignIn={openSignIn}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onLogout={doLogout}
        onStoryboard={onStoryboard}
      />
      <OnboardingBanner />

      {isGuest && (
        <div data-testid="guest-banner" className="border-b border-[var(--border)] bg-[var(--accent)]/10 px-4 sm:px-6 py-2 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">preview</span>
          <span className="text-xs text-[var(--text-secondary)] flex-1">
            You're trying GoalCoach — chat freely. Sign in to save goals, build your timeline, and be remembered next week.
          </span>
          <button data-testid="guest-banner-signin" onClick={openSignIn} className="text-xs font-medium text-[var(--accent)] hover:underline shrink-0">
            Sign in →
          </button>
        </div>
      )}

      {/* Mobile view switch */}
      <div className="lg:hidden flex border-b border-[var(--border)] shrink-0">
        <button
          data-testid="mobile-tab-chat"
          onClick={() => setMobileView("chat")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${mobileView === "chat" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)]"}`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </button>
        <button
          data-testid="mobile-tab-state"
          onClick={() => setMobileView("state")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${mobileView === "state" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)]"}`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" /> State
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 relative">
        {rightCollapsed && (
          <button
            data-testid="panel-restore-button"
            onClick={() => setRightCollapsed(false)}
            title="Show goals & timeline"
            className="hidden lg:flex absolute top-2 right-2 z-20 items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-accent)] text-xs text-[var(--text-secondary)]"
          >
            <PanelRightOpen className="w-4 h-4" /> Panel
          </button>
        )}
        <div className={`${rightCollapsed ? "lg:col-span-12" : "lg:col-span-7"} lg:border-r border-[var(--border)] min-h-0 ${mobileView === "chat" ? "flex" : "hidden"} lg:flex`}>
          <div className="w-full h-full min-h-0">
            <ChatConsole
              messages={messages}
              onSend={send}
              sending={sending}
              input={input}
              setInput={setInput}
              onConfirm={confirmProposal}
              onReject={rejectProposal}
              onRefine={refineProposal}
              busyProposal={busyProposal}
              autoAnswer={autoAnswer}
              setAutoAnswer={setAutoAnswer}
            />
          </div>
        </div>
        <div className={`lg:col-span-5 min-h-0 overflow-y-auto bg-[var(--bg-primary)] flex flex-col ${mobileView === "state" ? "block" : "hidden"} ${rightCollapsed ? "lg:hidden" : "lg:flex"}`}>
          <div className="shrink-0 flex items-center border-b border-[var(--border)] px-4 sm:px-6 pt-3">
            <button
              data-testid="panel-tab-state"
              onClick={() => setPanelView("state")}
              className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${panelView === "state" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" /> Goals
            </button>
            <button
              data-testid="panel-tab-timeline"
              onClick={() => setPanelView("timeline")}
              className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${panelView === "timeline" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
            >
              <CalendarClock className="w-3.5 h-3.5" /> Timeline
            </button>
            <button
              data-testid="panel-collapse-button"
              onClick={() => setRightCollapsed(true)}
              title="Collapse panel"
              className="ml-auto hidden lg:flex items-center px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isGuest ? (
              <div className="p-6">
                <div className="border border-dashed border-[var(--border)] p-6 text-center rounded-md">
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    Your goals and timeline appear here once you sign in. In preview, the coach can still
                    synthesize and propose changes — confirming one will ask you to sign in.
                  </p>
                  <button onClick={openSignIn} className="mt-3 text-xs font-medium text-[var(--accent)] hover:underline">
                    Sign in to start tracking →
                  </button>
                </div>
              </div>
            ) : panelView === "state" ? (
              <TrackingDashboard state={state} onPrefill={prefill} />
            ) : (
              <Timeline state={state} onPrefill={prefill} />
            )}
          </div>
        </div>
      </div>

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
