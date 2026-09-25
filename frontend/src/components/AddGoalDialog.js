import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import ChatConsole from "./ChatConsole";
import { api } from "../lib/api";

/**
 * CATEGORIES — big aesthetic tiles the user picks from when starting
 * a new goal. Each entry has an icon, label, and a clarifying prompt
 * the coach uses if the user submits an empty message.
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
 * AddGoalDialog — opens a centered modal that hosts the FULL ChatConsole
 * (upload, mic, grill-me, auto-answer, clear chat, MCQ chips, sources)
 * with a row of big aesthetic category tiles at the top.
 *
 * The dialog reuses ChatConsole rather than reinventing the chat — the
 * parent (Coach.js) owns the chat state and passes everything through.
 * On a successful proposal confirm the dialog auto-closes so the
 * dashboard picks up the new goal.
 */
export default function AddGoalDialog({
  open,
  onClose,
  // Chat state (mirrors what Coach.js owns)
  messages,
  sending,
  input,
  setInput,
  busyProposal,
  autoAnswer,
  setAutoAnswer,
  grillMe,
  setGrillMe,
  pendingClarifications,
  onAnswerClarification,
  onDismissClarifications,
  sources,
  onSend,
  onConfirm,
  onReject,
  onRefine,
  onUploadFile,
  onAddLink,
  onDeleteSource,
  onClearChat,
  onCreated,
}) {
  const [activeCategory, setActiveCategory] = useState(null);

  // Reset category when the dialog opens so users start fresh.
  useEffect(() => {
    if (open) setActiveCategory(null);
  }, [open]);

  // Resolve a message from the user's input + selected category.
  //   - typed text present → send only the typed text (chip is implicit
  //     context — the user already chose a category)
  //   - chip selected + empty input → send the chip's clarifying prompt
  //   - no chip + empty input → refuse
  const buildMessage = () => {
    const text = (input || "").trim();
    if (text) return text;
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    return cat?.prompt || "";
  };

  const handleSend = () => {
    const msg = buildMessage();
    if (!msg) return;
    onSend(msg);
  };

  // Wrap onConfirm so we close the dialog + surface the new state to
  // the parent so the dashboard refresh picks it up immediately.
  const handleConfirm = async (messageId, proposalId) => {
    try {
      const { state } = await api.confirm(messageId, proposalId);
      onCreated?.(state);
      onConfirm?.(messageId, proposalId);
      setTimeout(() => onClose?.(), 600);
    } catch {
      // bubble — ChatConsole's confirm wrapper handles the toast
    }
  };

  const activeCat = CATEGORIES.find((c) => c.id === activeCategory);

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={Sparkles}
      title="Add a new goal"
      subtitle={
        activeCat
          ? `Tell the coach about your ${activeCat.label.toLowerCase()} goal — or just hit send and they'll ask the right questions.`
          : "Pick a category to get started, or just describe what you're working on."
      }
      maxWidth="max-w-3xl"
      testId="add-goal-dialog"
    >
      {/* Big aesthetic category tiles — grid so they reflow on mobile */}
      <div
        data-testid="add-goal-categories"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4"
      >
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              data-testid={`add-goal-category-${cat.id}`}
              onClick={() => setActiveCategory(isActive ? null : cat.id)}
              aria-pressed={isActive}
              className={`flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all min-h-[72px] ${
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-tertiary)]"
              }`}
            >
              <span aria-hidden="true" className="text-2xl leading-none">{cat.icon}</span>
              <span className="text-sm font-medium leading-tight">{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Full ChatConsole — reuses upload, mic, grill-me, auto-answer,
          clear chat, sources, MCQ chips, everything. Constrained to the
          dialog body height so it scrolls instead of overflowing. */}
      <div className="h-[60vh] min-h-[420px] -mx-5 -mb-5 border-t border-[var(--border)]">
        <ChatConsole
          messages={messages}
          onSend={handleSend}
          sending={sending}
          input={input}
          setInput={setInput}
          onConfirm={handleConfirm}
          onReject={onReject}
          onRefine={onRefine}
          busyProposal={busyProposal}
          autoAnswer={autoAnswer}
          setAutoAnswer={setAutoAnswer}
          grillMe={grillMe}
          setGrillMe={setGrillMe}
          onUploadFile={onUploadFile}
          onAddLink={onAddLink}
          sources={sources}
          onDeleteSource={onDeleteSource}
          onClearChat={onClearChat}
          pendingClarifications={pendingClarifications}
          onAnswerClarification={onAnswerClarification}
          onDismissClarifications={onDismissClarifications}
        />
      </div>
    </CenteredDialog>
  );
}
