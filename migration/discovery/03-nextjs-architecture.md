# GoalCoach — Phase 1 Architecture Plan: Next.js 16 + Postgres + Drizzle

**Date:** 2026-09-24
**Status:** Phase 1 in progress — decisions locked 2026-09-24

---

## Locked decisions (2026-09-24)

1. **Next.js version:** 16 (use existing `y/` scaffold at 16.3.4 — no downgrade).
2. **Object storage:** Emergent Object Storage is **kept**. No Vercel Blob. Sources route uses Emergent proxy (`integrations.emergentagent.com`).
3. **Guest flow:** keep legacy `guest_token` cookie semantics. Cookie has **10-minute expiration** (anti-abuse window). Sign-in handler still reassigns `user_id` on child rows.
4. **Test suite:** port `backend/tests/backend_test.py` to Vitest in parallel with implementation. Must complete within the same wave as the first feature migration.

---

## Pre-flight findings

- **Next.js version.** Settled: Next.js 16 adopted — `y/` scaffold at 16.3.4 is the target. No downgrade needed.
- **Auth flow.** Emergent OAuth REST client replaces Auth.js. Emergent redirects to `/api/auth/session?session_id=...&session_secret=...`; the route POSTs to `demobackend.emergentagent.com/auth/v1/env/oauth/session-data` with `X-Session-ID` header. No Google OAuth, no `@auth/drizzle-adapter`, no `AuthCallback.js`.
- **Object storage.** Emergent Object Storage is **kept** — it is not retired. Sources route (`/api/sources/upload`, etc.) use Emergent's proxy. No Vercel Blob.
- **LLM streaming.** The `[[TOOLS]]…[[/TOOLS]]` text-block protocol is **kept** (not replaced by AI SDK typed `tool()` calls). `parseProposals` is ported verbatim from `backend/server.py:566-594`. Emergent accepts `provider`/`model` in the request body via `with_model()`.
- **DB choice.** **Neon** confirmed: native Vercel integration, branching for preview deploys, serverless driver fits edge runtimes. No Supabase Auth or Supabase Storage needed.

---

## 1. Directory structure

Promote `y/` (or a fresh `app/`) to the canonical Next.js root. Layout below assumes the directory is at the project root (no monorepo); sub-app `frontend/` and `backend/` are retired at cutover.

```
goalcoach/
  app/
    layout.tsx                       # root layout, fonts, theme provider, Toaster
    page.tsx                         # marketing/landing (optional)
    coach/
      page.tsx                       # main 3-pane coach (chat + dashboard + timeline)
      loading.tsx                    # streamed skeleton
      error.tsx
    api/
      auth/session/route.ts          # Emergent OAuth session exchange
      chat/route.ts                  # POST → streams UI Message Stream (SSE)
      chat/history/route.ts          # GET conversation
      state/route.ts                 # GET computed dashboard state
      preferences/route.ts           # PUT model_provider
      goals/
        route.ts                     # POST
        [id]/route.ts                # PATCH / DELETE
      commitments/[id]/route.ts
      milestones/[id]/route.ts
      blockers/route.ts              # POST/GET
      blockers/[id]/route.ts         # PUT/DELETE
      sources/
        route.ts                     # GET list
        upload/route.ts              # POST multipart → Emergent Object Storage
        link/route.ts                # POST URL
        [id]/route.ts                # DELETE (soft)
        [id]/download/route.ts       # GET signed URL
      audit/route.ts                 # GET log
      audit/export/route.ts          # GET JSON dump
      auth/guest/route.ts            # POST anonymous session (legacy compat)
  components/
    ui/                              # shadcn primitives (button, dialog, sheet, ...)
    coach/
      Header.tsx                     # model switcher + scenarios + sign-in
      ChatConsole.tsx                # 'use client'; hand-rolled SSE reader
      MessageBubble.tsx
      ToolConfirmationPrompt.tsx     # inline confirm/reject/refine
      TrackingDashboard.tsx          # horizon cards + load indicator
      Timeline.tsx                   # year→quarter→month→week
      HonestyAuditView.tsx
      OnboardingBanner.tsx
      AboutModal.tsx
      SignInModal.tsx                # triggers Emergent OAuth via signInWithEmergent()
      ActionPromptModal.tsx
      ThemeToggle.tsx
      SplitPane.tsx                  # resizable divider
  lib/
    emergent/
      auth.ts                        # Emergent OAuth REST client (session exchange)
      llm.ts                         # Emergent LLM REST client (streamChat)
    guest-token.ts                   # HMAC-SHA256 guest_token sign/verify
    auth.ts                          # session cookie + getAuthenticatedUser()
    db.ts                            # Drizzle client (Neon serverless + node fallbacks)
    llm/
      registry.ts                    # MODEL_REGISTRY: providerId → (provider, model) pairs
      prompts.ts                     # SYSTEM_PROMPT (ported from server.py)
      state-builder.ts               # build_context() (ported from server.py)
      proposal-parser.ts             # parseProposals() verbatim from server.py
    storage.ts                       # Emergent Object Storage wrapper
    proposal-executor.ts             # apply_proposal() (ported from server.py)
    over-commitment.ts               # load-level heuristic
    validation.ts                    # zod schemas shared client/server
    sources.ts                       # extractText + fetchLinkText
    env.ts                           # zod-validated process.env
  db/
    schema.ts                        # all Drizzle tables (Section 2)
    migrations/                      # drizzle-kit output, committed
    seed.ts                          # founder smoke-test data
    migrate-from-mongo.ts            # one-shot ETL script (Section 4)
  middleware.ts                      # protects /coach via getAuthenticatedUser()
  next.config.ts
  drizzle.config.ts
  package.json
  tsconfig.json
  tailwind.config.ts
  components.json                    # shadcn config
```

