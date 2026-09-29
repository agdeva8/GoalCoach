import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // refuse to run without a configured secret
  const header = req.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = await getServerSupabase();
  const threshold = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  const { data, error } = await supabase
    .from('goals')
    .select('id, title, updated_at')
    .eq('status', 'active')
    .lt('updated_at', threshold);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stale = (data ?? []).map((g: { id: string; title: string; updated_at: string }) => ({
    id: g.id,
    title: g.title,
    updated_at: g.updated_at,
  }));

  return NextResponse.json({ count: stale.length, stale });
}
