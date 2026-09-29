import { createLLMClient, type ClientMessage, type StreamEvent, type ToolSpec } from '@goalcoach/llm';
import { getServerSupabase } from '@/lib/supabase/server';
import { createHandlers } from '@/lib/ai/handlers';
import { TOOLS, systemPrompt, runToolWithRetry } from '@goalcoach/ai';
import { getGoalsForUser, getRecentThreads, appendThread, getUserAreaPreferences } from '@goalcoach/db';
import { assertEnv } from '@/lib/env';
import { resolveProvider } from '@/lib/llm-provider';
import { reportProviderSelected, reportTokenRefreshFailed } from '@/lib/sentry';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// True for errors thrown by @goalcoach/llm's token-store. We only fall
// back when the user simply has no Gemini tokens - not on API errors,
// which the Gemini client surfaces as StreamEvent.error and we forward.
//
// `refresh_failed` is deliberately NOT in this set (see
// isRefreshFailedError): it means the user WAS connected and Google
// rejected the refresh grant, which needs a re-auth prompt rather than a
// silent downgrade to Anthropic.
function isMissingGeminiTokenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\[(no_gemini_token|no_refresh_token)\]/.test(err.message);
}

// True when Google refused to mint a new access token for a stored
// refresh grant (expired, revoked, or app clock skew). The only fix is
// for the user to sign in with Google again, so we surface it as
// `reauth_required` instead of falling back.
function isRefreshFailedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TokenError' && (err as { code?: unknown }).code === 'refresh_failed') {
    return true;
  }
  return /\[refresh_failed\]/.test(err.message);
}

