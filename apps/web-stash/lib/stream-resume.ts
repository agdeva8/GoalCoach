// Lightweight, stable, opaque token a client can pass back to /api/chat
// to resume from a known offset after a cold refresh.
// Format: <threadId>.<lastIndex>
//
// Trade-off: readable for debugging, not cryptographically signed.
// For Phase 1 the route guards by user session anyway; signing can come
// in v1.1 if abused.

export type ResumeState = {
  threadId: string;
  lastIndex: number;
};

export function makeResumeToken(threadId: string, lastIndex: number): string {
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) {
    throw new Error(`invalid threadId: ${threadId}`);
  }
  if (!Number.isInteger(lastIndex) || lastIndex < 0) {
    throw new Error(`invalid lastIndex: ${lastIndex}`);
  }
  return `${threadId}.${lastIndex}`;
}

export function parseResumeToken(token: string): ResumeState | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [threadId, idxStr] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) return null;
  const lastIndex = Number(idxStr);
  if (!Number.isInteger(lastIndex) || lastIndex < 0) return null;
  return { threadId, lastIndex };
}
