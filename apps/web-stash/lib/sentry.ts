import * as Sentry from '@sentry/nextjs';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV ?? 'development',
  });
  initialized = true;
}

// Replaces any token-shaped string with a placeholder. Used by callers
// (token-store, route handlers) before logging or building Sentry
// payloads. Returning a fixed string means accidental template
// interpolation like `${token}` becomes a literal `[REDACTED]`.
export function redactToken(_token: string | undefined | null): string {
  return '[REDACTED]';
}

// Helper: emit a single 'llm_provider_selected' event when the chat
// route resolves which provider will serve the request. Only the
// provider name is included as a tag — no message content, no user
// identifiers beyond what's already on the request.
export function reportProviderSelected(provider: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('llm_provider', provider);
    Sentry.captureMessage('llm_provider_selected');
  });
}

// Helper: emit a 'token_refresh_failed' event. Accepts a pre-redacted
// payload — caller MUST strip accessToken/refreshToken/request body
// before passing. This helper also drops those keys defensively in
// case the caller forgets.
export interface TokenRefreshFailurePayload {
  userId: string;
  httpStatus: number | null;
  code: string;
  accessToken?: string;
  refreshToken?: string;
  [k: string]: unknown;
}

export function reportTokenRefreshFailed(payload: TokenRefreshFailurePayload): void {
  const safe: Record<string, unknown> = {
    userId: payload.userId,
    httpStatus: payload.httpStatus,
    code: payload.code,
  };
  // Defensive: strip any token-shaped key the caller may have included.
  for (const k of Object.keys(payload)) {
    if (/(token|refresh)/i.test(k)) continue;
    safe[k] = payload[k];
  }
  Sentry.withScope((scope) => {
    scope.setTag('userId', String(payload.userId));
    scope.setTag('httpStatus', payload.httpStatus == null ? 'unknown' : String(payload.httpStatus));
    scope.setTag('code', payload.code);
    for (const [k, v] of Object.entries(safe)) {
      scope.setExtra(k, v);
    }
    Sentry.captureMessage('token_refresh_failed');
  });
}
