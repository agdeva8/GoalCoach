import { useRef, useEffect, useState } from "react";
import { ArrowUp, Paperclip, Link2, X, FileText, Trash2, HelpCircle, Mic, Square } from "lucide-react";
import ToolConfirmationPrompt from "./ToolConfirmationPrompt";

/**
 * SpeechWave — animated audio feedback rendered above the chat input
 * while the user is dictating. Each bar has a randomized height that
 * updates on a short interval so the visualization actually moves while
 * the model is still producing interim transcripts. Mirrors the look of
 * the assistant's streaming caret so it reads as part of the chat UI.
 */
function SpeechWave({ text }) {
  const [bars, setBars] = useState(() => Array.from({ length: 16 }, () => 0.4));

  useEffect(() => {
    const id = setInterval(() => {
      setBars((prev) =>
        prev.map(() => 0.25 + Math.random() * 0.75),
      );
    }, 110);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      data-testid="speech-wave"
      aria-live="polite"
      className="mb-2 flex items-center gap-2 px-3 py-2 border border-[var(--danger)]/40 bg-[var(--danger)]/5 rounded-md"
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--danger)] shrink-0">
        listening
      </span>
      <div className="flex items-end gap-[3px] h-5 flex-1 min-w-0">
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 min-w-[2px] max-w-[6px] rounded-sm bg-[var(--danger)] transition-[height] duration-100 ease-linear"
            style={{ height: `${h * 100}%` }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] text-[var(--text-muted)] truncate min-w-0 max-w-[40%]" title={text}>
        {text ? text.slice(-32) : "…"}
      </span>
    </div>
  );
}

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

