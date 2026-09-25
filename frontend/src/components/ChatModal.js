import { useState, useRef, useCallback, useEffect } from "react";
import { Sparkles, MessageSquare } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import ChatConsole from "./ChatConsole";
import { toast } from "sonner";
import { api, API } from "../lib/api";

/**
 * ChatModal — the chat is no longer a persistent panel on the left of
 * the Coach route. The dashboard fills the screen by default, and the
 * chat opens in this centered modal whenever the user clicks the
 * "Chat with coach" button in the header (or the floating bottom-right
 * action).
 *
 * The chat is its own state owner — conversation history, the input
 * field, in-flight proposals, voice input all live here. Reopening the
 * modal shows the prior conversation; the messages survive across
 * mounts because we only `useEffect`-fetch history on user change.
 *
 * Proposal confirm/reject flows communicate up to the parent via
 * `onStateChange` (which the parent uses to re-pull `/api/state`) so
 * the dashboard always reflects what the coach just wrote.
 */
export default function ChatModal({
  open,
  onClose,
  user,
  setUser,
  autoAnswer,
  setAutoAnswer,
  grillMe,
  setGrillMe,
  onStateChange,
  onAction,
  onUploadFile,
  onAddLink,
  onOpenSignIn,
  isGuest,
}) {
  // Chat-internal state — fully isolated from the dashboard.
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [pendingClarifications, setPendingClarifications] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const streamIdRef = useRef(0);

  // Load conversation history when the user changes (and we've never
  // loaded it for them). We surface a non-blocking toast on failure
  // but otherwise keep the chat usable in offline / 401 paths.
  useEffect(() => {
    if (!open || !user || historyLoaded) return;
    api
      .history()
      .then((m) => {
        setMessages(m || []);
        setHistoryLoaded(true);
      })
      .catch(() => {
        // Mock auth or temporary failure — leave the chat empty.
        setHistoryLoaded(true);
      });
  }, [open, user, historyLoaded]);

  // Reset history-loaded when user changes so a different account gets
  // its own conversation.
  useEffect(() => {
    setHistoryLoaded(false);
  }, [user?.user_id]);

  const send = useCallback(
    async (text) => {
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
            toast.error(data.content || "Model error");
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
              try {
                handle(JSON.parse(raw.slice(6)));
              } catch {
                /* ignore malformed event */
              }
            }
          }
        }
      } catch {
        toast.error("Connection interrupted");
      } finally {
        setSending(false);
        setMessages((prev) =>
          prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        );
      }
    },
    [autoAnswer, grillMe],
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
        toast.success(result);
        onStateChange?.(state);
      } catch (e) {
        toast.error(e?.message || "Could not apply");
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
    } catch (e) {
      toast.error(e?.message || "Could not reject");
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
      toast.message(`Uploading ${file.name}…`);
      try {
        await api.uploadSource(file, "");
        toast.success(`Added ${file.name} as a source`);
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch (e) {
        toast.error(e?.message || "Upload failed");
      }
    },
    [onStateChange],
  );

  const addLink = useCallback(
    async (url) => {
      if (!url) return;
      try {
        await api.addLink({ url, goal_id: "" });
        toast.success("Link added as a source");
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch (e) {
        toast.error(e?.message || "Could not add link");
      }
    },
    [onStateChange],
  );

  const onSignInFromChat = useCallback(() => {
    onOpenSignIn?.();
  }, [onOpenSignIn]);

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={MessageSquare}
      title="Chat with your coach"
      subtitle="Ask anything. The coach writes to your goals only after you confirm a proposal."
      maxWidth="max-w-3xl"
      testId="chat-modal"
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
          onClearChat={async () => {
            try {
              await api.clearHistory();
            } catch {
              /* offline is fine */
            }
            setMessages([]);
          }}
          pendingClarifications={pendingClarifications}
          onAnswerClarification={onAnswerClarification}
          onDismissClarifications={onDismissClarifications}
        />
      </div>
      {isGuest && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)]/60 px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="flex-1">
            You're chatting as a guest. Sign in to keep your goals across devices.
          </span>
          <button
            type="button"
            data-testid="chat-modal-signin"
            onClick={onSignInFromChat}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Sign in →
          </button>
        </div>
      )}
    </CenteredDialog>
  );
}