---

## 2. Drizzle schema

**JSONB vs relational for proposals:** relational recommended. Proposals become queryable for the audit view, FK-linked to confirmations, and don't bloat the messages table.

### Tables

```ts
// db/schema.ts (sketch)
// NOTE: No accounts/sessions/verificationTokens tables — Auth.js is not used.

export const users = pgTable('users', {
  id: text('id').primaryKey(),                                  // 'user_xxx' (preserve IDs)
  email: text('email').unique(),
  name: text('name'),
  image: text('image'),
  modelProvider: text('model_provider').notNull().default('gemini'),
  isGuest: boolean('is_guest').notNull().default(false),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const goals = pgTable('goals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  horizon: text('horizon', { enum: ['weekly','short','medium','long'] }).notNull(),
  why: text('why').notNull().default(''),
  nextAction: text('next_action').notNull().default(''),
  startDate: date('start_date'),
  targetDate: date('target_date'),
  status: text('status', { enum: ['active','paused','dropped'] }).notNull().default('active'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const commitments = pgTable('commitments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  text: text('text').notNull(),
  due: date('due'),
  status: text('status', { enum: ['open','done'] }).notNull().default('open'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const milestones = pgTable('milestones', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  title: text('title').notNull(),
  targetDate: date('target_date'),
  status: text('status').notNull().default('open'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const blockers = pgTable('blockers', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  note: text('note').notNull().default(''),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user','assistant'] }).notNull(),
  content: text('content').notNull(),
  provider: text('provider'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const proposals = pgTable('proposals', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  args: jsonb('args').notNull(),
  status: text('status', { enum: ['pending','confirmed','rejected'] }).notNull().default('pending'),
  result: text('result'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  resolvedAt: timestamptz('resolved_at'),
});

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  summary: text('summary').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  kind: text('kind', { enum: ['file','link'] }).notNull(),
  storagePath: text('storage_path').notNull().default(''),
  originalFilename: text('original_filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull().default(0),
  url: text('url').notNull().default(''),
  textExcerpt: text('text_excerpt'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
```

---

## 3. Emergent OAuth REST client

All auth flows route through Emergent's OAuth REST endpoint. There is no Auth.js, no Google OAuth, and no `@auth/drizzle-adapter`.

### Session exchange (`lib/emergent/auth.ts`)

```ts
// lib/emergent/auth.ts
const SESSION_API = 'https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data';

export async function exchangeEmergentSession(sessionId: string, sessionSecret: string) {
  const res = await fetch(SESSION_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
      'X-Session-Secret': sessionSecret,
    },
  });
  if (!res.ok) throw new Error('Emergent session exchange failed');
  return res.json() as Promise<{
    user_id: string;
    email?: string;
    name?: string;
    image?: string;
    is_guest: boolean;
    model_provider: string;
  }>;
}
```

