import { useState, useEffect } from "react";
import { Send, MessageSquareText } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import { canAutofocus } from "../lib/utils";

// Exported so Coach.js can reuse the same frame titles when it opens the
// focused-task chat (the chat header should match the dialog the user
// just came from, not a generic "Coach — focused task").
export const FRAMES = {
  drop: {
    title: (t) => `Drop "${t}"?`,
    q: "What's making you want to drop this? The coach will confirm before anything changes.",
    ph: "e.g. it's not moving and the career pivot needs the time…",
    verb: (t, a) => `I want to drop "${t}". ${a}`,
    cta: "Ask the coach",
  },
  pause: {
    title: (t) => `Pause "${t}"?`,
    q: "Why pause it, and for how long? The coach will confirm before anything changes.",
    ph: "e.g. park it until the launch is done in March…",
    verb: (t, a) => `I want to pause "${t}". ${a}`,
    cta: "Ask the coach",
  },
  edit: {
    title: (t) => `Refine "${t}"`,
    q: "What should change — the wording, the scope, the deadline?",
    ph: "e.g. rename to 'Ship v1 landing page' and pull the target a month earlier…",
    verb: (t, a) => `I want to refine my goal "${t}". ${a}`,
    cta: "Ask the coach",
  },
  add_step: {
    title: (t) => `Add a step to "${t}"`,
    q: "What milestone or step should the coach add?",
    ph: "e.g. finish the first 20 DSA problems by mid-July…",
    verb: (t, a) => `Add a milestone to "${t}": ${a}`,
    cta: "Ask the coach",
  },
};

/**
 * ActionPromptModal — routes a goal-card action (drop / pause / edit /
 * add_step) through the shared `CenteredDialog` shell so every modal
 * in the app shares the same header, close button, and warm-theme
 * spacing. The wrapper remains the test-id the existing snapshot /
 * fixture tests look for (`action-prompt-modal`) so we don't break the
 * `ActionPromptModal`-driven UI flow.
 */
export default function ActionPromptModal({ action, onClose, onSend }) {
  const [text, setText] = useState("");
  useEffect(() => { setText(""); }, [action]);
  const open = !!action;
  const frame = open ? (FRAMES[action.type] || FRAMES.edit) : null;
  const title = action?.goalTitle;

  const submit = () => {
    const a = text.trim();
    if (!a) return;
    onSend(frame.verb(title, a));
  };

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={MessageSquareText}
      title={open ? frame.title(title) : ""}
      subtitle={open ? frame.q : ""}
      maxWidth="max-w-md"
      testId="action-prompt-modal"
      footer={open ? (
        <>
          <button onClick={onClose} data-testid="action-modal-cancel" className="h-11 px-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded">
            Cancel
          </button>
          <button
            data-testid="action-modal-send"
            onClick={submit}
            disabled={!text.trim()}
            className="h-11 flex items-center gap-1.5 px-4 rounded bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-40 hover:opacity-90 active:scale-[0.98] transition-[opacity,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <Send className="w-3 h-3" /> {frame.cta}
          </button>
        </>
      ) : null}
    >
      <label className="block">
        <span className="sr-only">Reason</span>
        <textarea
          data-testid="action-modal-input"
          autoFocus={canAutofocus()}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={4}
          placeholder={frame?.ph || ""}
          aria-label="Reason for this action"
          className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] resize-none"
        />
      </label>
    </CenteredDialog>
  );
}

