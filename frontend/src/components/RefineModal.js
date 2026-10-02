import { useEffect, useState } from "react";
import { Pencil, Send, Loader2 } from "lucide-react";
import CenteredDialog from "./CenteredDialog";

// Per-action chip library — common refine instructions so users
// don't have to write a sentence. Tapping a chip fills the textarea;
// tapping a second chip appends with a comma. The user can still
// edit before sending. (Founder feedback, Iteration 9.)
const REFINE_CHIPS_BY_ACTION = {
  create_goal: [
    "Push the target date later",
    "Pull the target date earlier",
    "Make the first step smaller",
    "Sharpen the 'why'",
    "Change the horizon (weekly/short/medium/long)",
    "Tighten the scope",
  ],
  update_goal: [
    "Rename it",
    "Push the target date later",
    "Pull the target date earlier",
    "Change the horizon",
    "Update the 'why'",
  ],
  add_milestone: [
    "Push the target date later",
    "Pull the target date earlier",
    "Make the milestone smaller",
    "Make it more measurable",
  ],
  add_commitment: [
    "Make it smaller",
    "Push the due date later",
    "Pull the due date earlier",
    "Make it more specific",
    "Different first action",
  ],
  add_blocker: [
    "Shorter window",
    "Move the window earlier",
    "Move the window later",
  ],
  drop_goal: [
    "Don't drop — pause it instead",
    "Wrong goal",
  ],
  pause_goal: [
    "Don't pause — drop it",
    "Longer pause window",
    "Shorter pause window",
  ],
  complete_commitment: [
    "Already done — confirm",
  ],
  update_commitment: [
    "Push the due date later",
    "Smaller text",
    "Drop this commitment",
  ],
  set_goal_dates: [
    "Push the dates later",
    "Pull the dates earlier",
  ],
};
const DEFAULT_REFINE_CHIPS = [
  "Try again from scratch",
  "Different framing",
  "Smaller scope",
];

/**
 * RefineModal — open from ToolConfirmationPrompt's "Refine" button.
 *
 * Founder feedback (Iteration 9): no chat round-trip for a refine —
 * the user types ONE thought, the server LLM is called once with a
 * focused "re-propose taking into account: <thought>" prompt, and the
 * old proposal is REPLACED IN PLACE in the same assistant message.
 *
 * Props:
 *   open            — controlled open state
 *   onClose         — close handler
 *   proposalTitle   — the proposal's name (e.g. "Ship side-project MVP"),
 *                     used to label what the user is refining
 *   proposalAction  — the action label (e.g. "create goal", "add milestone")
 *   onSubmit        — async (thought) => void; the parent calls the new
 *                     POST /api/chat/refine route and replaces the proposal
 *                     in the messages list when it returns
 *
 * The component is dumb — it owns only its input + busy state.
 */
export default function RefineModal({
  open,
  onClose,
  proposalTitle = "",
  proposalAction = "change",
  proposalActionKey = "",
  onSubmit,
}) {
  const [thought, setThought] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setThought("");
      setBusy(false);
      setError("");
    }
  }, [open]);

  const chips = (proposalActionKey && REFINE_CHIPS_BY_ACTION[proposalActionKey]) || DEFAULT_REFINE_CHIPS;

  const tapChip = (chip) => {
    setThought((prev) => {
      const cur = prev.trim();
      if (!cur) return chip;
      if (cur.toLowerCase().includes(chip.toLowerCase())) return cur;
      return `${cur}, ${chip}`;
    });
  };

  const submit = async () => {
    const t = thought.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit?.(t);
      onClose?.();
    } catch (e) {
      setError(typeof e?.message === "string" ? e.message : "Couldn't refine that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // No auto-submit on Enter — founder feedback (Iteration 9+, mid-slice):
  // free-text typing shouldn't fire the LLM round-trip until the user
  // explicitly clicks "Ask for changes" below. Shift+Enter still inserts
  // a newline; Enter is reserved for the explicit button.
  const onKey = (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Default behaviour — insert newline at caret.
      return;
    }
    // Plain Enter does NOT submit. The user types freely and clicks the
    // button below when ready.
  };

  return (
    <CenteredDialog
      open={open}
      onClose={busy ? undefined : onClose}
      icon={Pencil}
      title={proposalTitle ? `Refine "${proposalTitle}"` : "Refine this"}
      subtitle={`What should the coach change? The coach will re-propose ${proposalAction} once, taking your note into account — no chat round-trip.`}
      maxWidth="max-w-xl"
      testId="refine-modal"
    >
      <div className="space-y-3">
        {chips.length > 0 && (
          <div data-testid="refine-modal-chips" className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`refine-chip-${c.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                onClick={() => tapChip(c)}
                disabled={busy}
                className="min-h-11 text-left text-xs px-2.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <label
          htmlFor="refine-modal-input"
          className="block text-xs font-medium text-[var(--text-muted)]"
        >
          Your note
        </label>
        <textarea
          id="refine-modal-input"
          data-testid="refine-modal-input"
          autoFocus
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          disabled={busy}
          placeholder="e.g. Push the target date a month later, make the first step smaller, swap 'medium-term' for 'long-term'…"
          className="block w-full bg-[var(--bg-primary)] border border-[var(--border)] focus:border-[var(--border-accent)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none resize-none disabled:opacity-50"
        />
        <p className="text-xs text-[var(--text-muted)]">
          Enter for a new line · Shift+Enter for a new line · Tap <span className="text-[var(--accent)] font-medium">Ask for changes</span> below to send
        </p>
        {error && (
          <p data-testid="refine-modal-error" role="alert" className="text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            data-testid="refine-modal-cancel"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 px-3 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="refine-modal-submit"
            onClick={submit}
            disabled={!thought.trim() || busy}
            className="flex items-center gap-1.5 min-h-11 px-4 text-xs font-medium bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Sending…
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> Ask for changes
              </>
            )}
          </button>
        </div>
      </div>
    </CenteredDialog>
  );
}