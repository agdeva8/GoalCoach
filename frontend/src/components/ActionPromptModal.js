import { useState, useEffect } from "react";
import { X, Send, MessageSquareText } from "lucide-react";

const FRAMES = {
  drop: { title: (t) => `Drop "${t}"?`, q: "What's making you want to drop this? The coach will confirm before anything changes.", ph: "e.g. it's not moving and the career pivot needs the time…", verb: (t, a) => `I want to drop "${t}". ${a}` },
  pause: { title: (t) => `Pause "${t}"?`, q: "Why pause it, and for how long? The coach will confirm before anything changes.", ph: "e.g. park it until the launch is done in March…", verb: (t, a) => `I want to pause "${t}". ${a}` },
  edit: { title: (t) => `Refine "${t}"`, q: "What should change — the wording, the scope, the deadline?", ph: "e.g. rename to 'Ship v1 landing page' and pull the target a month earlier…", verb: (t, a) => `I want to refine my goal "${t}". ${a}` },
  add_step: { title: (t) => `Add a step to "${t}"`, q: "What milestone or step should the coach add?", ph: "e.g. finish the first 20 DSA problems by mid-July…", verb: (t, a) => `Add a milestone to "${t}": ${a}` },
};

export default function ActionPromptModal({ action, onClose, onSend }) {
  const [text, setText] = useState("");
  useEffect(() => { setText(""); }, [action]);
  if (!action) return null;
  const frame = FRAMES[action.type] || FRAMES.edit;
  const title = action.goalTitle;

  const submit = () => {
    const a = text.trim();
    if (!a) return;
    onSend(frame.verb(title, a));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-testid="action-prompt-modal">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <MessageSquareText className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">{frame.title(title)}</span>
          <button onClick={onClose} data-testid="action-modal-close" className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{frame.q}</p>
          <textarea
            data-testid="action-modal-input"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={3}
            placeholder={frame.ph}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="text-xs px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
            <button data-testid="action-modal-send" onClick={submit} disabled={!text.trim()} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-40 hover:opacity-90 transition-opacity">
              <Send className="w-3 h-3" /> Ask the coach
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