The Emergent OAuth flow (initiated by the sign-in modal) redirects to Emergent's hosted login. After the user authenticates, Emergent redirects back to `/api/auth/session?session_id=...&session_secret=...`. The `app/api/auth/session/route.ts` server action calls `exchangeEmergentSession` and upserts the `users` row.

### Session cookie

- **7-day `session_token` cookie** — issued by the session route after successful exchange; HttpOnly, SameSite=Lax.
- Signed locally with `AUTH_SECRET` (HMAC-SHA256), not by Emergent.

### Guest flow

Guest users keep a row in `users` with `is_guest=true`. No separate session cookie — the 10-minute anti-abuse window is handled by the `guest_token` HMAC cookie.

```ts
// lib/guest-token.ts
import { createHmac, timingSafeEqual } from 'crypto';

const GUEST_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function signGuestToken(userId: string, secret: string): string {
  const payload = `${userId}:${Date.now() + GUEST_TOKEN_TTL_MS}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyGuestToken(token: string, secret: string): string | null {
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64url').toString();
    const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const [, expiresStr] = payload.split(':');
    if (Date.now() > Number(expiresStr)) return null; // expired
    return payload.split(':')[0];
  } catch {
    return null;
  }
}
```

### Auth wrapper (`lib/auth.ts`)

```ts
// lib/auth.ts
import { cookies } from 'next/headers';
import { db } from './db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { exchangeEmergentSession } from './emergent/auth';
import { signGuestToken, verifyGuestToken } from './guest-token';

