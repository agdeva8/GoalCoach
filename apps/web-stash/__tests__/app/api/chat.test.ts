import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

const mockCreateHandlers = vi.fn();
const mockCreateLLMClient = vi.fn();
const mockReportProviderSelected = vi.fn();
const mockReportTokenRefreshFailed = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

vi.mock('@/lib/ai/handlers', () => ({
  createHandlers: (...args: any[]) => mockCreateHandlers(...args),
}));

vi.mock('@/lib/sentry', () => ({
  initSentry: vi.fn(),
  reportProviderSelected: (...args: any[]) => mockReportProviderSelected(...args),
  reportTokenRefreshFailed: (...args: any[]) => mockReportTokenRefreshFailed(...args),
}));

vi.mock('@goalcoach/llm', () => ({
  createLLMClient: (...args: any[]) => mockCreateLLMClient(...args),
}));

vi.mock('@goalcoach/db', async () => {
  const actual = await vi.importActual<any>('@goalcoach/db');
  return { ...actual, getUserAreaPreferences: vi.fn().mockResolvedValue([]) };
});

import { POST } from '@/app/api/chat/route';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveProvider } from '@/lib/llm-provider';

interface UserRow {
  id: string;
  llm_provider?: 'anthropic' | 'gemini' | null;
}

function makeSupabase(user: any = { id: 'u1' }, userRow: UserRow | null = { id: 'u1' }) {
  const goalsChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  };
  const threadsChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 't' }, error: null }),
      }),
    }),
  };
  const usersChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: userRow, error: null }),
      }),
    }),
    // ensureUserExists() (called from appendThread) uses upsert with
    // ignoreDuplicates so the chain doesn't need to return anything else.
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'users') return usersChain;
      if (table === 'goals') return goalsChain;
      if (table === 'threads') return threadsChain;
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function makeStreamClient(events: any[]): { send: (m: any, t: any) => AsyncIterable<any> } {
  return {
    send(_messages: any, _tools: any) {
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
  };
}

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateHandlers.mockReturnValue({
      list_goals: vi.fn(async () => [{ id: 'g1', title: 'existing goal' }]),
      create_goal: vi.fn(async () => ({ id: 'g2', title: 'new' })),
    });
    process.env.LLM_PROVIDER = '';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
  });

  it('executes tool_use event and re-prompts with tool_result', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());

    let callIndex = 0;
    const callArgs: any[] = [];
    mockCreateLLMClient.mockImplementation(() => ({
      send: vi.fn((_m: any, _t: any) => {
        callArgs.push(_m);
        if (callIndex === 0) {
          callIndex++;
          return (async function* () {
            yield { type: 'tool_use', id: 'tool_1', name: 'list_goals', input: {} };
            yield { type: 'done' };
          })();
        }
        return (async function* () {
          yield { type: 'text', text: 'You have one goal.' };
          yield { type: 'done' };
        })();
      }),
    }));

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'show my goals' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const text = await readAll(res);
    expect(text).toContain('tool_use');
    expect(text).toContain('list_goals');
    expect(text).toContain('You have one goal');
  });

  it('uses users.llm_provider when set, overriding the default', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { id: 'u1', llm_provider: 'anthropic' })
    );

    let createdProvider: string | undefined;
    mockCreateLLMClient.mockImplementation((deps: any) => {
      createdProvider = deps.provider;
      return makeStreamClient([{ type: 'text', text: 'anthropic wins' }, { type: 'done' }]);
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createdProvider).toBe('anthropic');
  });

  it('falls back to the gemini default when users.llm_provider is unset', async () => {
    (getServerSupabase as any).mockResolvedValue(
      // user row has no llm_provider
      makeSupabase({ id: 'u1' }, { id: 'u1' })
    );

    let createdProvider: string | undefined;
    mockCreateLLMClient.mockImplementation((deps: any) => {
      createdProvider = deps.provider;
      return makeStreamClient([{ type: 'text', text: 'hi' }, { type: 'done' }]);
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.headers.get('x-llm-provider')).toBe('gemini');
    expect(createdProvider).toBe('gemini');
  });

  it('defaults to gemini when the row has no provider', async () => {
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { id: 'u1' })
    );

    let createdProvider: string | undefined;
    mockCreateLLMClient.mockImplementation((deps: any) => {
      createdProvider = deps.provider;
      return makeStreamClient([{ type: 'text', text: 'hi' }, { type: 'done' }]);
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createdProvider).toBe('gemini');
    expect(res.headers.get('x-llm-provider')).toBe('gemini');
  });

  it('always sets x-llm-provider response header (success path)', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    mockCreateLLMClient.mockReturnValue(
      makeStreamClient([{ type: 'text', text: 'ok' }, { type: 'done' }])
    );

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.headers.get('x-llm-provider')).toBe('gemini');
  });

  it('falls back to Anthropic when Gemini requested but no user tokens are stored', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { id: 'u1' })
    );

    // First createLLMClient call (gemini) throws the token-store's
    // TokenError. Second call (anthropic fallback) succeeds.
    const providersUsed: string[] = [];
    mockCreateLLMClient.mockImplementation((deps: any) => {
      providersUsed.push(deps.provider);
      if (deps.provider === 'gemini') {
        throw new Error('[no_gemini_token] user has not signed in with Google');
      }
      return makeStreamClient([{ type: 'text', text: 'fallback ok' }, { type: 'done' }]);
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(providersUsed).toEqual(['gemini', 'anthropic']);
    expect(res.headers.get('x-llm-provider')).toBe('anthropic');
    expect(mockReportTokenRefreshFailed).toHaveBeenCalled();
  });

  it('emits a reauth_required SSE event when Gemini token refresh fails', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    (getServerSupabase as any).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { id: 'u1', llm_provider: 'gemini' })
    );

    // Mirrors @goalcoach/llm's TokenError: the code is always prefixed in
    // square brackets. refresh_failed means Google rejected our refresh
    // grant (expired or revoked), so the user must reconnect Google. This
    // must NOT silently downgrade to Anthropic like the missing-token
    // cases do.
    const providersUsed: string[] = [];
    mockCreateLLMClient.mockImplementation((deps: any) => {
      providersUsed.push(deps.provider);
      if (deps.provider === 'gemini') {
        const err = new Error('[refresh_failed] Google refresh endpoint returned 400');
        err.name = 'TokenError';
        (err as any).code = 'refresh_failed';
        throw err;
      }
      return makeStreamClient([{ type: 'text', text: 'should not reach anthropic' }, { type: 'done' }]);
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);

    const text = await readAll(res);
    expect(text).toContain('reauth_required');
    expect(text).toContain('token_refresh_failed');
    expect(mockReportTokenRefreshFailed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' })
    );
    // No silent fallback: the user's Google grant is gone, so Anthropic
    // must not be picked to paper over it.
    expect(providersUsed).toEqual(['gemini']);
    expect(res.headers.get('x-llm-provider')).toBe('gemini');
  });

  it('emits llm_provider_selected Sentry event once per request', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    mockCreateLLMClient.mockReturnValue(
      makeStreamClient([{ type: 'text', text: 'ok' }, { type: 'done' }])
    );

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    await POST(req);
    expect(mockReportProviderSelected).toHaveBeenCalledWith('gemini');
  });

  it('returns 401 when not authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase(null));
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when messages array is missing', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 413 when last user message exceeds 5000 chars', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    const huge = 'a'.repeat(5001);
    const res = await POST(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: huge }] })
    }));
    expect(res.status).toBe(413);
  });

  // Regression: the LLM SDK's async iterable cleanup (return() called
  // after the for-await loop exits) can throw "AbortError" or similar.
  // If we already streamed partial text to the user, emitting a trailing
  // "Internal error" SSE event contradicts what they saw and surfaces a
  // spurious red alert under every successful chat reply. (qa /qa
  // 2026-09-23 — see also parallel fix in packages/llm.)
  it('does not emit "Internal error" after text when the LLM stream cleanup throws', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    mockCreateLLMClient.mockReturnValue({
      send: (_m: any, _t: any) => {
        // Mimic Anthropic SDK: yield text, then on the NEXT next() call
        // throw — that's what happens when the route's for-await breaks
        // out via the implicit return() during cleanup.
        return (async function* () {
          yield { type: 'text', text: 'partial ' };
          yield { type: 'text', text: 'reply' };
          // The throw below is what causes the for-await to propagate to
          // the route's catch block. Pre-fix this produced a trailing
          // `data: {"type":"error","message":"Internal error"}` event.
          throw new Error('abort');
        })();
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    const body = await readAll(res);

    // Sanity: text was streamed.
    expect(body).toContain('partial ');
    expect(body).toContain('reply');
    // The fix: no trailing Internal error after we've streamed text.
    expect(body).not.toContain('Internal error');
  });

  it('passes the user\'s selected areas to systemPrompt (Review Focus 2)', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    const { getUserAreaPreferences } = await import('@goalcoach/db');
    (getUserAreaPreferences as any).mockResolvedValue([
      { user_id: 'u1', area_key: 'career', selected_at: '2026-09-23T09:00:00Z' },
      { user_id: 'u1', area_key: 'health', selected_at: '2026-09-23T10:00:00Z' },
    ]);

    let capturedMessages: any[] = [];
    mockCreateLLMClient.mockImplementation(() => ({
      send: (_m: any, _t: any) => {
        capturedMessages = _m;
        return (async function* () {
          yield { type: 'text', text: 'ok' };
          yield { type: 'done' };
        })();
      },
    }));

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // The last "user" message in capturedMessages is the system-prompt turn.
    const systemPromptMessage = capturedMessages.at(-1);
    expect(systemPromptMessage.role).toBe('user');
    expect(systemPromptMessage.content).toContain('Areas the user cares about: career, health');
  });

  it('does not include areas block when user has no area preferences', async () => {
    (getServerSupabase as any).mockResolvedValue(makeSupabase());
    const { getUserAreaPreferences } = await import('@goalcoach/db');
    (getUserAreaPreferences as any).mockResolvedValue([]);

    let capturedMessages: any[] = [];
    mockCreateLLMClient.mockImplementation(() => ({
      send: (_m: any, _t: any) => {
        capturedMessages = _m;
        return (async function* () {
          yield { type: 'text', text: 'ok' };
          yield { type: 'done' };
        })();
      },
    }));

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const systemPromptMessage = capturedMessages.at(-1);
    expect(systemPromptMessage.role).toBe('user');
    expect(systemPromptMessage.content).not.toContain('Areas the user cares about');
  });
});

describe('resolveProvider', () => {
  it('defaults to gemini when no row override is set', async () => {
    const supabase = makeSupabase({ id: 'user-1' }, { id: 'user-1', llm_provider: null });
    const result = await resolveProvider(supabase, 'user-1');
    expect(result).toBe('gemini');
  });
});
