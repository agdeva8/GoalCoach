// Boot-time env validation. Call assertEnv() at the top of any route
// or server entry that needs Supabase + an LLM provider. Throws with
// the missing key name so a misconfigured deploy fails loud, not silent.
//
// Supabase 2024+ renamed the project keys from anon/service_role to
// publishable/secret. We accept either pair so old + new projects both
// work; if both are set, the new pair wins (more secure by default).
//
// Gemini OAuth is opt-in. GOOGLE_GEMINI_CLIENT_ID and
// GOOGLE_GEMINI_CLIENT_SECRET must be set together (paired). LLM_PROVIDER
// is retained for backwards compatibility and has no effect on provider
// resolution: resolution is row > 'gemini' default (lib/llm-provider +
// migration 0008, per the L1 "Gemini only" spec).

export type Env = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  LLM_PROVIDER: string;
  GOOGLE_GEMINI_CLIENT_ID: string;
  GOOGLE_GEMINI_CLIENT_SECRET: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
};

function pickAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function pickServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function assertEnv(): Env {
  const anon = pickAnonKey();
  const service = pickServiceRoleKey();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anthropic = process.env.ANTHROPIC_API_KEY;

  const missing: string[] = [];
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!anon)
    missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)');
  if (!service)
    missing.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)');
  if (!anthropic) missing.push('ANTHROPIC_API_KEY');

  // Paired validation: Gemini client_id and client_secret must both be
  // set or both be unset. A misconfiguration with only one present is
  // almost certainly a copy-paste mistake in Vercel env.
  const hasGeminiId = !!process.env.GOOGLE_GEMINI_CLIENT_ID;
  const hasGeminiSecret = !!process.env.GOOGLE_GEMINI_CLIENT_SECRET;
  if (hasGeminiId !== hasGeminiSecret) {
    throw new Error(
      'GOOGLE_GEMINI_CLIENT_ID and GOOGLE_GEMINI_CLIENT_SECRET must be paired (both set or both unset). See DEPLOY.md.'
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. See DEPLOY.md.`
    );
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: url!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon!,
    SUPABASE_SERVICE_ROLE_KEY: service!,
    ANTHROPIC_API_KEY: anthropic!,
    // Retained for backwards compatibility; no effect on provider
    // resolution (lib/llm-provider resolves row > 'gemini' default).
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? '',
    GOOGLE_GEMINI_CLIENT_ID: process.env.GOOGLE_GEMINI_CLIENT_ID ?? '',
    GOOGLE_GEMINI_CLIENT_SECRET: process.env.GOOGLE_GEMINI_CLIENT_SECRET ?? '',
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };
}
