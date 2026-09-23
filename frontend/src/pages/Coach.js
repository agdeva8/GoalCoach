import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageSquare, LayoutDashboard } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, API } from "../lib/api";
import Header from "../components/Header";
import OnboardingBanner from "../components/OnboardingBanner";
import ChatConsole from "../components/ChatConsole";
import TrackingDashboard from "../components/TrackingDashboard";
import HonestyAuditView from "../components/HonestyAuditView";

export default function Coach() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [state, setState] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [provider, setProvider] = useState(user?.model_provider || "gemini");
  const [theme, setTheme] = useState(() => localStorage.getItem("gc_theme") || "dark");
  const [mobileView, setMobileView] = useState("chat");
  const streamIdRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("gc_theme", theme);
  }, [theme]);

  const refreshState = useCallback(async () => {
    try { setState(await api.state()); } catch (e) { /* noop */ }
  }, []);

  useEffect(() => {
    api.history().then(setMessages).catch(() => {});
    refreshState();
  }, [refreshState]);

  const doLogout = async () => {
    await logout();
    navigate("/", { replace: true });
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

  const onStoryboard = (text) => {
    setInput(text);
    setMobileView("chat");
  };

  const send = async (text) => {
    setSending(true);
    setInput("");
    const localUserId = `local_${Date.now()}`;
    const streamId = `stream_${++streamIdRef.current}`;
    setMessages((prev) => [
      ...prev,
      { id: localUserId, role: "user", content: text, proposals: [] },
      { id: streamId, role: "assistant", content: "", proposals: [], streaming: true },
    ]);

    try {
      const resp = await fetch(`${API}/chat/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
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
          finalId = data.message_id;
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, id: data.message_id, proposals: data.proposals } : m)));
        } else if (data.type === "done") {
          setMessages((prev) => prev.map((m) => (m.id === (finalId || streamId) ? { ...m, id: data.message_id, streaming: false } : m)));
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
      // Safety: clear the streaming caret even if the stream ended without a 'done' event.
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    }
  };

  const confirmProposal = async (messageId, proposalId) => {
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
        onOpenAudit={() => setAuditOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onLogout={doLogout}
        onStoryboard={onStoryboard}
      />
      <OnboardingBanner />

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

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        <div className={`lg:col-span-7 lg:border-r border-[var(--border)] min-h-0 ${mobileView === "chat" ? "flex" : "hidden"} lg:flex`}>
          <div className="w-full h-full min-h-0">
            <ChatConsole
              messages={messages}
              onSend={send}
              sending={sending}
              input={input}
              setInput={setInput}
              onConfirm={confirmProposal}
              onReject={rejectProposal}
              busyProposal={busyProposal}
            />
          </div>
        </div>
        <div className={`lg:col-span-5 min-h-0 overflow-y-auto bg-[var(--bg-primary)] ${mobileView === "state" ? "block" : "hidden"} lg:block`}>
          <TrackingDashboard state={state} />
        </div>
      </div>

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
