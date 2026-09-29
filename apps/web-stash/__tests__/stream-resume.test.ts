import { describe, it, expect } from 'vitest';
import { makeResumeToken, parseResumeToken } from '@/lib/stream-resume';

describe('stream-resume token', () => {
  it('encodes thread id and last message index', () => {
    const tok = makeResumeToken('thread-1', 7);
    const decoded = parseResumeToken(tok);
    expect(decoded).toEqual({ threadId: 'thread-1', lastIndex: 7 });
  });

  it('returns null for malformed token', () => {
    expect(parseResumeToken('garbage')).toBeNull();
    expect(parseResumeToken('')).toBeNull();
    expect(parseResumeToken('a.b.c.d')).toBeNull();
  });

  it('round-trips zero index', () => {
    const tok = makeResumeToken('t', 0);
    expect(parseResumeToken(tok)).toEqual({ threadId: 't', lastIndex: 0 });
  });

  it('different threads yield different tokens', () => {
    const a = makeResumeToken('thread-a', 5);
    const b = makeResumeToken('thread-b', 5);
    expect(a).not.toBe(b);
  });
});
