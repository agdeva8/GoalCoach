import { describe, it, expect, vi } from 'vitest';
import { getUserAreaPreferences, setUserAreaPreferences } from '../src/queries';

function chainFor(rows: any[] = []) {
  // Mirrors the supabase query builder shape we use elsewhere in tests.
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe('getUserAreaPreferences', () => {
  it('returns rows ordered by selected_at ascending', async () => {
    const rows = [
      { user_id: 'u1', area_key: 'health', selected_at: '2026-09-23T10:00:00Z' },
      { user_id: 'u1', area_key: 'career', selected_at: '2026-09-23T09:00:00Z' },
    ];
    const supabase = { from: vi.fn().mockReturnValue(chainFor(rows)) } as any;
    const out = await getUserAreaPreferences(supabase, 'u1');
    expect(out).toEqual(rows);
  });

  it('returns [] when the user has no rows', async () => {
    const supabase = { from: vi.fn().mockReturnValue(chainFor([])) } as any;
    const out = await getUserAreaPreferences(supabase, 'u1');
    expect(out).toEqual([]);
  });
});

describe('setUserAreaPreferences', () => {
  it('upserts each given area_key for the user', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqDeleteMock = vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const supabase = {
      from: vi.fn().mockReturnValue({
        upsert: upsertSpy,
        delete: vi.fn().mockReturnValue({ eq: eqDeleteMock }),
      }),
    } as any;
    await setUserAreaPreferences(supabase, 'u1', ['career', 'health']);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', area_key: 'career' }),
      expect.any(Object)
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', area_key: 'health' }),
      expect.any(Object)
    );
  });

  it('deletes rows whose area_key is not in the new set', async () => {
    const inSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: inSpy }) }),
      }),
    } as any;
    await setUserAreaPreferences(supabase, 'u1', ['career']);
    expect(inSpy).toHaveBeenCalledWith('area_key', ['health', 'relationships', 'finance', 'learning', 'fun']);
  });

  it('handles empty input (skip path) by deleting every existing row', async () => {
    const inSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: inSpy }) }),
      }),
    } as any;
    await setUserAreaPreferences(supabase, 'u1', []);
    expect(inSpy).toHaveBeenCalledWith('area_key', ['career', 'health', 'relationships', 'finance', 'learning', 'fun']);
  });
});
