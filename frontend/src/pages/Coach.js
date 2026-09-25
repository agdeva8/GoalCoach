import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { MessageSquare, LayoutDashboard, CalendarClock, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, GripVertical } from "lucide-react";
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
import ActionPromptModal from "../components/ActionPromptModal";
import SourceActionDialog from "../components/SourceActionDialog";
import GoalBoundaryConfirmDialog from "../components/GoalBoundaryConfirmDialog";

export default function Coach() {
  const { user, setUser, loading, logout } = useAuth();
  const isGuest = !!user?.is_guest;

  const [messages, setMessages] = useState([]);
  const [state, setState] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  const [provider, setProvider] = useState("gemini");
  const [theme, setTheme] = useState(() => localStorage.getItem("gc_theme") || "dark");
  const [mobileView, setMobileView] = useState("chat");
  const [panelView, setPanelView] = useState("state");
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [grillMe, setGrillMe] = useState(false);
  const [pendingClarifications, setPendingClarifications] = useState(null);
  const [sourceDialogMode, setSourceDialogMode] = useState(null); // null | "link" | "upload"
  const [sourceDialogSource, setSourceDialogSource] = useState(null);
  const [boundaryConfirm, setBoundaryConfirm] = useState(null); // { changeType, sourceName, affectedGoals }
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [splitPct, setSplitPct] = useState(58);
  const [isLg, setIsLg] = useState(false);
  const streamIdRef = useRef(0);
  const splitRef = useRef(null);
  const dragging = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("gc_theme", theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsLg(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const refreshState = useCallback(async () => {
    try { setState(await api.state()); } catch (e) { /* noop */ }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    setProvider(user.model_provider || "gemini");
    api.history().then(setMessages).catch(() => {});
    refreshState();
  }, [loading, user, refreshState]);

  // Drag-to-resize divider
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(75, Math.max(28, pct)));
    };
    const onUp = () => { dragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const startDrag = () => { dragging.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; };

  const doLogout = async () => {
    await logout();
    setMessages([]); setState(null);
    window.location.href = "/";
  };

  const clearChat = async () => {
    try {
      await api.clearHistory();
      setMessages([]);
      setState(null);
      toast.success("Chat cleared");
    } catch {
      setMessages([]);
      setState(null);
    }
  };

  const openSignIn = () => setSignInOpen(true);

  const changeProvider = async (p) => {
    setProvider(p);
    try {
      await api.setProvider(p);
      setUser((u) => (u ? { ...u, model_provider: p } : u));
      toast.success(`Model switched to ${p}`);
    } catch { toast.error("Could not switch model"); }
  };

  const prefill = (text) => { setInput(text); setMobileView("chat"); };
  const onStoryboard = prefill;

  const openAction = (goal, type) => setActionModal({ goalTitle: goal.title, type });

  const refineProposal = (proposal, thought) => {
    const name = proposal.title || proposal.new_title || proposal.goal_title || proposal.text || "";
    const label = (proposal.action || "change").replace(/_/g, " ");
    send(`About your proposed ${label}${name ? ` ("${name}")` : ""}: ${thought}. Please re-propose it with that taken into account.`);
  };

  const uploadFile = async (file, goalId = "") => {
    toast.message(`Uploading ${file.name}…`);
    try { await api.uploadSource(file, goalId); await refreshState(); toast.success(`Added ${file.name} as a source`); }
    catch (e) { toast.error(e.message || "Upload failed"); }
  };
  const addLink = async (url, goalId = "") => {
    if (!url) return;
    try {
      await api.addLink({ url, goal_id: goalId });
      const prevState = state;
      await refreshState();
      // Boundary check: if the link is scoped to a goal, flag it so the
      // user can choose to re-plan that goal with the new context.
      if (goalId && prevState?.goals) {
        const goal = prevState.goals.find((g) => g.id === goalId);
        if (goal) {
          setBoundaryConfirm({
            changeType: "added",
            sourceName: url,
            affectedGoals: [{
              id: goal.id,
              title: goal.title,
              reason: "This link is now attached as a source — it may change what the goal is really about or which milestones still make sense.",
            }],
          });
        }
      }
      toast.success("Link added as a source");
    } catch (e) { toast.error(e.message || "Could not add link"); throw e; }
  };
  const deleteSource = async (id) => {
    try {
      const prevState = state;
      const deleted = (prevState?.sources || []).find((s) => s.id === id);
      await api.deleteSource(id);
      await refreshState();
      // Boundary check: if the deleted source was attached to a goal,
      // offer a re-plan — removing evidence often invalidates a
      // milestone or next_action.
      if (deleted?.goal_id && prevState?.goals) {
        const goal = prevState.goals.find((g) => g.id === deleted.goal_id);
        if (goal) {
          setBoundaryConfirm({
            changeType: "removed",
            sourceName: deleted.original_filename || deleted.url || "",
            affectedGoals: [{
              id: goal.id,
              title: goal.title,
              reason: "This goal was using that source. The coach may want to revise the milestones or next action.",
            }],
          });
        }
      }
    } catch (e) { toast.error("Could not remove source"); throw e; }
  };
  const openSourceLinkDialog = () => {
    setSourceDialogSource(null);
    setSourceDialogMode("link");
  };
  const closeSourceDialog = () => {
    setSourceDialogMode(null);
    setSourceDialogSource(null);
  };
  const handleBoundaryReplan = async ({ goalIds }) => {
    const goalTitles = (state?.goals || [])
      .filter((g) => goalIds.includes(g.id))
      .map((g) => g.title);
    if (goalTitles.length === 0) return;
    const goalList = goalTitles.map((t) => `"${t}"`).join(", ");
    send(`I just changed the sources for ${goalList}. Re-plan ${goalTitles.length === 1 ? "it" : "them"} based on the new context.`);
  };
  const handleBoundaryKeep = () => {
    // no-op — the user wants to leave the goal as-is
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
        body: JSON.stringify({ message: text, auto_answer: autoAnswer, clarify: grillMe }),
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
        } else if (data.type === "needs_clarification") {
          // Backend says the coach needs to ask before proposing. Surface
          // 1-2 sharp questions as MCQ chips above the chat input, plus a
          // free-text fallback so the user can answer in their own words.
          finalId = data.message_id;
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, id: data.message_id, streaming: false } : m)));
          setPendingClarifications({
            messageId: data.message_id,
            prompt: data.prompt,
            questions: data.questions || [],
          });
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
          if (raw.startsWith("data: ")) { try { handle(JSON.parse(raw.slice(6))); } catch {} }
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
    setBusyProposal(proposalId);
    try {
      const { result, state: newState } = await api.confirm(messageId, proposalId);
      setState(newState);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "confirmed" } : p)) } : m)));
      toast.success(result);
    } catch (e) { toast.error(e.message || "Could not apply"); }
    finally { setBusyProposal(null); }
  };

  const rejectProposal = async (messageId, proposalId) => {
    setBusyProposal(proposalId);
    try {
      await api.reject(messageId, proposalId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "rejected" } : p)) } : m)));
    } catch (e) { toast.error(e.message || "Could not reject"); }
    finally { setBusyProposal(null); }
  };

  const chatStyle = isLg ? { width: rightCollapsed ? "100%" : leftCollapsed ? "0%" : `${splitPct}%` } : undefined;
  const panelStyle = isLg ? { width: leftCollapsed ? "100%" : rightCollapsed ? "0%" : `calc(${100 - splitPct}% - 10px)` } : undefined;
  const generalSources = (state?.sources || []).filter((s) => !s.goal_id);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <Header
        user={user}
        authLoading={loading}
        provider={provider}
        onProvider={changeProvider}
        onOpenAudit={() => setAuditOpen(true)}
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
            Everything you build is saved in this browser. Sign in to keep it on your account and pick up on any device.
          </span>
          <button data-testid="guest-banner-signin" onClick={openSignIn} className="text-xs font-medium text-[var(--accent)] hover:underline shrink-0">Sign in to save →</button>
        </div>
      )}

      {/* Mobile view switch */}
      <div className="lg:hidden flex border-b border-[var(--border)] shrink-0">
        <button data-testid="mobile-tab-chat" onClick={() => setMobileView("chat")} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${mobileView === "chat" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </button>
        <button data-testid="mobile-tab-state" onClick={() => setMobileView("state")} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${mobileView === "state" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
          <LayoutDashboard className="w-3.5 h-3.5" /> State
        </button>
      </div>

      <div ref={splitRef} className="flex-1 min-h-0 flex relative">
        {rightCollapsed && (
          <button data-testid="panel-restore-button" onClick={() => setRightCollapsed(false)} title="Show goals & timeline" className="hidden lg:flex absolute top-2 right-2 z-20 items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-accent)] text-xs text-[var(--text-secondary)]">
            <PanelRightOpen className="w-4 h-4" /> Panel
          </button>
        )}
        {leftCollapsed && (
          <button data-testid="chat-restore-button" onClick={() => setLeftCollapsed(false)} title="Show chat" className="hidden lg:flex absolute top-2 left-2 z-20 items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-accent)] text-xs text-[var(--text-secondary)]">
            <PanelLeftOpen className="w-4 h-4" /> Chat
          </button>
        )}

        <div style={chatStyle} className={`min-h-0 ${leftCollapsed ? "lg:hidden" : ""} ${mobileView === "chat" ? "flex" : "hidden"} lg:flex`}>
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
              grillMe={grillMe}
              setGrillMe={setGrillMe}
              pendingClarifications={pendingClarifications}
              onAnswerClarification={(text) => { setPendingClarifications(null); send(text); }}
              onDismissClarifications={() => setPendingClarifications(null)}
              onUploadFile={(f) => uploadFile(f, "")}
              onAddLink={openSourceLinkDialog}
              sources={generalSources}
              onDeleteSource={deleteSource}
              onClearChat={clearChat}
            />
          </div>
        </div>

        {isLg && !leftCollapsed && !rightCollapsed && (
          <div data-testid="split-divider" onMouseDown={startDrag} title="Drag to resize · click a chevron to collapse" className="hidden lg:flex flex-col items-center justify-center w-[10px] shrink-0 cursor-col-resize bg-[var(--border)]/40 hover:bg-[var(--accent)]/40 transition-colors group">
            <button data-testid="collapse-chat-button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setLeftCollapsed(true)} title="Collapse chat" className="mb-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><PanelLeftClose className="w-3.5 h-3.5" /></button>
            <GripVertical className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
            <button data-testid="collapse-panel-button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setRightCollapsed(true)} title="Collapse panel" className="mt-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><PanelRightClose className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <div style={panelStyle} className={`min-h-0 bg-[var(--bg-primary)] flex-col border-l border-[var(--border)] ${rightCollapsed ? "lg:hidden" : "lg:flex"} ${mobileView === "state" ? "flex" : "hidden"}`}>
          <div className="shrink-0 flex items-center border-b border-[var(--border)] px-4 sm:px-6 pt-3">
            <button data-testid="panel-tab-state" onClick={() => setPanelView("state")} className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${panelView === "state" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
              <LayoutDashboard className="w-3.5 h-3.5" /> Goals
            </button>
            <button data-testid="panel-tab-timeline" onClick={() => setPanelView("timeline")} className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${panelView === "timeline" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
              <CalendarClock className="w-3.5 h-3.5" /> Timeline
            </button>
            <button data-testid="panel-collapse-button" onClick={() => setRightCollapsed(true)} title="Collapse panel" className="ml-auto hidden lg:flex items-center px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {panelView === "state" ? (
              <TrackingDashboard state={state} onPrefill={prefill} onAction={openAction} onUploadSource={uploadFile} onAddLink={addLink} onDeleteSource={deleteSource} onCreated={(newState) => setState(newState)} autoAnswer={autoAnswer} />
            ) : (
              <Timeline state={state} onPrefill={prefill} />
            )}
          </div>
        </div>
      </div>

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      <ActionPromptModal action={actionModal} onClose={() => setActionModal(null)} onSend={(msg) => { setActionModal(null); send(msg); }} />
      <SourceActionDialog
        open={!!sourceDialogMode}
        onClose={closeSourceDialog}
        mode={sourceDialogMode || "link"}
        source={sourceDialogSource}
        goalId=""
        onAddLink={addLink}
        onDeleteSource={deleteSource}
      />
      <GoalBoundaryConfirmDialog
        open={!!boundaryConfirm}
        onClose={() => setBoundaryConfirm(null)}
        changeType={boundaryConfirm?.changeType}
        sourceName={boundaryConfirm?.sourceName}
        affectedGoals={boundaryConfirm?.affectedGoals || []}
        onReplan={handleBoundaryReplan}
        onKeep={handleBoundaryKeep}
      />
    </div>
  );
}
