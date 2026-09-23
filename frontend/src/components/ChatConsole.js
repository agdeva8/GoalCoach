import { useRef, useEffect, useState } from "react";
import { ArrowUp, Paperclip, Link2, X, FileText } from "lucide-react";
import ToolConfirmationPrompt from "./ToolConfirmationPrompt";

function Message({ m, onConfirm, onReject, onRefine, busyProposal }) {
  if (m.role === "user") {
    return (
      <div data-testid="chat-message-user" className="flex flex-col items-end gc-fade-up">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">you</span>
        <div className="max-w-[85%] bg-[var(--bg-tertiary)] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div data-testid="chat-message-coach" className="flex flex-col items-start gc-fade-up">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)] mb-1">coach</span>
      <div className="max-w-[92%] text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
        {m.content}
        {m.streaming && <span className="gc-caret text-[var(--accent)]">▋</span>}
      </div>
      {(m.proposals || []).length > 0 && (
        <div className="w-[92%] mt-2">
          {m.proposals.map((p) => (
            <ToolConfirmationPrompt
              key={p.id}
              proposal={p}
              busy={busyProposal === p.id}
              onConfirm={() => onConfirm(m.id, p.id)}
              onReject={() => onReject(m.id, p.id)}
              onRefine={(thought) => onRefine(p, thought)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatConsole({ messages, onSend, sending, input, setInput, onConfirm, onReject, onRefine, busyProposal, autoAnswer, setAutoAnswer, onUploadFile = () => {}, onAddLink = () => {}, sources = [], onDeleteSource = () => {} }) {
  const endRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const [empty] = useState(messages.length === 0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || sending) return;
    onSend(text);
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div data-testid="chat-console" className="flex flex-col h-full min-h-0 bg-[var(--bg-primary)]">
      <div
        role="log"
        aria-live="polite"
        aria-label="Coaching conversation"
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6 space-y-6"
      >
        {messages.length === 0 && (
          <div className="h-full flex flex-col justify-center max-w-lg">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-3">start here</div>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              Tell me everything you're working on across every timeframe — the career move, the body,
              the side thing, the relationship. Say <span className="text-[var(--text-primary)]">"I have N goals across different time horizons; help me figure out this week."</span> I'll
              tell you what deserves attention, what you're over-committing to, and where you've drifted.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} onConfirm={onConfirm} onReject={onReject} onRefine={onRefine} busyProposal={busyProposal} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-[var(--border)] p-3 sm:p-4 bg-[var(--bg-primary)]">
        {sources.length > 0 && (
          <div data-testid="attached-sources" className="mb-2 flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <span key={s.id} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                <FileText className="w-3 h-3" /> <span className="max-w-[140px] truncate">{s.original_filename}</span>
                <button onClick={() => onDeleteSource(s.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)]"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 border border-[var(--border)] focus-within:border-[var(--border-accent)] bg-[var(--bg-secondary)] transition-colors">
          <input ref={fileRef} type="file" hidden accept=".pdf,.md,.txt,.csv,.json,.png,.jpg,.jpeg" onChange={(e) => { if (e.target.files[0]) { onUploadFile(e.target.files[0]); e.target.value = ""; } }} />
          <button data-testid="chat-attach-file" onClick={() => fileRef.current?.click()} title="Attach a file (PDF, .md, .txt…) as a source" className="ml-1 mb-2 h-9 w-9 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          <button data-testid="chat-attach-link" onClick={onAddLink} title="Add a link as a source" className="mb-2 h-9 w-9 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors shrink-0">
            <Link2 className="w-4 h-4" />
          </button>
          <textarea
            ref={taRef}
            data-testid="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Think out loud…"
            aria-label="Message the coach"
            className="flex-1 bg-transparent resize-none px-2 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none max-h-40"
            style={{ minHeight: "48px" }}
          />
          <button
            data-testid="chat-send-button"
            onClick={submit}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className="m-2 h-9 w-9 flex items-center justify-center bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-30 hover:opacity-90 transition-opacity shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="auto-answer-toggle"
            role="switch"
            aria-checked={autoAnswer}
            onClick={() => setAutoAnswer((v) => !v)}
            title="When on, the coach makes reasonable assumptions instead of asking you clarifying questions"
            className={`font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-colors ${autoAnswer ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          >
            {autoAnswer ? "answering for you" : "coach may ask questions"}
          </button>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {sending ? <span className="text-[var(--accent)]">coach is responding…</span> : "enter to send · shift+enter = newline"}
          </span>
        </div>
      </div>
    </div>
  );
}
