import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { MessageSquare, Plus, CalendarClock, CalendarDays, LayoutDashboard, Image as ImageIcon, FileText, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import Header from "../components/Header";
import TrackingDashboard from "../components/TrackingDashboard";
import Timeline from "../components/Timeline";
import Memories from "../components/Memories";
import Sources from "../components/Sources";
import Today from "../components/Today";
import HonestyAuditView from "../components/HonestyAuditView";
import SignInModal from "../components/SignInModal";
import AboutModal from "../components/AboutModal";
import ActionPromptModal from "../components/ActionPromptModal";
import SourceActionDialog from "../components/SourceActionDialog";
import GoalBoundaryConfirmDialog from "../components/GoalBoundaryConfirmDialog";
import FocusedTaskChatDialog from "../components/FocusedTaskChatDialog";
import ChatModal from "../components/ChatModal";
import WelcomeToast from "../components/WelcomeToast";

/**
 * Coach (post Slice-2)
 * -------------------
 * Layout philosophy change: the persistent chat panel on the left is
 * gone. The whole page is the right-side dashboard by default (Goals /
 * Calendar / Timeline tabs). The chat opens in a centered modal
 * whenever the user taps "Chat with coach" in the header, the
 * floating bottom-right chat button, or one of the storyboard
 * scenarios. State lives inside ChatModal so re-opening the modal
 * shows the prior conversation; Coach.js only owns the dashboard
 * state + the chat-open flag.
 */
export default function Coach() {
  const { user, setUser, loading, logout } = useAuth();
  const isGuest = !!user?.is_guest;

  const [state, setState] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("sutra_theme") || "light",
  );
  const [auditOpen, setAuditOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  // Focused-task dialog (per-action isolated chat). When set, opens
  // a fresh chat scoped to a single goal-edit / pause / drop /
  // add_step / source-replan action. The global ChatModal stays for
  // the generic "Chat with coach" entry points (header, FAB,
  // storyboard).
  const [focusedTask, setFocusedTask] = useState(null);
  // Default mode is "coach may ask" — the coach asks the user
  // questions before proposing. The user has to explicitly flip the
  // switch to "auto" before the coach writes to state without a
  // follow-up. This is closer to a coaching relationship than the
  // old "always emit a tool call" default.
  const [autoAnswer, setAutoAnswerRaw] = useState(false);
  const [grillMe, setGrillMeRaw] = useState(false);
  const [sourceDialogMode, setSourceDialogMode] = useState(null);
  const [sourceDialogSource, setSourceDialogSource] = useState(null);
  const [boundaryConfirm, setBoundaryConfirm] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPrefill, setChatPrefill] = useState("");
  // Iteration 5 — optional scoped chat context (set by Today Timetable /
  // Timeline / focused-task CTAs). Null = generic "Chat with your coach".
  const [chatScope, setChatScope] = useState(null);
  const [devLoginAvailable, setDevLoginAvailable] = useState(false);

  const setAutoAnswer = (v) => {
    const next = typeof v === "function" ? v(autoAnswer) : v;
    setAutoAnswerRaw(next);
    if (next) setGrillMeRaw(false);
  };
  const setGrillMe = (v) => {
    const next = typeof v === "function" ? v(grillMe) : v;
    setGrillMeRaw(next);
    if (next) setAutoAnswerRaw(false);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("sutra_theme", theme);
  }, [theme]);

  // Probe /api/auth/dev-login once on mount to learn whether the
  // server-side dev bypass is on. 200 = enabled (persona menu and
  // SignInModal's "Continue as Dev User" CTA both render); 404 =
  // disabled (they stay hidden). The shared flag prevents every
  // component from probing on its own.
  useEffect(() => {
    let cancelled = false
    import("../lib/api").then(({ API }) => {
      fetch(`${API}/auth/dev-login?probe=1`, {
        method: "GET",
        credentials: "include",
      })
        .then((r) => {
          if (!cancelled) setDevLoginAvailable(r.status === 200)
        })
        .catch(() => {
          if (!cancelled) setDevLoginAvailable(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshState = useCallback(async () => {
    try {
      const next = await api.state();
      setState(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    refreshState();
  }, [loading, user, refreshState]);

  const doLogout = async () => {
    await logout();
    setState(null);
    window.location.href = "/";
  };

  const openSignIn = () => setSignInOpen(true);

  // Open the chat with a pre-filled question — used by Today Timetable's
  // "I can't do this" / "Break it down with coach" buttons and the
  // Timeline's per-tile CTAs. Accepts an optional scoped context
  // (scope/refId/kind/title/helperText) so the modal can show
  // "About: <subject>" and mint a per-entity conversation server-side.
  const openChatWith = (prefill, scoped = null) => {
    setChatPrefill(prefill || "");
    setChatScope(scoped);
    setChatOpen(true);
  };

  const openAction = (goal, type) => setActionModal({ goalTitle: goal.title, type });

  // When the user clicks "Ask the coach" inside ActionPromptModal,
  // open an ISOLATED focused-task chat (instead of the global
  // ChatModal). Pre-fills the input with the action message so the
  // user just hits Enter to send.
  const onGoalAction = (msg) => {
    setActionModal(null);
    setFocusedTask({
      title: "Coach · focused task",
      subtitle: "This chat is scoped to the action you just described. It starts empty and resets when you close it.",
      prefillMessage: msg,
      icon: Sparkles,
    });
  };

  const handleBoundaryReplan = ({ goalIds }) => {
    const goalTitles = (state?.goals || [])
      .filter((g) => goalIds.includes(g.id))
      .map((g) => g.title);
    if (goalTitles.length === 0) return;
    const goalList = goalTitles.map((t) => `"${t}"`).join(", ");
    setFocusedTask({
      title: "Coach · replan after source change",
      subtitle: `A source change affects ${goalList}. Ask the coach to replan.`,
      prefillMessage: `The source I just changed affects ${goalList}. Please replan.`,
      icon: Sparkles,
    });
  };

  const uploadFile = async (file, goalId = "") => {
    toast.message(`Uploading ${file.name}…`);
    try {
      const fresh = await api.uploadSource(file, goalId).then(() => api.state());
      await refreshState();
      toast.success(`Added ${file.name} as a source`);
    } catch (e) {
      toast.error(e?.message || "Upload failed");
    }
  };

  const addLink = async (url, goalId = "") => {
    if (!url) return;
    try {
      const prevState = state;
      await api.addLink({ url, goal_id: goalId });
      await refreshState();
      if (goalId && prevState?.goals) {
        const goal = prevState.goals.find((g) => g.id === goalId);
        if (goal) {
          setBoundaryConfirm({
            changeType: "added",
            sourceName: url,
            affectedGoals: [
              {
                id: goal.id,
                title: goal.title,
                reason:
                  "This link is now attached as a source — it may change what the goal is really about or which milestones still make sense.",
              },
            ],
          });
        }
      }
      toast.success("Link added as a source");
    } catch (e) {
      toast.error(e?.message || "Could not add link");
    }
  };

  const deleteSource = async (id) => {
    try {
      const prevState = state;
      const deleted = (prevState?.sources || []).find((s) => s.id === id);
      await api.deleteSource(id);
      await refreshState();
      if (deleted?.goal_id && prevState?.goals) {
        const goal = prevState.goals.find((g) => g.id === deleted.goal_id);
        if (goal) {
          setBoundaryConfirm({
            changeType: "removed",
            sourceName: deleted.original_filename || deleted.url || "",
            affectedGoals: [
              {
                id: goal.id,
                title: goal.title,
                reason:
                  "This goal was using that source. The coach may want to revise the milestones or next action.",
              },
            ],
          });
        }
      }
    } catch {
      toast.error("Could not remove source");
    }
  };

  const openSourceLinkDialog = () => {
    setSourceDialogSource(null);
    setSourceDialogMode("link");
  };
  const closeSourceDialog = () => {
    setSourceDialogMode(null);
    setSourceDialogSource(null);
  };

  // Iteration 7 — the landing tab is always Goals. Earlier iterations
  // remembered the last-used tab in localStorage, but the founder
  // reported landing on Timeline every time and wanted Goals to be the
  // canonical landing tab on every fresh page load. The localStorage
  // save and read have both been removed.
  const [panelView, setPanelView] = useState("state");

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <Header
        user={user}
        authLoading={loading}
        onOpenChat={() => setChatOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onSignIn={openSignIn}
        onLogout={doLogout}
        devLoginAvailable={devLoginAvailable}
        currentUserId={user?.user_id || user?.id}
      />

      {isGuest && (
        <div
          data-testid="guest-banner"
          className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-4 sm:px-6 py-2 flex items-center gap-3 shrink-0"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">
            preview
          </span>
          <span className="text-xs text-[var(--text-secondary)] flex-1">
            Log in to persist this session and access all advanced features.
          </span>
          <button
            data-testid="guest-banner-signin"
            onClick={openSignIn}
            className="text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
          >
            Log in →
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="shrink-0 flex items-center border-b border-[var(--border)] px-4 sm:px-6 pt-3 bg-[var(--bg-primary)] sticky top-0 z-10 backdrop-blur overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none]">
          <button
            data-testid="panel-tab-state"
            onClick={() => setPanelView("state")}
            className={`flex items-center gap-1.5 h-11 sm:h-9 px-3 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              panelView === "state"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Goals
          </button>
          <button
            data-testid="panel-tab-today"
            onClick={() => setPanelView("today")}
            className={`flex items-center gap-1.5 h-11 sm:h-9 px-3 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              panelView === "today"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" /> Today
          </button>
          <button
            data-testid="panel-tab-timeline"
            onClick={() => setPanelView("timeline")}
            className={`flex items-center gap-1.5 h-11 sm:h-9 px-3 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              panelView === "timeline"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" /> Timeline
          </button>
          <button
            data-testid="panel-tab-memories"
            onClick={() => setPanelView("memories")}
            className={`flex items-center gap-1.5 h-11 sm:h-9 px-3 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              panelView === "memories"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" /> Memories
          </button>
          <button
            data-testid="panel-tab-sources"
            onClick={() => setPanelView("sources")}
            className={`flex items-center gap-1.5 h-11 sm:h-9 px-3 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              panelView === "sources"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Sources
          </button>
        </div>

        <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto w-full">
          {panelView === "state" ? (
            <TrackingDashboard
              state={state}
              onAction={(goal, type) => openAction(goal, type)}
              onUploadSource={uploadFile}
              onAddLink={addLink}
              onDeleteSource={deleteSource}
              onCreated={refreshState}
              onOpenChat={() => setChatOpen(true)}
              onOpenChatWith={openChatWith}
              onOpenToday={() => setPanelView("today")}
              autoAnswer={autoAnswer}
              grillMe={grillMe}
              isGuest={isGuest}
            />
          ) : panelView === "today" ? (
            <Today state={state} onChange={refreshState} onOpenChat={openChatWith} />
          ) : panelView === "timeline" ? (
            <Timeline state={state} onPrefill={() => setChatOpen(true)} onOpenChatWith={openChatWith} />
          ) : panelView === "sources" ? (
            <Sources state={state} onChange={refreshState} />
          ) : (
            <Memories state={state} onChange={refreshState} />
          )}
        </div>
      </div>

      {/* Floating chat button — always visible, opens the centered modal. */}
      <button
        data-testid="fab-chat"
        onClick={() => setChatOpen(true)}
        title="Chat with your coach"
        aria-label="Chat with your coach"
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-[var(--accent)] text-[var(--bg-primary)] shadow-2xl flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        <MessageSquare className="w-6 h-6" />
      </button>

      <ChatModal
        open={chatOpen}
        onClose={() => { setChatOpen(false); setChatPrefill(""); setChatScope(null); }}
        user={user}
        setUser={setUser}
        autoAnswer={autoAnswer}
        setAutoAnswer={setAutoAnswer}
        grillMe={grillMe}
        setGrillMe={setGrillMe}
        onStateChange={(next) => setState(next)}
        onAction={(goal, type) => openAction(goal, type)}
        onUploadFile={uploadFile}
        onAddLink={addLink}
        onOpenSignIn={openSignIn}
        isGuest={isGuest}
        prefillMessage={chatPrefill}
        scope={chatScope?.scope}
        refId={chatScope?.refId}
        kind={chatScope?.kind}
        title={chatScope?.title}
        helperText={chatScope?.helperText}
      />

      <WelcomeToast user={user} state={state} signedIn={!isGuest} />

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      <ActionPromptModal
        action={actionModal}
        onClose={() => setActionModal(null)}
        onSend={onGoalAction}
      />
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
        onKeep={() => setBoundaryConfirm(null)}
      />
      <FocusedTaskChatDialog
        open={!!focusedTask}
        onClose={() => setFocusedTask(null)}
        title={focusedTask?.title}
        subtitle={focusedTask?.subtitle}
        prefillMessage={focusedTask?.prefillMessage}
        icon={focusedTask?.icon}
        user={user}
        isGuest={isGuest}
        autoAnswer={autoAnswer}
        grillMe={grillMe}
        setAutoAnswer={setAutoAnswer}
        setGrillMe={setGrillMe}
        onStateChange={(next) => setState(next)}
        onUploadFile={uploadFile}
        onAddLink={addLink}
        onOpenSignIn={openSignIn}
        scope={focusedTask?.scope}
        refId={focusedTask?.refId}
        kind={focusedTask?.kind}
        helperText={focusedTask?.helperText}
      />
    </div>
  );
}