export default function ChatConsole({ messages, onSend, sending, input, setInput, onConfirm, onReject, onRefine, busyProposal, autoAnswer, setAutoAnswer, grillMe = false, setGrillMe = () => {}, onUploadFile = () => {}, onAddLink = () => {}, sources = [], onDeleteSource = () => {}, onClearChat = () => {}, pendingClarifications = null, onAnswerClarification = () => {}, onDismissClarifications = () => {} }) {
  const endRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const [empty] = useState(messages.length === 0);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Voice input via Web Speech API. We feature-detect on mount so we
  // can hide the mic button on browsers that don't support it
  // (Firefox desktop, older Safari). On the unsupported path, the
  // user can still type — no broken UI.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceSupported(false);
      return;
    }
    setVoiceSupported(true);
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      // Replace, not append, while listening — the interim stream already
      // contains the prefix we showed previously, and committing a final
      // chunk re-emits the whole transcript.
      setInput((prev) => {
        // Drop any prefix the model echoed back from a prior interim.
        const base = interimText ? "" : prev;
        const merged = `${base}${finalText || interimText}`.trim();
        return merged;
      });
    };

    recognition.onerror = (event) => {
      setVoiceListening(false);
      const err = event?.error || "unknown";
      if (err === "no-speech") setVoiceError("Didn't catch that — try again?");
      else if (err === "not-allowed" || err === "service-not-allowed") setVoiceError("Microphone access blocked");
      else setVoiceError(`Voice input failed (${err})`);
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    recognitionRef.current = recognition;
    return () => {
      try { recognition.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, [setInput]);

  const toggleVoice = () => {
    const r = recognitionRef.current;
    if (!r) return;
    if (voiceListening) {
      try { r.stop(); } catch { /* ignore */ }
      setVoiceListening(false);
    } else {
      setVoiceError("");
      try {
        r.start();
        setVoiceListening(true);
      } catch (e) {
        setVoiceError(e?.message || "Could not start voice input");
        setVoiceListening(false);
      }
    }
  };

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
      {messages.length > 0 && (
        <div className="shrink-0 flex justify-end px-4 sm:px-6 pt-4">
          <button
            onClick={onClearChat}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      )}
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
        {voiceSupported && voiceListening && (
          <SpeechWave text={input} />
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
            placeholder={voiceListening ? "Listening…" : "Think out loud…"}
            aria-label="Message the coach"
            className="flex-1 bg-transparent resize-none px-2 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none max-h-40"
            style={{ minHeight: "48px" }}
          />
          {voiceSupported && (
            <button
              type="button"
              data-testid="chat-voice-button"
              onClick={toggleVoice}
              title={voiceListening ? "Stop listening" : "Dictate with your voice"}
              aria-label={voiceListening ? "Stop dictating" : "Dictate with your voice"}
              aria-pressed={voiceListening}
              className={`m-2 h-9 w-9 flex items-center justify-center transition-colors shrink-0 ${
                voiceListening
                  ? "bg-[var(--danger)] text-[var(--bg-primary)] animate-pulse"
                  : "text-[var(--text-muted)] hover:text-[var(--accent)]"
              }`}
            >
              {voiceListening ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
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
        <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="auto-answer-toggle"
              role="switch"
              aria-checked={autoAnswer}
              onClick={() => setAutoAnswer((v) => !v)}
              disabled={grillMe}
              title="When ON: coach makes reasonable assumptions and just proposes. Default mode is OFF — coach may ask 1-2 light clarifying questions before proposing."
              className={`font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                autoAnswer
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : grillMe
                  ? "border-[var(--border)] text-[var(--text-muted)] opacity-40 cursor-not-allowed"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {autoAnswer ? "answering for you" : "coach may ask (light)"}
            </button>
            <button
              type="button"
              data-testid="grill-me-toggle"
              role="switch"
              aria-checked={grillMe}
              onClick={() => setGrillMe((v) => !v)}
              disabled={autoAnswer}
              title="When ON: coach pushes back hard — asks 5+ sharp questions, demands constraints, won't propose until you answer them. Use when you want to be challenged, not coddled."
              className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                grillMe
                  ? "border-[var(--danger)] text-[var(--danger)]"
                  : autoAnswer
                  ? "border-[var(--border)] text-[var(--text-muted)] opacity-40 cursor-not-allowed"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <HelpCircle className="w-3 h-3" /> grill me (intense)
            </button>
          </div>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {voiceError ? (
              <span data-testid="voice-error" className="text-[var(--danger)]">{voiceError}</span>
            ) : voiceListening ? (
              <span data-testid="voice-listening" className="text-[var(--accent)]">● listening — tap mic to stop</span>
            ) : sending ? (
              <span className="text-[var(--accent)]">coach is responding…</span>
            ) : (
              "enter to send · shift+enter = newline"
            )}
          </span>
        </div>

        {pendingClarifications && pendingClarifications.questions?.length > 0 && (
          <div data-testid="clarification-chips" className="mt-2 p-3 border border-[var(--border-accent)]/40 rounded-md bg-[var(--bg-secondary)]">
            <div className="flex items-start gap-2">
              <HelpCircle className="w-4 h-4 mt-0.5 text-[var(--accent)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {pendingClarifications.prompt || "I want to make a real proposal, but I need a couple of details first."}
                </p>
                {/* Claude-style: full-width single-choice options + a free-text fallback input below */}
                <div className="mt-2.5 space-y-1.5">
                  {pendingClarifications.questions.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      data-testid={`clarification-chip-${i}`}
                      onClick={() => onAnswerClarification(q)}
                      className="w-full text-left text-xs leading-relaxed px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
                    >
                      <span className="font-mono text-[10px] text-[var(--text-muted)] mr-2">{String(i + 1).padStart(2, "0")}</span>
                      {q}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <input
                    type="text"
                    data-testid="clarification-free-text"
                    placeholder="Or type your own answer…"
                    aria-label="Type your own answer"
                    className="flex-1 min-w-0 bg-[var(--bg-primary)] border border-[var(--border)] focus:border-[var(--border-accent)] outline-none rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.currentTarget.value.trim()) {
                        onAnswerClarification(e.currentTarget.value);
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </div>
              </div>
              <button
                onClick={onDismissClarifications}
                data-testid="clarification-dismiss"
                title="Dismiss"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
