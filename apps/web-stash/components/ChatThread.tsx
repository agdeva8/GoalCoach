'use client';
import { useEffect, useRef, useState } from 'react';
import { ThinkingIndicator } from './ThinkingIndicator';

type Msg = { role: 'user' | 'assistant'; content: string };

export function ChatThread({ persona }: { persona: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    const userMsg: Msg = { role: 'user', content: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setStreaming(true);
    setError(null);
    setReauthRequired(false);
    setStartedAt(Date.now());
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        setError(`Request failed: ${res.status}`);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n\n')) {
          if (!line.startsWith('data: ')) continue;
          if (line === 'data: [DONE]') continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text') {
              assistant += evt.text;
              setMessages((prev) => {
                const next = [...prev];
                if (next[next.length - 1]?.role === 'assistant') {
                  next[next.length - 1] = { role: 'assistant', content: assistant };
                } else {
                  next.push({ role: 'assistant', content: assistant });
                }
                return next;
              });
            } else if (evt.type === 'error') {
              setError(evt.message);
            } else if (evt.type === 'reauth_required') {
              // The server could not refresh the user's Google token, so
              // Gemini is unreachable until they sign in again.
              setReauthRequired(true);
            }
          } catch {
            // ignore parse errors on partial chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(String(err));
      }
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div>
      {reauthRequired && (
        <div role="alert" aria-live="assertive">
          Your Google session expired. Sign in again to continue.{' '}
          <a href="/api/auth/google?returnTo=/chat">Sign in with Google</a>
        </div>
      )}
      <div role="log" aria-label="chat">
        {messages.length === 0 && <p>Pick a horizon to start.</p>}
        {messages.map((m, i) => (
          <div key={i} data-role={m.role}>
            {m.content}
          </div>
        ))}
        {streaming && (
          <ThinkingIndicator
            startedAt={startedAt}
            persona={persona}
            onCancel={() => abortRef.current?.abort()}
          />
        )}
        {error && <div role="alert">{error}</div>}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        disabled={streaming}
        aria-label="message input"
        placeholder="Type a message"
      />
      <button type="button" onClick={send} disabled={streaming || !input.trim()}>
        Send
      </button>
    </div>
  );
}
