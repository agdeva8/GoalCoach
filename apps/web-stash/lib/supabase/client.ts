import { createBrowserClient } from '@supabase/ssr';

// Use the new publishable key. NEXT_PUBLIC_SUPABASE_ANON_KEY is the
// pre-2024 alias; Supabase renamed it to publishable but kept the
// legacy var working for back-compat. We standardize on the new name.
export function getBrowserSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    );
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
