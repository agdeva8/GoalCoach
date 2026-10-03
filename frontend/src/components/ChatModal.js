import { useState, useRef, useCallback, useEffect } from "react";
import { Sparkles, MessageSquare } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import ChatConsole from "./ChatConsole";
import RefineModal from "./RefineModal";
import RejectModal from "./RejectModal";
import { useDialogBack } from "../hooks/useDialogBack";
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
  prefillMessage = "",
  // Iteration 5 — scoped chat context. When the modal opens from a
  // Timeline tile / Today timetable item / milestone, the caller passes
  // these so the title bar can read "About: <subject>" and the server
  // can mint a per-entity conversation (`conv_<kind>_<refId>`).
  scope = null,
  refId = null,
  kind = null,
  title = "",
  helperText = "",
}) {
  // Chat-internal state — fully isolated from the dashboard.
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [pendingClarifications, setPendingClarifications] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Iteration 9 — refine / reject modal state. The modal owns the
  // input; the dialog owns the lifecycle and the proposal lookup.
  const [refiningProposal, setRefiningProposal] = useState(null);
  const [rejectingProposal, setRejectingProposal] = useState(null);
  // Iteration 9 — browser/system back button closes this dialog
  // instead of exiting the app.
  useDialogBack(open, onClose, "chat-modal");
  // Sources attached during THIS chat session. Kept locally so the chips
  // render above the composer and an X on a chip can delete the row it
  // stands for — previously the parent passed `sources={[]}` and a no-op
  // delete, so a dismissed attachment quietly stayed on the server.
  const [sources, setSources] = useState([]);
  const streamIdRef = useRef(0);
  // Operation-scoped context (spec §10) — the current conversation
  // bucket. Seeded from the `refId` prop the parent passes (entity id
  // for scoped opens, null for the general chat) and swapped only on
  // confirm (server pre-mints the next bucket) or on a defensive
  // redirect in the `done` SSE event.
  const refIdRef = useRef(refId ?? null);

  // Re-seed the bucket whenever the modal reopens or the parent swaps
  // the scoped context. Falls back to a kind-appropriate mint when a
  // kind was given without an entity id (spec §10.1).
  useEffect(() => {
    if (!open) return;
    if (refId) {
      refIdRef.current = refId;
    } else if (kind === "add_goal") {
      refIdRef.current = `new_goal_${crypto.randomUUID()}`;
    } else if (kind === "plan_day") {
      refIdRef.current = `plan_${new Date().toISOString().slice(0, 10)}`;
    } else if (kind === "review_progress") {
      // Daily read / accountability check-ins get their own per-day
      // bucket so yesterday's read doesn't bleed into today's.
      refIdRef.current = `review_${new Date().toISOString().slice(0, 10)}`;
    } else {
      // General / unscoped chat — server falls back to
      // conv_general_<userId>; no client-side bucket.
      refIdRef.current = null;
    }
  }, [open, refId, kind]);

  // Seed the input whenever the modal opens or the opener swaps the
  // prefill. Two jobs:
  //   - opener passed text → drop it in (Today's free-text box, etc.);
  //   - opener passed ""   → CLEAR whatever was left from the last
  //     open. The old early-return on falsy prefill is what left
  //     "For \"Investor email batch 2\"…" sitting in a chat that had
  //     since been reopened about a different commitment.
  useEffect(() => {
    if (!open) return;
    setInput(prefillMessage || "");
  }, [open, prefillMessage]);

  // Load conversation history when the user changes (and we've never
  // loaded it for them). Iteration 9 — scoped dialogs (scope/refId/kind
  // set) NEVER fetch history; they start empty. Only the unscoped
  // "Chat with coach" surface (Coach.js sets scope=null on FAB / header
  // taps) accumulates across sessions via the general bucket.
  useEffect(() => {
    if (!open || !user || historyLoaded) return;
    if (scope || refId || kind) {
      // Scoped — start empty, no fetch. The conversation bucket is
      // sealed on first confirm, so historical turns from prior
      // scoped sessions never bleed into a new one.
      setMessages([]);
      setHistoryLoaded(true);
      return;
    }
    api
      .history()
      .then((m) => {
        setMessages(m || []);
        setHistoryLoaded(true);
      })
      .catch(() => {
        toast.error("Couldn't load chat history. Starting fresh — new messages still send.");
        setHistoryLoaded(true);
      });
  }, [open, user, historyLoaded, scope, refId, kind]);

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
            scope,
            // Same refId for every turn in this bucket; swapped by
            // confirm / done-redirect (spec §10.3).
            refId: refIdRef.current,
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
          } else if (data.type === "impact") {
            // Structured impact block (spec §10.6) — attach to the
            // assistant message that produced it.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === (finalId || streamId) ? { ...m, impact: data.impact } : m,
              ),
            );
          } else if (data.type === "done") {
            // Defensive redirect (spec §10.2) — server detected we
            // sent to a closed bucket and minted a fresh one.
            if (data.redirected && data.ref_id) refIdRef.current = data.ref_id;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === (finalId || streamId)
                  ? { ...m, id: data.message_id, streaming: false }
                  : m,
              ),
            );
          } else if (data.type === "error") {
            toast.error(data.content || "The coach hit an error. Try again.");
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
        toast.error("Connection dropped. Try sending that again.");
      } finally {
        setSending(false);
        setMessages((prev) =>
          prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        );
      }
    },
    [autoAnswer, grillMe, scope, kind, title, helperText],
  );

  const confirmProposal = useCallback(
    async (messageId, proposalId) => {
      setBusyProposal(proposalId);
      try {
        const { result, state, ref_id } = await api.confirm(
          messageId,
          proposalId,
        );
        // Spec §10.4 — server closed this bucket and (for add_goal)
        // pre-minted the next. Swap so the next send lands fresh.
        if (ref_id) refIdRef.current = ref_id;
        setMessages((prev) => {
          const proposal = prev
            .find((m) => m.id === messageId)
            ?.proposals?.find((p) => p.id === proposalId);
          const title =
            proposal?.args?.title ||
            proposal?.args?.goal_title ||
            proposal?.args?.new_title ||
            proposal?.title;
          const verb = proposal?.action === "create_goal" ? "Created" : "Confirmed";
          const content = title ? `${verb} "${title}"` : result || "Change applied";
          const goalId =
            proposal?.action === "create_goal" && title
              ? state?.goals?.find(
                  (g) => g.title === title && g.status === "active",
                )?.id
              : undefined;
          return [
            ...prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    proposals: m.proposals.map((p) =>
                      p.id === proposalId ? { ...p, status: "confirmed" } : p,
                    ),
                  }
                : m,
            ),
            // Success divider inline in the stream (spec §10.5) — the
            // visible messages are NOT cleared on confirm.
            {
              id: `success_${Date.now()}`,
              role: "success",
              content,
              goalId,
              goalTitle: title,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        toast.success(result);
        onStateChange?.(state);
      } catch (e) {
        toast.error(typeof e?.message === 'string' ? e.message : "Couldn't apply the change. Try again.");
      } finally {
        setBusyProposal(null);
      }
    },
    [onStateChange],
  );

  const rejectProposal = useCallback((messageId, proposalId, reason) => {
    // Optimistic — flip the UI immediately, persist in the background.
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
    api.reject(messageId, proposalId, reason).catch(() => {
      toast.error("Couldn't record that rejection — check your connection.");
    });
  }, []);

  // Iteration 9 — refine / reject open parent-owned modals instead of
  // round-tripping through the chat stream. `refineProposal` is kept
  // as a no-op shim so any stale callers don't crash; new code uses
  // `onOpenRefine` / `onOpenReject`.
  const refineProposal = useCallback(() => {}, []);

  const findProposalMessageId = useCallback((proposal) => {
    for (const m of messages) {
      if ((m.proposals || []).some((p) => p.id === proposal.id)) return m.id;
    }
    return null;
  }, [messages]);

  const onOpenRefine = useCallback((proposal) => {
    setRefiningProposal(proposal);
  }, []);

  const onOpenReject = useCallback((proposal) => {
    setRejectingProposal(proposal);
  }, []);

  const submitRefine = useCallback(async (thought) => {
    if (!refiningProposal) return;
    const messageId = findProposalMessageId(refiningProposal);
    if (!messageId) {
      throw new Error("Couldn't find the original proposal to refine.");
    }
    setBusyProposal(refiningProposal.id);
    try {
      const result = await api.refine(messageId, refiningProposal.id, thought);
      const newProposal = result?.proposal || result;
      if (!newProposal?.id) {
        throw new Error("The coach didn't return a new proposal.");
      }
      // Two-step flow: just return the preview. The parent's
      // `confirmRefine` applies it once the user clicks Confirm Refine.
      return newProposal;
    } catch (e) {
      toast.error(typeof e?.message === "string" ? e.message : "Couldn't refine that. Try again.");
      throw e;
    } finally {
      setBusyProposal(null);
    }
  }, [refiningProposal, findProposalMessageId]);

  const confirmRefine = useCallback((newProposal) => {
    if (!refiningProposal) return;
    const messageId = findProposalMessageId(refiningProposal);
    if (!messageId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              proposals: m.proposals.map((p) =>
                p.id === refiningProposal.id
                  ? { ...newProposal, id: refiningProposal.id, status: "pending" }
                  : p,
              ),
            }
          : m,
      ),
    );
    toast.success("Proposal refined.");
  }, [refiningProposal, findProposalMessageId]);

  const submitReject = useCallback(async (reason) => {
    if (!rejectingProposal) return;
    const messageId = findProposalMessageId(rejectingProposal);
    if (!messageId) {
      throw new Error("Couldn't find the original proposal to reject.");
    }
    await rejectProposal(messageId, rejectingProposal.id, reason);
  }, [rejectingProposal, findProposalMessageId, rejectProposal]);

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
        const created = await api.uploadSource(file, "");
        if (created?.id) setSources((prev) => [...prev, created]);
        toast.success(`Added ${file.name} as a source`);
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch (e) {
        toast.error(typeof e?.message === 'string' ? e.message : "Couldn't upload that file. Try again.");
      }
    },
    [onStateChange],
  );

  const addLink = useCallback(
    async (url) => {
      if (!url || typeof url !== "string") return;
      try {
        const created = await api.addLink({ url, goal_id: "" });
        if (created?.id) setSources((prev) => [...prev, created]);
        toast.success("Link added as a source");
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch (e) {
        toast.error(typeof e?.message === 'string' ? e.message : "Couldn't add the link. Try again.");
      }
    },
    [onStateChange],
  );

  // Dismissing an attachment chip must actually remove the row — the chip
  // is only a view of a source that was uploaded the moment the paperclip
  // was hit. Drop it from local state AND the server so a file the user
  // never sent doesn't linger in Sources.
  const deleteSource = useCallback(
    async (id) => {
      setSources((prev) => prev.filter((s) => s.id !== id));
      try {
        await api.deleteSource(id);
        const fresh = await api.state();
        onStateChange?.(fresh);
      } catch {
        // Offline / already gone — the chip is dismissed either way.
      }
    },
    [onStateChange],
  );

  const onSignInFromChat = useCallback(() => {
    onOpenSignIn?.();
  }, [onOpenSignIn]);

  // Scoped chat — when a title was passed in (with or without a
  // scope/refId entity anchor), swap the generic header for
  // "About: <subject>" with the helper line below. The earlier
  // requirement that scope AND title both be set meant chat flows
  // like "Build my timeline" — which have a title but no specific
  // entity to anchor on — still rendered the generic header.
  const scoped = Boolean(title)
  const headerTitle = scoped ? `About: ${title}` : "Chat with your coach"
  const headerSubtitle = scoped
    ? (helperText || "Ask anything about this — proposals only land after you confirm.")
    : "Ask anything. The coach writes to your goals only after you confirm a proposal."

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={MessageSquare}
      title={headerTitle}
      subtitle={headerSubtitle}
      maxWidth="max-w-3xl"
      testId="chat-modal"
    >
      <div className="-mx-5 -mb-4 h-[68vh] min-h-[min(440px,60dvh)] max-h-[760px] border-t border-[var(--border)]">
        <ChatConsole
          messages={messages}
          onSend={send}
          sending={sending}
          input={input}
          setInput={setInput}
          onConfirm={confirmProposal}
          onReject={(messageId, proposalId) => {
            // The modal owns the rejection flow; here we just stash
            // the proposal so the modal knows what to label itself.
            const proposal = messages
              .find((m) => m.id === messageId)
              ?.proposals?.find((p) => p.id === proposalId);
            if (proposal) setRejectingProposal(proposal);
          }}
          onOpenRefine={onOpenRefine}
          onOpenReject={onOpenReject}
          busyProposal={busyProposal}
          autoAnswer={autoAnswer}
          setAutoAnswer={setAutoAnswer}
          grillMe={grillMe}
          setGrillMe={setGrillMe}
          onUploadFile={uploadFile}
          onAddLink={addLink}
          sources={sources}
          onDeleteSource={deleteSource}
          focusOnMount={open}
          scopeLabel={scoped ? title : ""}
          scopeIntent={scoped ? (helperText || "Talk to the coach about this —") : ""}
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
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="flex-1">
            Sign in to keep this session and unlock every feature.
          </span>
          <button
            type="button"
            data-testid="chat-modal-signin"
            onClick={onSignInFromChat}
            className="min-h-11 font-medium text-[var(--accent)] hover:underline"
          >
            Sign in
          </button>
        </div>
      )}
      <RefineModal
        open={!!refiningProposal}
        onClose={() => setRefiningProposal(null)}
        proposalTitle={refiningProposal?.args?.title || refiningProposal?.title || refiningProposal?.args?.goal_title || ""}
        proposalAction={(refiningProposal?.action || "change").replace(/_/g, " ")}
        proposalActionKey={refiningProposal?.action || ""}
        onSubmit={submitRefine}
        onConfirm={confirmRefine}
      />
      <RejectModal
        open={!!rejectingProposal}
        onClose={() => setRejectingProposal(null)}
        proposalTitle={rejectingProposal?.args?.title || rejectingProposal?.title || rejectingProposal?.args?.goal_title || ""}
        proposalActionKey={rejectingProposal?.action || ""}
        onSubmit={submitReject}
      />
    </CenteredDialog>
  );
}