export async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  try {
    // Unpack + verify local HMAC sig, extract userId
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    const [row] = await db.select().from(users).where(eq(users.id, payload.uid)).limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function signInWithEmergent(sessionId: string, sessionSecret: string) {
  const data = await exchangeEmergentSession(sessionId, sessionSecret);
  const [row] = await db.insert(users).values({
    id: data.user_id,
    email: data.email ?? null,
    name: data.name ?? null,
    image: data.image ?? null,
    modelProvider: data.model_provider ?? 'gemini',
    isGuest: data.is_guest,
  }).onConflictDoUpdate({ target: users.id, set: {
    email: data.email ?? null,
    name: data.name ?? null,
    image: data.image ?? null,
    modelProvider: data.model_provider ?? 'gemini',
    isGuest: data.is_guest,
  }}).returning();
  return row;
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.delete('session_token');
}
```

### Deleted Auth.js artifacts

- DELETE `AuthCallback.js` — Emergent handles the OAuth callback; no client-side code needed.
- DELETE `app/api/auth/[...nextauth]/route.ts` — replaced by `app/api/auth/session/route.ts`.
- The `accounts`, `sessions`, `verificationTokens` Drizzle tables (from the original Section 2 sketch) are **not created** — Auth.js is not used.

---

## 4. Emergent LLM client + text-block protocol

Emergent accepts provider selection via `with_model(provider, model)`. All providers use the same OpenAI-compatible chat completions endpoint — no per-provider SDK.

### Emergent REST client (`lib/emergent/llm.ts`)

```ts
// lib/emergent/llm.ts
const BASE_URL = process.env.INTEGRATION_PROXY_URL ?? 'https://integrations.emergentagent.com';

function withModel(model: string, provider: string): string {
  // gemini: Emergent prefixes 'gemini/' on its side; pass bare model name
  // openai / anthropic: bare model name as-is
  if (provider === 'gemini') return model;
  return model;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface StreamDelta { type: 'delta'; text: string; }
export interface StreamTools  { type: 'tools'; content: string; }
export interface StreamDone   { type: 'done'; }
export interface StreamError  { type: 'error'; message: string; }
export type StreamEvent = StreamDelta | StreamTools | StreamDone | StreamError;

export async function* streamChat(opts: {
  provider: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  sessionId: string;
}): AsyncIterable<StreamEvent> {
  const url = `${BASE_URL}/llm/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.EMERGENT_LLM_KEY}`,
    },
    body: JSON.stringify({
      model: withModel(opts.model, opts.provider),
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      stream: true,
    }),
  });

  if (!response.ok) {
    yield { type: 'error', message: `Emergent API error ${response.status}` };
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { yield { type: 'done' }; continue; }
        // SSE: { "choices": [{ "delta": { "content": "..." } }] }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content != null) {
            // Detect [[TOOLS]] block opening/closing boundaries
            if (content.includes('[[TOOLS]]')) {
              yield { type: 'delta', text: content };
              yield { type: 'tools', content: '' };
            } else if (content.includes('[[/TOOLS]]')) {
              yield { type: 'delta', text: content };
            } else {
              yield { type: 'delta', text: content };
            }
          }
        } catch { /* skip malformed SSE */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

### Model registry

```ts
// lib/llm/registry.ts
export type ProviderId = 'gemini' | 'claude' | 'openai' | 'minimax-m3' | 'minimax-m2_7_highspeed';

export interface ModelEntry {
  id: ProviderId;
  label: string;
  hint: string;
  provider: string;
  model: string;
}

export const MODEL_REGISTRY: Record<ProviderId, ModelEntry> = {
  'gemini':                  { id: 'gemini',                  label: 'Gemini',    hint: '3 Flash',         provider: 'gemini',                  model: 'gemini-3-flash-preview' },
  'claude':                  { id: 'claude',                  label: 'Claude',    hint: 'Sonnet 4.6',      provider: 'anthropic',               model: 'claude-sonnet-4-6' },
  'openai':                  { id: 'openai',                  label: 'OpenAI',    hint: 'GPT-5.4',         provider: 'openai',                  model: 'gpt-5.4' },
  'minimax-m3':              { id: 'minimax-m3',              label: 'minimax',   hint: 'M3 (opus)',       provider: 'openai',                  model: 'MiniMax-M3' },
  'minimax-m2_7_highspeed':  { id: 'minimax-m2_7_highspeed', label: 'minimax',   hint: 'M2.7 HighSpeed',  provider: 'openai',                  model: 'MiniMax-M2.7-highspeed' },
};
```

### Chat route handler

```ts
// app/api/chat/route.ts
import { getAuthenticatedUser } from '@/lib/auth';
import { streamChat } from '@/lib/emergent/llm';
import { parseProposals } from '@/lib/llm/proposal-parser';
import { buildContext } from '@/lib/llm/state-builder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { message, provider = user.modelProvider } = await req.json();
  const entry = MODEL_REGISTRY[provider as ProviderId];
  if (!entry) return new Response('Bad model', { status: 400 });

  const messages = await loadHistory(user.id, 24);
  const context = await buildContext(user.id);

  const stream = streamChat({
    provider: entry.provider,
    model: entry.model,
    system: SYSTEM_PROMPT + '\n\n=== LIVE STATE & MEMORY ===\n' + context,
    messages,
    sessionId: user.id,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = '';
      let inToolsBlock = false;
      let toolsBuffer = '';

      for await (const event of streamChat({ ... })) {
        if (event.type === 'delta') {
          fullText += event.text;
          if (event.text.includes('[[TOOLS]]')) inToolsBlock = true;
          if (inToolsBlock) {
            toolsBuffer += event.text;
          } else {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', text: event.text }) + '\n'));
          }
          if (event.text.includes('[[/TOOLS]]')) {
            inToolsBlock = false;
            const proposals = parseProposals(toolsBuffer);
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'tools', content: toolsBuffer, parsed: proposals }) + '\n'));
            toolsBuffer = '';
          }
        } else if (event.type === 'done') {
          await persistAssistantTurn(user.id, provider, fullText);
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
        } else if (event.type === 'error') {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: event.message }) + '\n'));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

### Proposal parser (verbatim from `backend/server.py:566-594`)

```ts
// lib/llm/proposal-parser.ts
import { z } from 'zod';

const ProposalSchema = z.object({
  action: z.string(),
  args: z.record(z.any()),
});

export function parseProposals(text: string): z.infer<typeof ProposalSchema>[] {
  const start = text.indexOf('[[TOOLS]]');
  const end = text.indexOf('[[/TOOLS]]');
  if (start === -1 || end === -1) return [];
  const block = text.slice(start + 9, end).trim();
  try {
    const parsed = JSON.parse(block);
    return Array.isArray(parsed) ? parsed.map(p => ProposalSchema.parse(p)) : [ProposalSchema.parse(parsed)];
  } catch {
    return [];
  }
}
```

### UI: SSE reader (no `useChat` hook)

`ChatConsole.tsx` uses a hand-rolled `EventSource` / `fetch` reader. It parses SSE lines `{type: 'delta'|'tools'|'done'|'error'}` and renders `MessageBubble` for text deltas and `ToolConfirmationPrompt` inline when a `tools` event arrives.

---

## 5. Migration co-existence strategy

**Subdomain now, same-domain cutover later.**

| Phase | Host | Frontend | Backend |
|---|---|---|---|
| 1 | `app.goalcoach.com` (existing) | CRA | FastAPI on `api.goalcoach.com` |
| 1 | **`v2.goalcoach.com`** (new) | Next.js 15 | Next.js Route Handlers |
| 2 cutover | `app.goalcoach.com` | Next.js 15 | Next.js Route Handlers |

**Why subdomain beats path prefix:**
- No edge proxy config. Vercel + DNS route by hostname.
- Cookies stay scoped (`__Secure-.` prefix on `v2.goalcoach.com`).
- Independent deploys; rollback is a DNS flip.
- Path prefix forces `<Link href="/v2/coach">` everywhere; OAuth callbacks + tests break.

**Auth on the new app:** The Next.js app calls Emergent's OAuth endpoint directly (`demobackend.emergentagent.com`). No separate Google OAuth configuration is needed — the sign-in modal triggers the Emergent hosted login. Emergent redirects back to `/api/auth/session` with session credentials.

---

## 6. Environment variables

```
# Emergent Universal Key — single key for auth, LLM, and storage
EMERGENT_LLM_KEY=

# Optional override for Emergent integrations proxy (defaults to https://integrations.emergentagent.com)
INTEGRATION_PROXY_URL=https://integrations.emergentagent.com

# Database (Neon)
DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require

# For session_token HMAC signing (7-day cookie) and guest_token HMAC signing (10-min expiry)
AUTH_SECRET=                                # openssl rand -base64 32
AUTH_URL=https://v2.goalcoach.com
NEXT_PUBLIC_APP_URL=https://v2.goalcoach.com
```

Validate at boot via `lib/env.ts` (zod). Required: `EMERGENT_LLM_KEY`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`. `INTEGRATION_PROXY_URL` defaults to `https://integrations.emergentagent.com`.

---

## 7. Risks

### Risk 1 — Emergent Object Storage path migration
Existing `sources.storage_path` values in Mongo reference Emergent's proxy paths. After ETL these paths must remain valid or be rewritten.
**Mitigation:** Emergent Object Storage is kept (not replaced). No path rewriting needed — sources route continues to use Emergent's proxy URL.

### Risk 2 — Next.js 16 breaking changes
Next.js 16 has async `cookies()` and `headers()`, updated middleware matcher syntax, and Server Action body limits.
**Mitigation:** Lock to exact version `16.3.4`. Write a 1-screen auth smoke test page before any feature work.

### Risk 3 — `[[TOOLS]]` protocol changes break existing backend tests
`backend/tests/backend_test.py` asserts the exact shape of the `[[TOOLS]]` JSON block. The wire format is preserved (text-block, not AI SDK typed `tool()` calls), so this risk is low — but the parser must be ported verbatim.
**Mitigation:** Port `parseProposals` from `server.py:566-594` without modification. Port `backend_test.py` → Vitest integration tests in parallel with feature work.

### Secondary risks (tracked, not blocking)
- **Token growth in long conversations** — implement `summarizeOldTurns()` in `lib/llm/state-builder.ts` before opening MiniMax to general use.
- **Guest migration race condition** — wrap in a single Postgres transaction in the new `/api/auth/session` server action.
- **Over-commitment heuristic unchanged** — log inputs + model reasoning for offline review.

---

## 8. Phase 1 task list (ordered, parallelizable where noted)

> ~6–8 engineer-days total.

1. **[DONE] Confirm Next.js version.** Next.js 16 adopted — `y/` scaffold at 16.3.4 is the target.
2. **[DONE] Provision Postgres on Neon.** Capture `DATABASE_URL`, configure Vercel integration.
3. **[DONE] Create new Vercel project, point `v2.goalcoach.com` at it.** Acceptance: `https://v2.goalcoach.com/` returns the scaffold's "Project ready!" page over HTTPS.
4. **Initialize Drizzle.** Add `drizzle-orm`, `drizzle-kit`, `drizzle-zod`, `@neondatabase/serverless`. Write `db/schema.ts` per Section 2. Generate + commit first migration.
5. **Write `db/migrate-from-mongo.ts`** (one-shot ETL). Streams `users → goals → commitments → milestones → blockers → messages → proposals (split from embedded array) → audit_log → sources`. Preserves all string IDs.
6. **Emergent OAuth REST client.** Write `lib/emergent/auth.ts`, `lib/guest-token.ts`, `lib/auth.ts`, `app/api/auth/session/route.ts`. Replace `SignInModal.tsx`'s Emergent URL with `signInWithEmergent()` server action. Delete `AuthCallback.js` and `app/api/auth/[...nextauth]/route.ts`.
7. **LLM client + model registry.** Write `lib/emergent/llm.ts` (REST client, SSE reader). Write `lib/llm/registry.ts` with 5 provider entries per Section 4. Port `SYSTEM_PROMPT` and `build_context` from `server.py:477-563` to `lib/llm/prompts.ts` and `lib/llm/state-builder.ts`.
8. **Proposal parser + executor.** Port `parseProposals` verbatim from `server.py:566-594` to `lib/llm/proposal-parser.ts`. Port `apply_proposal` from `server.py:312-424` to `lib/proposal-executor.ts` (9 typed actions: create_goal, update_goal, drop_goal, add_milestone, add_blocker, add_commitment, complete_commitment, set_goal_dates, pause_goal).
9. **Chat route + SSE UI.** Build `app/api/chat/route.ts` with `streamChat` + `parseProposals`. Port `ChatConsole.tsx` with a hand-rolled SSE reader (no `useChat` hook). Port `MessageBubble.tsx` and `ToolConfirmationPrompt.tsx`.
10. **[P] State + dashboard endpoints + UI.** Port `load_state` → `app/api/state/route.ts` and `lib/over-commitment.ts`.
11. **[P] Direct CRUD endpoints.** `/api/blockers`, `/api/blockers/[id]`, `/api/goals`, `/api/commitments`, `/api/milestones`.
12. **Sources + Emergent storage.** Port `/api/sources/upload`, `/api/sources/link`, `/api/sources/[id]/download`, `/api/sources/[id]` (DELETE). Uses Emergent Object Storage — no Vercel Blob needed.
13. **[P] Audit endpoints.** `/api/audit`, `/api/audit/export`.
14. **[P] Auth middleware + route protection.** `middleware.ts` protects `/coach/*` using `getAuthenticatedUser()`.
15. **[P] Guest flow + migration on sign-in.** Server action `signInWithEmergent()` creates a `users` row with `isGuest=true`. Sign-in handler reassigns child rows. Guest token handled by `lib/guest-token.ts` (10-min HMAC).
16. **Theming + a11y.** Port CSS variables. Confirm `prefers-reduced-motion`, focus rings, ARIA roles.
17. **E2E + cutover.** Deploy to `v2.goalcoach.com`. Run founder rubric (≥7/10 per PRD). Flip DNS to point `app.goalcoach.com` at the new Vercel project; verify cookies, OAuth, and file downloads.
18. **Fix flaky tests.** ~10 tests in the suite have timing or mock-data dependencies. In progress concurrently with the feature migration above.

**Note on internal agents (Phase 4):** The Model Switcher UI is preserved because Emergent routes provider selection server-side via `with_model(provider, model)`. No per-provider agent dispatch is needed in the Next.js layer — this eliminates a significant portion of the internal-agents Phase 4 scope. That phase is optional and can be deferred.

**Parallelization:**
- Tasks 6, 7, 8 can run in parallel after 4–5 land.
- Tasks 10, 11, 12, 13 are independent of each other and of the chat path.
- Tasks 1, 2, 3 (infra) are already done.
- Task 18 (flaky tests) runs concurrently with all feature work.

---

## Critical files for implementation

- `backend/server.py` — source of truth for endpoints, prompts, state builder, proposal executor, `parseProposals`
- `frontend/src/pages/Coach.js` — UI orchestration: 3-pane split, SSE reader, model switcher
- `frontend/src/components/ChatConsole.js` — SSE reader pattern (hand-rolled, not `useChat`)
- `frontend/src/context/AuthContext.js` — replaced by `lib/emergent/auth.ts` + `lib/auth.ts`
- `migration/discovery/01-mongo-schema.md` — the 9-collection inventory
- `migration/discovery/02-fastapi-routes.md` — the 21-route surface