export async function POST(req: Request) {
  const env = assertEnv();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await req.json().catch(() => null)) as { messages?: ClientMessage[] } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: 'messages must be a non-empty array' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const lastUser = messages.at(-1);
  if (lastUser?.role === 'user') {
    await appendThread(supabase, user.id, 'user', lastUser.content, user.email ?? null, user.user_metadata?.full_name ?? null);
  }

  // Size cap on the last user turn. Placed AFTER appendThread on purpose:
  // the thread log above already holds the turn, and the client cannot
  // resend it, so an oversized turn is logged and then rejected rather
  // than silently dropped. The typeof narrow matters because the array
  // check above only proves `messages` is non-empty, not that each entry
  // is a well-formed ClientMessage.
  const lastUserContent = lastUser?.content ?? '';
  if (typeof lastUserContent === 'string' && lastUserContent.length > 5000) {
    return new Response(JSON.stringify({ error: 'message_too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Precedence is row > 'gemini' default; see lib/llm-provider. The DB
  // column default (migration 0008) is what makes 'gemini' reachable for
  // existing users, since the row check outranks the fallback.
  let resolvedProvider = await resolveProvider(supabase, user.id);

  // Build the client. If the user requested Gemini but has no stored
  // tokens, fall back to Anthropic rather than 500ing. Real Gemini API
  // errors come back through StreamEvent.error and are forwarded to the
  // client as-is.
  let client: { send: (m: ClientMessage[], t: ToolSpec[]) => AsyncIterable<StreamEvent> };
  try {
    client = createLLMClient({
      provider: resolvedProvider,
      userId: user.id,
      supabase,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    });
  } catch (err) {
    if (resolvedProvider === 'gemini' && isRefreshFailedError(err)) {
      // Gemini was selected and the user has tokens on file, but Google
      // refused to refresh them. Anthropic cannot stand in here: the
      // stored grant is dead, so the user has to reconnect Google.
      // Report it the same way as the other refresh failures, then hand
      // the client a structured event it can render as a re-auth CTA.
      const code =
        err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'unknown';
      reportTokenRefreshFailed({
        userId: user.id,
        httpStatus: null,
        code,
      });
      return new Response(
        `data: ${JSON.stringify({ type: 'reauth_required', reason: 'token_refresh_failed' })}\n\n`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'x-llm-provider': resolvedProvider,
          },
        }
      );
    }
    if (resolvedProvider === 'gemini' && isMissingGeminiTokenError(err)) {
      const code =
        err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'unknown';
      reportTokenRefreshFailed({
        userId: user.id,
        httpStatus: null,
        code,
      });
      resolvedProvider = 'anthropic';
      client = createLLMClient({
        provider: 'anthropic',
        userId: user.id,
        supabase,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
      });
    } else {
      throw err;
    }
  }

  reportProviderSelected(resolvedProvider);

  const goals = await getGoalsForUser(supabase, user.id);
  const threads = await getRecentThreads(supabase, user.id);
  const areaPrefs = await getUserAreaPreferences(supabase, user.id);
  const areas = areaPrefs.map((p) => p.area_key);
  const handlers = createHandlers(supabase, user.id);

  const encoder = new TextEncoder();
  const toolSpecs: ToolSpec[] = (TOOLS as unknown as any[]).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const readable = new ReadableStream({
    async start(controller) {
      // Tracks text already streamed to the user. Declared outside the
      // try so the catch can read it -- if a tail throw happens after
      // text was sent, we close cleanly instead of emitting a
      // contradictory "Internal error" event. (qa /qa 2026-09-23)
      let assistantText = '';
      try {
        const toolUses: Array<{ id?: string; name: string; input: unknown }> = [];

        const events = client.send(
          [...messages, { role: 'user', content: systemPrompt(goals, threads, areas) } as ClientMessage],
          toolSpecs
        );

        for await (const event of events) {
          if (event.type === 'text') {
            assistantText += event.text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text', text: event.text })}\n\n`)
            );
          } else if (event.type === 'tool_use') {
            toolUses.push({ id: event.id, name: event.name, input: event.input });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_use', name: event.name, input: event.input })}\n\n`
              )
            );
          }
          // 'done' is implicit at stream end; 'error' events are
          // surfaced by client.send but the route treats them as a
          // normal stream completion. The SSE envelope is the same.
        }

        if (toolUses.length > 0) {
          const toolResults = await Promise.all(
            toolUses.map(async (tu) => {
              try {
                // L3 D13: one retry on malformed tool args (2 attempts per
                // tool call per turn); any other error is re-thrown and
                // mapped to the generic failure result below.
                const result = await runToolWithRetry(
                  (handlers as any)[tu.name],
                  tu.input,
                  undefined,
                  { retries: 1 }
                );
                return {
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: JSON.stringify(result ?? null),
                };
              } catch (_err) {
                return {
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: JSON.stringify({ error: 'tool failed' }),
                  is_error: true,
                };
              }
            })
          );

          // Re-prompt with tool history. We serialize the structured
          // tool_use/tool_result history into the user turn content
          // because the Phase 1 LLMClient interface only accepts
          // ClientMessage (string content). Phase 1.5 will add a typed
          // tool history channel to the client.
          let finalAssistantText = '';
          const secondEvents = client.send(
            [
              ...messages,
              {
                role: 'assistant',
                content: JSON.stringify(
                  toolUses.map((tu) => ({
                    type: 'tool_use',
                    id: tu.id,
                    name: tu.name,
                    input: tu.input,
                  }))
                ),
              },
              {
                role: 'user',
                content: JSON.stringify(toolResults),
              },
            ],
            toolSpecs
          );

          for await (const event of secondEvents) {
            if (event.type === 'text') {
              finalAssistantText += event.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text', text: event.text })}\n\n`)
              );
            }
          }

          const persistText = finalAssistantText || assistantText;
          if (persistText) {
            await appendThread(supabase, user.id, 'assistant', persistText);
          }
        } else if (assistantText) {
          await appendThread(supabase, user.id, 'assistant', assistantText);
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (_err) {
        // If we already streamed partial text to the user, a throw at the
        // tail of the for-await loop (controller.close on a closed stream,
        // appendThread race, etc.) is a benign cleanup error. Emitting
        // `error` here contradicts what the user just saw and surfaces a
        // spurious red "Internal error" alert. (Regression caught by /qa
        // 2026-09-23 -- see also parallel fix in packages/llm.)
        if (assistantText) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch {}
          try {
            controller.close();
          } catch {}
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: 'Internal error' })}\n\n`
            )
          );
        } catch {}
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-llm-provider': resolvedProvider,
    },
  });
}
