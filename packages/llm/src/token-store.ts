import type { AnySupabase } from './types';

const REFRESH_BUFFER_MS = 60_000;
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export class TokenError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    // Always include the code in the message so callers can match on it
    // via `toThrow(/<code>/)` without coupling to a specific descriptive
    // text.
    super(message ? `[${code}] ${message}` : code);
    this.code = code;
    this.name = 'TokenError';
  }
}

interface UserTokenRow {
  gemini_access_token: string | null;
  gemini_refresh_token: string | null;
  gemini_token_expiry: string | null;
}

// In-flight refresh coalescing. Multiple concurrent callers for the same
// user must trigger exactly one Google refresh round-trip. The Map holds
// the in-flight promise; subsequent callers await the same one.
const inFlight = new Map<string, Promise<string>>();

export function clearInFlightRefresh(): void {
  inFlight.clear();
}

// Best-effort log of token refresh failures without leaking the token
// itself. Used by the caller (chat route) to wire up Sentry. Tests assert
// the token string is absent from the redacted payload.
export interface TokenRefreshFailure {
  userId: string;
  httpStatus: number | null;
  code: string;
  // Pass-through metadata the caller can include in a Sentry event.
  // Never include accessToken, refreshToken, or request body here.
}

export function redactTokenFailure(
  userId: string,
  err: TokenError,
  httpStatus: number | null
): TokenRefreshFailure {
  return { userId, httpStatus, code: err.code };
}

function isNearExpiry(expiryIso: string | null): boolean {
  if (!expiryIso) return true; // unknown expiry → treat as near to force a check
  const ms = new Date(expiryIso).getTime() - Date.now();
  return ms < REFRESH_BUFFER_MS;
}

async function refreshAccessToken(
  supabase: AnySupabase,
  userId: string,
  refreshToken: string
): Promise<string> {
  const clientId = process.env.GOOGLE_GEMINI_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GEMINI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new TokenError(
      'refresh_failed',
      'GOOGLE_GEMINI_CLIENT_ID/SECRET not configured; cannot refresh token'
    );
  }

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // NOTE: refresh_token is sent to Google. Never log the body or the
    // resulting access_token — the redaction helper above enforces this.
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new TokenError('refresh_failed', `Google refresh endpoint returned ${res.status}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const newExpiry = new Date(Date.now() + json.expires_in * 1000).toISOString();

  // Persist the refreshed token. RLS lets a user update their own row
  // via cookie-scoped client; service-role is not required.
  await supabase
    .from('users')
    .update({
      gemini_access_token: json.access_token,
      gemini_token_expiry: newExpiry,
    })
    .eq('id', userId);

  return json.access_token;
}

// Public entry point. Cache hit returns the existing access token; near
// expiry triggers a refresh that is coalesced across concurrent callers
// for the same userId.
export async function getValidGeminiToken(
  supabase: AnySupabase,
  userId: string
): Promise<string> {
  const { data: row, error } = await supabase
    .from('users')
    .select('gemini_access_token, gemini_refresh_token, gemini_token_expiry')
    .eq('id', userId)
    .single() as { data: UserTokenRow | null; error: any };

  if (error || !row) {
    throw new TokenError('no_gemini_token', 'could not read user tokens');
  }
  if (!row.gemini_access_token) {
    throw new TokenError('no_gemini_token', 'no Gemini access token on file');
  }

  if (!isNearExpiry(row.gemini_token_expiry)) {
    return row.gemini_access_token;
  }

  // Coalesce concurrent refreshes for the same user.
  const existing = inFlight.get(userId);
  if (existing) return existing;

  if (!row.gemini_refresh_token) {
    throw new TokenError('no_refresh_token', 'no Gemini refresh token on file');
  }

  const promise = refreshAccessToken(supabase, userId, row.gemini_refresh_token)
    .finally(() => {
      inFlight.delete(userId);
    });
  inFlight.set(userId, promise);
  return promise;
}
