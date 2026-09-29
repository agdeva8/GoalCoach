// Provider-agnostic stream event. Both Anthropic and Gemini clients yield
// this exact shape so the chat route can relay them as SSE without knowing
// which provider produced them.
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type Provider = 'anthropic' | 'gemini';

// Tool shape as the chat route hands it in. Anthropic uses input_schema
// (JSON Schema); Gemini in Phase 1 receives tools as prompt instructions
// and does NOT emit tool_use events (see client-gemini.ts).
export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ClientMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface LLMClient {
  send(messages: ClientMessage[], tools: ToolSpec[]): AsyncIterable<StreamEvent>;
}

// Supabase client is opaque here. We only need from()/update() on the
// Gemini path and nothing on the Anthropic path. Importing the Supabase
// generic chain across the package boundary drags the @supabase/ssr and
// @supabase/supabase-js dual-type mess; keep this loose and cast at
// the call site.
export type AnySupabase = any;

export interface ClientDeps {
  provider: Provider;
  userId: string;
  supabase: AnySupabase;
  // Only required when provider === 'anthropic'. May be undefined for
  // provider === 'gemini'.
  anthropicApiKey?: string;
}
