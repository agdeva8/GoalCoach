import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { MessageSquare, Plus, CalendarClock, LayoutDashboard } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import Header from "../components/Header";
import TrackingDashboard from "../components/TrackingDashboard";
import Timeline from "../components/Timeline";
import HonestyAuditView from "../components/HonestyAuditView";
import SignInModal from "../components/SignInModal";
import AboutModal from "../components/AboutModal";
import ActionPromptModal from "../components/ActionPromptModal";
import SourceActionDialog from "../components/SourceActionDialog";
import GoalBoundaryConfirmDialog from "../components/GoalBoundaryConfirmDialog";
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
  const [provider, setProvider] = useState("gemini");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("gc_theme") || "dark",
  );
  const [auditOpen, setAuditOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  // Default mode is "coach may ask" — the coach asks the user
  // questions before proposing. The user has to explicitly flip the
  // switch to "auto" before the coach writes to state without a
  // follow-up. This is closer to a coaching relationship than the
  // old "always emit a tool call" default.
  const [autoAnswer, setAutoAnswerRaw] = useState(false);
  const [grillMe, setGrillMeRaw] = useState(true);
  const [sourceDialogMode, setSourceDialogMode] = useState(null);
  const [sourceDialogSource, setSourceDialogSource] = useState(null);
  const [boundaryConfirm, setBoundaryConfirm] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
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
    localStorage.setItem("gc_theme", theme);
  }, [theme]);

  // Probe /api/auth/dev-login once on mount to learn whether the
  // server-side dev bypass is on. 200 = enabled (persona menu and
  // SignInModal's "Continue as Dev User" CTA both render); 404 =
  // disabled (they stay hidden). The shared flag prevents every
  // component from probing on its own.
  useEffect(() => {
    let cancelled = false
    import("../lib/api").then(({ API }) => {
      fetch(`${API}/auth/dev-login`, {
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
    setProvider(user.model_provider || "gemini");
    refreshState();
  }, [loading, user, refreshState]);

  const doLogout = async () => {
    await logout();
    setState(null);
    window.location.href = "/";
  };

  const openSignIn = () => setSignInOpen(true);

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

  const onStoryboard = () => setChatOpen(true);

  const openAction = (goal, type) => setActionModal({ goalTitle: goal.title, type });

  const onGoalAction = (msg) => {
    setActionModal(null);
    setChatOpen(true);
    // The chat state lives inside ChatModal; we don't surface the
    // message directly here — the user can paste / rephrase once the
    // modal opens. Future work: send a bootstrap message into the
    // modal via a ref.
    toast.info(
      "Coach modal opened — paste your context here so the coach can act on it.",
    );
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
  const handleBoundaryReplan = ({ goalIds }) => {
    const goalTitles = (state?.goals || [])
      .filter((g) => goalIds.includes(g.id))
      .map((g) => g.title);
    if (goalTitles.length === 0) return;
    const goalList = goalTitles.map((t) => `"${t}"`).join(", ");
    setChatOpen(true);
    toast.info(
      `Coach modal opened — tell it to replan ${goalList} based on the source change.`,
    );
  };

  const [panelView, setPanelView] = useState(() => {
    // Default first-time users (no goals) see the Calendar; returning
    // users see Goals.
    try {
      return localStorage.getItem("gc_panel_view") || "state";
    } catch {
      return "state";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("gc_panel_view", panelView);
    } catch {
      /* ignore */
    }
  }, [panelView]);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <Header
        user={user}
        authLoading={loading}
        provider={provider}
        onProvider={changeProvider}
        onOpenChat={() => setChatOpen(true)}
        onOpenAudit={() => setAuditOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onSignIn={openSignIn}
        theme={theme}
        onToggleTheme={() =>
          setTheme((t) => (t === "light" ? "dark" : "light"))
        }
        onLogout={doLogout}
        onStoryboard={onStoryboard}
        devLoginAvailable={devLoginAvailable}
        currentUserId={user?.user_id || user?.id}
      />

      {isGuest && (
        <div
          data-testid="guest-banner"
          className="border-b border-[var(--border)] bg-[var(--accent)]/10 px-4 sm:px-6 py-2 flex items-center gap-3 shrink-0"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">
            preview
          </span>
          <span className="text-xs text-[var(--text-secondary)] flex-1">
            Everything you build is saved in this browser. Sign in to keep it on your account and pick up on any device.
          </span>
          <button
            data-testid="guest-banner-signin"
            onClick={openSignIn}
            className="text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
          >
            Sign in to save →
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="shrink-0 flex items-center border-b border-[var(--border)] px-4 sm:px-6 pt-3 bg-[var(--bg-primary)] sticky top-0 z-10 backdrop-blur">
          <button
            data-testid="panel-tab-state"
            onClick={() => setPanelView("state")}
            className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              panelView === "state"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Goals
          </button>
          <button
            data-testid="panel-tab-timeline"
            onClick={() => setPanelView("timeline")}
            className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              panelView === "timeline"
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" /> Timeline
          </button>
        </div>

        <div className="px-4 sm:px-6 py-6">
          {panelView === "state" ? (
            <TrackingDashboard
              state={state}
              onAction={(goal, type) => openAction(goal, type)}
              onUploadSource={uploadFile}
              onAddLink={addLink}
              onDeleteSource={deleteSource}
              onCreated={(newState) => setState(newState)}
              onOpenChat={() => setChatOpen(true)}
              autoAnswer={autoAnswer}
              grillMe={grillMe}
              isGuest={isGuest}
            />
          ) : (
            <Timeline state={state} onPrefill={() => setChatOpen(true)} onOpenChat={() => setChatOpen(true)} />
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
        onClose={() => setChatOpen(false)}
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
      />

      <WelcomeToast user={user} state={state} signedIn={!isGuest} />

      <HonestyAuditView open={auditOpen} onClose={() => setAuditOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      <ActionPromptModal
        action={actionModal}
        onClose={() => setActionModal(null)}
        onSend={(msg) => {
          setActionModal(null);
          setChatOpen(true);
        }}
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
    </div>
  );
}
