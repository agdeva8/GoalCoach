import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import ChatConsole from "./ChatConsole";
import { api, API } from "../lib/api";

/**
 * FocusedTaskChatDialog — isolated chat for goal-level actions
 * (edit, pause, drop, add_step) and source-boundary replans.
 *
 * Replicates the AddGoalDialog pattern: own useState for the entire
 * chat, no shared `messages[]` with the global ChatModal, history
 * starts empty and resets on close.
 *
 * Differs from AddGoalDialog:
 *   - No 2-step tile→chat flow — we already have context from the
 *     action that opened us, so we land directly in the chat.
 *   - Pre-fills the input with `prefillMessage` so the user doesn't
 *     have to paste manually.
 *
 * The dialog self-closes after a successful proposal confirm
 * (`onClose` is invoked from the proposal confirm handler when the
 * message type goes `confirmed` and no other dialog is open).
 */
export default function FocusedTaskChatDialog({
  open,
  onClose,
  title = "Chat with your coach",
  subtitle = "Focus on this task. The chat below starts fresh and resets when you close it.",
  prefillMessage = "",
  icon: Icon = MessageSquare,
  user,
  isGuest,
  autoAnswer = true,
  grillMe = false,
  setAutoAnswer,
  setGrillMe,
  onStateChange,
  onAction,
  onUploadFile,
  onAddLink,
  onOpenSignIn,
  // Iteration 5 — scoped chat context. Caller passes these so the
  // server can mint a per-entity conversation
  // (`conv_<kind>_<refId>`) and the post-confirm close can fire.
  scope = null,
  refId = null,
  kind = null,
  helperText = "",
}) {
  // Chat-internal state — fully isolated.
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [pendingClarifications, setPendingClarifications] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const streamIdRef = useRef(0);

  // Reset everything on open / close transitions so a re-open always
  // starts fresh (the goal of the user's "clear state per focused
  // task" complaint).
  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
      setSending(false);
      setBusyProposal(null);
      setPendingClarifications(null);
      setHistoryLoaded(false);
    }
  }, [open]);

  const send = useCallback(
    async (text) => {
      if (!open || !user) return;
      setSending(true);
      setInput("");
      const localUserId = `local_${Date.now()}`;
      const streamId = `stream_${++streamIdRef.current}`;
      setMessages((prev) => [
        ...prev,
        { id: localUserId, role: "user", content: text, proposals: [] },
        {
          id: streamId,
          role: "assistant",
          content: "",
          proposals: [],
          streaming: true,
        },
      ]);
      try {
        const resp = await fetch(`${API}/chat/stream`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            auto_answer: autoAnswer,
            clarify: grillMe,
            scope,
            refId,
            kind,
            title,
            helperText,
          }),
        });
        if (!resp.ok || !resp.body) throw new Error("stream failed");
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalId = null;
        const handle = (data) => {
          if (data.type === "delta") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? { ...m, content: m.content + data.content }
                  : m,
              ),
            );
          } else if (data.type === "tools") {
            finalId = data.message_id;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? { ...m, id: data.message_id, proposals: data.proposals }
                  : m,
              ),
            );
          } else if (data.type === "needs_clarification") {
            finalId = data.message_id;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? { ...m, id: data.message_id, streaming: false }
                  : m,
              ),
            );
            setPendingClarifications({
              messageId: data.message_id,
              prompt: data.prompt,
              questions: data.questions || [],
            });
          } else if (data.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === (finalId || streamId)
                  ? { ...m, id: data.message_id, streaming: false }
                  : m,
              ),
            );
          } else if (data.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? {
                      ...m,
                      streaming: false,
                      content: m.content || "(no response)",
                    }
                  : m,
              ),
            );
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
              try { handle(JSON.parse(raw.slice(6))); } catch { /* ignore */ }
            }
          }
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        );
      } finally {
        setSending(false);
      }
    },
    [open, user, autoAnswer, grillMe, scope, refId, kind, title, helperText],
  );

  const confirmProposal = useCallback(
    async (messageId, proposalId) => {
      setBusyProposal(proposalId);
      try {
        const { result, state } = await api.confirm(messageId, proposalId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  proposals: m.proposals.map((p) =>
                    p.id === proposalId ? { ...p, status: "confirmed" } : p,
                  ),
                }
              : m,
          ),
        );
        // Bubble state up so the dashboard re-renders
        onStateChange?.(state);
      } catch (e) {
        // leave in pending; user can retry
      } finally {
        setBusyProposal(null);
      }
    },
    [onStateChange],
  );

  const rejectProposal = useCallback(async (messageId, proposalId) => {
    setBusyProposal(proposalId);
    try {
      await api.reject(messageId, proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                proposals: m.proposals.map((p) =>
                  p.id === proposalId ? { ...p, status: "rejected" } : p,
                ),
              }
            : m,
        ),
      );
    } finally {
      setBusyProposal(null);
    }
  }, []);

  const refineProposal = useCallback(
    (proposal, thought) => {
      const name =
        proposal.title ||
        proposal.new_title ||
        proposal.goal_title ||
        proposal.text ||
        "";
      const label = (proposal.action || "change").replace(/_/g, " ");
      send(
        `About your proposed ${label}${name ? ` ("${name}")` : ""}: ${thought}. Please re-propose it with that taken into account.`,
      );
    },
    [send],
  );

  const onAnswerClarification = useCallback(
    (text) => {
      setPendingClarifications(null);
      send(text);
    },
    [send],
  );

  const onDismissClarifications = useCallback(
    () => setPendingClarifications(null),
    [],
  );

  const uploadFile = useCallback(
    async (file) => {
      try {
        await api.uploadSource(file, "");
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch {
        /* offline fine */
      }
    },
    [onStateChange],
  );

  const addLink = useCallback(
    async (url) => {
      if (!url) return;
      try {
        await api.addLink({ url, goal_id: "" });
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch {
        /* offline fine */
      }
    },
    [onStateChange],
  );

  // When the dialog opens, kick off the first message with the prefill
  // so the user lands in a populated chat, not an empty box.
  useEffect(() => {
    if (open && prefillMessage && !historyLoaded && input === "" && messages.length === 0) {
      setInput(prefillMessage);
    }
  }, [open, prefillMessage, historyLoaded, input, messages.length]);

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={Icon}
      title={title}
      subtitle={subtitle}
      maxWidth="max-w-3xl"
      testId="focused-task-chat-modal"
    >
      <div className="-mx-5 -mb-4 h-[68vh] min-h-[440px] max-h-[760px] border-t border-[var(--border)]">
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
          onUploadFile={uploadFile}
          onAddLink={addLink}
          sources={[]}
          onDeleteSource={() => {}}
          onClearChat={() => setMessages([])}
          focusOnMount={open}
          // Focused-task dialogs always have a specific subject —
          // mirror AddGoalDialog's per-category subtitle so the empty
          // body says what this chat is for, not the generic "tell
          // me everything" onboarding.
          scopeLabel={title && title !== "Chat with your coach" ? title : ""}
          scopeIntent={helperText || (subtitle && subtitle !== "Focus on this task. The chat below starts fresh and resets when you close it." ? subtitle : "Talk to the coach about this —")}
          pendingClarifications={pendingClarifications}
          onAnswerClarification={onAnswerClarification}
          onDismissClarifications={onDismissClarifications}
        />
      </div>
      {isGuest && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="flex-1">
            Log in to persist this session and access all advanced features.
          </span>
          <button
            type="button"
            data-testid="focused-task-chat-signin"
            onClick={onOpenSignIn}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Sign in →
          </button>
        </div>
      )}
    </CenteredDialog>
  );
}