import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ArrowLeft,
  HeartPulse,
  Briefcase,
  BookOpen,
  HeartHandshake,
  TrendingUp,
  Wrench,
  Wand2,
} from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import ChatConsole from "./ChatConsole";
import { api, API } from "../lib/api";

/**
 * CATEGORIES — hero cards for picking a goal area.
 *
 * Every gradient stays inside the warm spectrum (amber / orange / rose /
 * stone / accent) so the surface matches the rest of the app's warm
 * dark / light theme. Differentiation comes from icon + label + a
 * slight gradient-direction shift, not from hue jumps that fight the
 * palette. The "Something else" tile is the only one that uses the
 * canonical --accent so it reads as the meta / catch-all choice.
 */
const CATEGORIES = [
  {
    id: "health",
    label: "Health",
    Icon: HeartPulse,
    gradient: "from-amber-500/25 via-yellow-500/12 to-amber-500/0",
    ring: "ring-amber-400/40",
    glow: "bg-amber-400/20",
    prompt: "Help me set up a health goal. Ask anything you need, then propose it.",
  },
  {
    id: "career",
    label: "Career",
    Icon: Briefcase,
    gradient: "from-orange-500/30 via-amber-500/12 to-red-500/0",
    ring: "ring-orange-400/40",
    glow: "bg-orange-400/20",
    prompt: "Help me set up a career goal. Ask anything you need, then propose it.",
  },
  {
    id: "learning",
    label: "Learning",
    Icon: BookOpen,
    gradient: "from-yellow-500/22 via-amber-300/10 to-yellow-600/0",
    ring: "ring-yellow-400/40",
    glow: "bg-yellow-400/15",
    prompt: "Help me set up a learning goal. Ask anything you need, then propose it.",
  },
  {
    id: "relationship",
    label: "Relationship",
    Icon: HeartHandshake,
    gradient: "from-rose-500/25 via-pink-400/10 to-rose-600/0",
    ring: "ring-rose-400/40",
    glow: "bg-rose-400/15",
    prompt: "Help me set up a relationship goal. Ask anything you need, then propose it.",
  },
  {
    id: "finance",
    label: "Finance",
    Icon: TrendingUp,
    gradient: "from-amber-600/28 via-orange-500/12 to-amber-700/0",
    ring: "ring-amber-500/40",
    glow: "bg-amber-500/15",
    prompt: "Help me set up a finance goal. Ask anything you need, then propose it.",
  },
  {
    id: "side-project",
    label: "Side project",
    Icon: Wrench,
    gradient: "from-stone-500/25 via-stone-400/10 to-stone-600/0",
    ring: "ring-stone-400/40",
    glow: "bg-stone-400/15",
    prompt: "Help me set up a side-project goal. Ask anything you need, then propose it.",
  },
  {
    id: "custom",
    label: "Something else",
    Icon: Wand2,
    gradient: "from-[color-mix(in_srgb,var(--accent)_25%,transparent)] via-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-transparent",
    ring: "ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]",
    glow: "bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]",
    prompt: "",
  },
];

/**
 * AddGoalDialog — 2-step flow:
 *
 *   Step 1 (tile-only): Big aesthetic category tiles. No chat visible.
 *     User picks one to advance.
 *
 *   Step 2 (chat): Same tiles stay pinned at the top (clickable to
 *     change selection or return to step 1). Below them, an isolated
 *     ChatConsole opens with its OWN state — same component, different
 *     context from the left-hand console.
 *
 * The dialog auto-closes after a successful confirm.
 */
