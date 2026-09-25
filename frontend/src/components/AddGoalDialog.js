import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, MessageSquareText } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import ToolConfirmationPrompt from "./ToolConfirmationPrompt";
import { api, API } from "../lib/api";

/**
 * CATEGORIES — the horizontal carousel the user picks from when starting
 * a new goal. Each entry has a short label, an icon hint, and a prompt
 * the user can either send verbatim or rewrite before sending. Mirrors
 * the AREAS list in TrackingDashboard so we don't fragment the surface.
 */
const CATEGORIES = [
  { id: "health",       label: "Health",       icon: "🏃", prompt: "Help me set up a health goal. Ask anything you need, then propose it." },
  { id: "career",       label: "Career",       icon: "💼", prompt: "Help me set up a career goal. Ask anything you need, then propose it." },
  { id: "learning",     label: "Learning",     icon: "📚", prompt: "Help me set up a learning goal. Ask anything you need, then propose it." },
  { id: "relationship", label: "Relationship", icon: "💞", prompt: "Help me set up a relationship goal. Ask anything you need, then propose it." },
  { id: "finance",      label: "Finance",      icon: "💰", prompt: "Help me set up a finance goal. Ask anything you need, then propose it." },
  { id: "side-project", label: "Side project", icon: "🛠️", prompt: "Help me set up a side-project goal. Ask anything you need, then propose it." },
  { id: "custom",       label: "Something else", icon: "✨", prompt: "" },
];

/**
 * AddGoalDialog — opens a centered modal with:
 *   1. A horizontal category carousel at the top (one tap = prefill)
 *   2. A short chat transcript showing the coach's streamed response
 *   3. The free-text input + send button at the bottom
 *
 * The SSE stream runs inside this dialog (not the left-hand console) so
 * the user gets a focused, dedicated coaching session for setting up a
 * new goal. When the user confirms a proposal we close the dialog and
 * hand back to the parent so it can refresh state.
 */
