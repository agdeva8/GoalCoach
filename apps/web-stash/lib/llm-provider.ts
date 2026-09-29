// Provider precedence is row > default.
//   users.llm_provider  - explicit per-user override (set by /api/admin/llm-provider,
//                         or backfilled / schema-defaulted to 'gemini')
//   'gemini'            - fallback (L1 spec: Gemini-only for production)
//
// There is no env knob: LLM_PROVIDER is retained on Env for backwards
// compatibility but no longer participates in resolution. Migration 0008
// is what makes 'gemini' reachable for real users, since the row check
// outranks this fallback.
export async function resolveProvider(
  supabase: any,
  userId: string
): Promise<'anthropic' | 'gemini'> {
  const { data } = await supabase
    .from('users')
    .select('llm_provider')
    .eq('id', userId)
    .single();
  const rowProvider = (data as { llm_provider?: string } | null)?.llm_provider;
  if (rowProvider === 'anthropic' || rowProvider === 'gemini') return rowProvider;
  return 'gemini';
}