export default function AddGoalDialog({
  open,
  onClose,
  autoAnswer: initialAutoAnswer = true,
  grillMe: initialGrillMe = false,
  onUploadSource,
  onAddLink,
  onDeleteSource,
  onGoalConfirmed,
}) {
  // Dialog-internal chat state — completely isolated from the parent.
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyProposal, setBusyProposal] = useState(null);
  const [pendingClarifications, setPendingClarifications] = useState(null);
  const streamIdRef = useRef(0);

  // UI state for the 2-step flow.
  const [activeCategory, setActiveCategory] = useState(null);
  const [step, setStep] = useState("tiles"); // "tiles" | "chat"
  // Iteration 5 (Bug 10) — bump every tiles→chat transition so React
  // remounts <ChatConsole> via `key` and re-fires its focus effect.
  // The old `focusOnMount={step === "chat"}` only flipped once on the
  // first cycle, so the second / third "change category" round
  // landed without focus on the textarea.
  const [focusToken, setFocusToken] = useState(0);
  const enterChat = (next) => {
    setStep(next ?? "chat");
    setFocusToken((t) => t + 1);
  };
  // Mode for the dialog's chat input. Seeded from the parent's mode
  // so the dialog opens on whatever mode the user is in globally.
  // Tracked locally after that — the previous `() => {}` no-op setters
  // made it look like the dropdown reverted after every pick.
  const [autoAnswer, setAutoAnswer] = useState(initialAutoAnswer);
  const [grillMe, setGrillMe] = useState(initialGrillMe);
  // Sources attached within this dialog session (attached to a goal
  // once it's created — shown as chips above the chat textarea).
  const [sources, setSources] = useState([]);

  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
      setSending(false);
      setBusyProposal(null);
      setPendingClarifications(null);
      setActiveCategory(null);
      setStep("tiles");
      setFocusToken(0);
      setSources([]);
    }
  }, [open]);

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
        body: JSON.stringify({ message: trimmed, auto_answer: autoAnswer, clarify: grillMe, proactive_propose: true }),
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

  const buildMessage = () => {
    // Iteration 5 (Issue 8) — never auto-send a canned prompt. If the
    // textarea is empty, send the category label so the coach still has
    // a noun to anchor on, but no fabricated user voice. Returning ""
    // here would short-circuit the send and the user would wonder why
    // Enter did nothing.
    const text = (input || "").trim();
    if (text) return text;
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    return cat ? `I want to set a ${cat.label.toLowerCase()} goal.` : "";
  };

  const handleSend = () => {
    const msg = buildMessage();
    if (!msg) return;
    send(msg);
  };

  const pickCategory = (cat) => {
    const isActive = activeCategory === cat.id;
    setActiveCategory(isActive ? null : cat.id);
    if (!isActive) enterChat();
  };

  const goBackToTiles = () => {
    setStep("tiles");
    setInput("");
  };

  const handleUploadFile = async (file) => {
    try {
      await onUploadSource(file);
      setSources((prev) => [
        ...prev,
        { id: `local_${Date.now()}`, original_filename: file.name, url: file.name, isLocal: true },
      ]);
    } catch {}
  };

  const handleAddLink = async (url) => {
    try {
      await onAddLink(url);
      setSources((prev) => [
        ...prev,
        { id: `local_${Date.now()}`, original_filename: url, url, isLocal: true },
      ]);
    } catch {}
  };

  const handleDeleteSource = (id) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    onDeleteSource(id);
  };

  const confirm = async (messageId, proposalId) => {
    setBusyProposal(proposalId);
    try {
      await api.confirm(messageId, proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status: "confirmed" } : p)) }
            : m,
        ),
      );
      // Tell the parent to re-fetch state so the new goal shows up
      // immediately in the dashboard (the dialog's internal messages
      // don't know about the parent's /api/state shape).
      onGoalConfirmed?.(proposalId);
      setTimeout(() => onClose?.(), 700);
    } catch {
      // bubble — parent toasts on the dashboard
    } finally {
      setBusyProposal(null);
    }
  };

  const reject = async (messageId, proposalId) => {
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
    } finally {
      setBusyProposal(null);
    }
  };

  const refine = (proposal, thought) => {
    const label = (proposal.action || "change").replace(/_/g, " ");
    send(`About your proposed ${label}: ${thought}. Please re-propose.`);
  };

  const clearChat = async () => {
    setMessages([]);
    setInput("");
    setPendingClarifications(null);
  };

  const activeCat = CATEGORIES.find((c) => c.id === activeCategory);

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={Sparkles}
      title={step === "chat" && activeCat ? `${activeCat.label} goal` : "Add a new goal"}
      subtitle={
        step === "tiles"
          ? "Pick what area this goal is in. You can refine the details once we start talking."
          : activeCat
          ? `Tell the coach about your ${activeCat.label.toLowerCase()} goal — or just hit send and they'll propose something.`
          : "Describe what you're working on."
      }
      maxWidth="max-w-3xl"
      testId="add-goal-dialog"
      // On mobile the dialog morphs:
      //   step 1 (tiles) — half-height sheet pinned to bottom
      //   step 2 (chat)  — full-height sheet so the composer gets the
      //                    screen real-estate + keyboard safe-area it
      //                    needs. On desktop this prop is ignored.
      fullHeightMobile={step === "chat"}
    >
      {/* Step 1: tiles. Step 2: a slim "change category" pill row + the
          ChatConsole. The same tiles collapse into a chip strip at the
          top of the chat — keeps the category visible without giving
          it a whole grid. */}
      {step === "tiles" ? (
        <div
          data-testid="add-goal-categories"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4"
        >
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            const { Icon, gradient, ring, glow } = cat;
            // "Something else" (custom) is the 7th tile in a 2-col mobile
            // grid — without this span it lands alone in row 4 looking
            // orphaned. Spanning both columns makes it the explicit
            // meta/catch-all it already is.
            const spanFullOnMobile = cat.id === "custom";
            return (
              <button
                key={cat.id}
                type="button"
                data-testid={`add-goal-category-${cat.id}`}
                onClick={() => pickCategory(cat)}
                aria-pressed={isActive}
                className={`relative flex flex-col items-start justify-between text-left rounded-xl border min-h-[112px] p-3.5 overflow-hidden transition-all group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                  spanFullOnMobile ? "col-span-2 sm:col-span-1" : ""
                } ${
                  isActive
                    ? `border-transparent ring-1 ${ring} bg-gradient-to-br ${gradient}`
                    : `border-[var(--border)] bg-[var(--bg-primary)] hover:border-[var(--border-accent)] hover:-translate-y-0.5`
                }`}
              >
                {/* Gradient wash — only visible on active state, fades to
                    subtle on hover. */}
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} ${
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                  } transition-opacity`}
                />
                {/* Soft glow halo at the top-left, intensifies on active. */}
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute -top-6 -left-6 h-20 w-20 rounded-full blur-2xl ${glow} ${
                    isActive ? "opacity-80" : "opacity-30 group-hover:opacity-50"
                  } transition-opacity`}
                />
                <Icon
                  className={`relative w-6 h-6 ${
                    isActive ? "text-[var(--text-primary)]" : "text-[var(--accent)] group-hover:text-[var(--text-primary)]"
                  } transition-colors`}
                  strokeWidth={1.6}
                />
                <span
                  className={`relative text-sm font-semibold leading-tight tracking-tight ${
                    isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                  } transition-colors`}
                >
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              data-testid="add-goal-back-to-tiles"
              onClick={goBackToTiles}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ArrowLeft className="w-3 h-3" /> change category
            </button>
          </div>

          {/* Isolated ChatConsole — own messages/sending/input, NOT
              shared with the left-hand console. "Same component,
              different context" as the user requested.
              showSources={false} hides the attach / link buttons —
              sources don't apply to a goal-add chat, and the no-op
              stubs were surfacing as a confusing dead UI. */}
          <div className="h-[55vh] min-h-[420px] sm:flex-1 sm:min-h-0 -mx-5 -mb-5 sm:mx-0 sm:mb-0 border-t border-[var(--border)]">
            <ChatConsole
              key={focusToken}
              messages={messages}
              onSend={handleSend}
              sending={sending}
              input={input}
              setInput={setInput}
              onConfirm={confirm}
              onReject={reject}
              onRefine={refine}
              busyProposal={busyProposal}
              autoAnswer={autoAnswer}
              setAutoAnswer={setAutoAnswer}
              grillMe={grillMe}
              setGrillMe={setGrillMe}
              onUploadFile={handleUploadFile}
              onAddLink={handleAddLink}
              sources={sources}
              onDeleteSource={handleDeleteSource}
              onClearChat={clearChat}
              pendingClarifications={pendingClarifications}
              onAnswerClarification={(text) => { setPendingClarifications(null); send(text); }}
              onDismissClarifications={() => setPendingClarifications(null)}
              showSources={true}
              // Iteration 5 (Bug 10) — focus on every tiles→chat
              // transition. `key={focusToken}` remounts the
              // component, and ChatConsole's effect picks up the
              // mount focus.
              focusOnMount={true}
            />
          </div>
        </>
      )}
    </CenteredDialog>
  );
}