export default function AddGoalDialog({
  open,
  onClose,
  autoAnswer = false,
  onConfirm = async () => {},
  onReject = async () => {},
  onCreated = () => {},
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const streamIdRef = useRef(0);
  const endRef = useRef(null);

  // Reset the conversation whenever the dialog opens so users get a
  // fresh session each time, instead of inheriting a stale transcript.
  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
      setActiveCategory(null);
    }
  }, [open]);

  // Auto-scroll as the stream arrives.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setInput("");
    const localUserId = `local_${Date.now()}`;
    const streamId = `stream_${++streamIdRef.current}`;
    setMessages((prev) => [
      ...prev,
      { id: localUserId, role: "user", content: trimmed, proposals: [] },
      { id: streamId, role: "assistant", content: "", proposals: [], streaming: true },
    ]);

    try {
      const resp = await fetch(`${API}/chat/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, auto_answer: autoAnswer }),
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
    } catch {
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    } finally {
      setSending(false);
    }
  };

  const pickCategory = (cat) => {
    // Selecting a chip just sets the context — it does NOT prefill the
    // input. The user types what they want; an empty submit sends the
    // chip's clarifying-question prompt instead of a pre-injected one.
    setActiveCategory(cat.id);
    setInput("");
  };

  // Build the actual message we'll send, given the current input + chip.
  //   - chip selected + empty input → send the chip's clarifying prompt
  //     ("Help me set up a career goal. Ask anything you need…")
  //   - chip selected + user text   → send the user's text on its own;
  //     the chip is implicit context (the user already chose "career")
  //   - no chip + empty input       → refuse (caller checks the disabled
  //     state on the send button)
  const buildMessage = () => {
    const text = input.trim();
    if (text) return text;
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    return cat?.prompt || "";
  };

  const canSend = !sending && (input.trim().length > 0 || (activeCategory !== null && (CATEGORIES.find((c) => c.id === activeCategory)?.prompt || "").length > 0));

  const onSubmit = (e) => {
    e?.preventDefault?.();
    if (!canSend) return;
    const msg = buildMessage();
    if (!msg) return;
    send(msg);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Confirm/reject wrapped to close the dialog after a successful action
  // — the goal lands in the parent state via `onCreated` so the dashboard
  // refresh picks it up immediately.
  const handleConfirm = async (messageId, proposalId) => {
    setBusyProposal(proposalId);
    try {
      const { result, state } = await api.confirm(messageId, proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "confirmed" } : p)) }
            : m,
        ),
      );
      onCreated?.(state);
      onConfirm?.(messageId, proposalId);
      // Auto-close after a brief moment so the user sees the "confirmed"
      // state before the dialog disappears.
      setTimeout(() => onClose?.(), 600);
    } finally {
      setBusyProposal(null);
    }
  };

  const handleReject = async (messageId, proposalId) => {
    setBusyProposal(proposalId);
    try {
      await api.reject(messageId, proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "rejected" } : p)) }
            : m,
        ),
      );
      onReject?.(messageId, proposalId);
    } finally {
      setBusyProposal(null);
    }
  };

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={Sparkles}
      title="Add a new goal"
      subtitle="Pick a category or just describe what's on your mind. The coach will propose something concrete you can confirm or refine."
      maxWidth="max-w-2xl"
      testId="add-goal-dialog"
    >
      <div className="space-y-4">
        {/* Category carousel — horizontal scroll on narrow screens */}
        <div data-testid="add-goal-categories" className="-mx-1 px-1 overflow-x-auto">
          <div className="flex gap-2 pb-1">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  data-testid={`add-goal-category-${cat.id}`}
                  onClick={() => pickCategory(cat)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors ${
                    isActive
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--bg-tertiary)]"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-accent)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span aria-hidden="true">{cat.icon}</span>
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Streamed conversation */}
        <div data-testid="add-goal-transcript" className="border border-[var(--border)] bg-[var(--bg-primary)] rounded-md max-h-[40vh] overflow-y-auto px-4 py-3 space-y-4 min-h-[120px]">
          {messages.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <MessageSquareText className="w-3.5 h-3.5" />
              Say what you're working on, or pick a category above to get started.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} data-testid={`add-goal-msg-${m.role}`} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">
                {m.role === "user" ? "you" : "coach"}
              </span>
              <div className={`max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-[var(--bg-tertiary)] px-3 py-2" : "text-[var(--text-primary)]"}`}>
                {m.content}
                {m.streaming && <span className="gc-caret text-[var(--accent)]">▋</span>}
              </div>
              {(m.proposals || []).length > 0 && (
                <div className="w-full mt-2 space-y-2">
                  {m.proposals.map((p) => (
                    <ToolConfirmationPrompt
                      key={p.id}
                      proposal={p}
                      busy={busyProposal === p.id}
                      onConfirm={() => handleConfirm(m.id, p.id)}
                      onReject={() => handleReject(m.id, p.id)}
                      onRefine={(thought) => send(`About that proposal: ${thought}. Please re-propose.`)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* Input row */}
        <form onSubmit={onSubmit} className="flex items-end gap-2 border border-[var(--border)] focus-within:border-[var(--border-accent)] bg-[var(--bg-primary)] transition-colors">
          <textarea
            data-testid="add-goal-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={
              activeCategory
                ? `Tell the coach about your ${CATEGORIES.find((c) => c.id === activeCategory)?.label.toLowerCase() || ""} goal…`
                : "Describe what you're working on…"
            }
            aria-label="Describe your goal"
            className="flex-1 bg-transparent resize-none px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <button
            type="submit"
            data-testid="add-goal-send"
            disabled={!canSend}
            title={
              activeCategory && !input.trim()
                ? "Ask the coach to start by asking clarifying questions"
                : "Send"
            }
            aria-label="Send"
            className="m-2 h-9 w-9 flex items-center justify-center bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-30 hover:opacity-90 transition-opacity shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
        <p className="font-mono text-[10px] text-[var(--text-muted)] -mt-2">
          {activeCategory && !input.trim()
            ? `press send to have the coach ask clarifying questions for ${CATEGORIES.find((c) => c.id === activeCategory)?.label || ""}`
            : "enter to send · shift+enter = newline"}
        </p>
      </div>
    </CenteredDialog>
  );
}
