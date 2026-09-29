import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = await getServerSupabase();
  const threshold = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const { data, error } = await supabase
    .from('reflections')
    .select('id, body, created_at')
    .lt('created_at', threshold);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reflections = (data ?? []).map((r: { id: string; body: string; created_at: string }) => ({
    id: r.id,
    body: r.body,
    created_at: r.created_at,
  }));

  return NextResponse.json({ count: reflections.length, reflections });
}
