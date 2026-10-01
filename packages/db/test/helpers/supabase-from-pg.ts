/**
 * Adapters that translate the supabase-js fluent query API
 * (`supabase.from('x').insert(y).select().single()` and
 * `supabase.from('x').select().eq(...).order(...).limit(...)`)
 * into direct pg queries against the live connection.
 *
 * Used by rls-integration.test.ts to exercise the project's
 * appendThread / getRecentThreads against the real Supabase
 * Postgres so the table-level GRANTs + RLS policies are evaluated
 * end-to-end.
 *
 * The test session sets `request.jwt.claims` to fake an
 * authenticated request — that's what auth.uid() reads.
 */

import type { Client } from 'pg';

type AnyObj = Record<string, any>;

class QueryBuilder {
  private filters: Array<{ col: string; val: any }> = [];
  private orderBy?: { col: string; dir: 'asc' | 'desc' };
  private limitN?: number;
  private wantSingle = false;
  private wantSelect = false;

  constructor(
    private client: Client,
    private table: string,
    private op: 'select' | 'insert' | 'update',
    private payload?: AnyObj
  ) {}

  select(_cols = '*') {
    this.wantSelect = true;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push({ col, val });
    return this;
  }
  order(col: string, opts: { ascending: boolean }) {
    this.orderBy = { col, dir: opts.ascending ? 'asc' : 'desc' };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }

  async then(resolve: (v: any) => any, reject: (e: any) => any) {
    try {
      resolve(await this.run());
    } catch (e) {
      reject(e);
    }
  }

  private async run(): Promise<{ data: any; error: any }> {
    if (this.op === 'insert') {
      const cols = Object.keys(this.payload!);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const values = cols.map((c) => this.payload![c]);
      const sql = `insert into public.${this.table} (${cols.join(', ')}) values (${placeholders}) returning *`;
      const r = await this.client.query(sql, values);
      return { data: r.rows[0] ?? null, error: null };
    }
    if (this.op === 'select') {
      const where = this.filters.length
        ? 'where ' + this.filters.map((f, i) => `${f.col} = $${i + 1}`).join(' and ')
        : '';
      const values = this.filters.map((f) => f.val);
      const order = this.orderBy ? `order by ${this.orderBy.col} ${this.orderBy.dir}` : '';
      const limit = this.limitN ? `limit ${this.limitN}` : '';
      const sql = `select * from public.${this.table} ${where} ${order} ${limit}`.trim().replace(/\s+/g, ' ');
      const r = await this.client.query(sql, values);
      return { data: r.rows, error: null };
    }
    return { data: null, error: new Error(`op ${this.op} not implemented in helper`) };
  }
}

function makeSupabase(client: Client) {
  return {
    from(table: string) {
      return {
        insert(payload: AnyObj) {
          return new QueryBuilder(client, table, 'insert', payload);
        },
        select(_cols?: string) {
          return new QueryBuilder(client, table, 'select');
        },
        update(_payload: AnyObj) {
          return new QueryBuilder(client, table, 'update');
        },
      };
    },
  };
}

export async function appendThreadViaPg(
  client: Client,
  appendThread: (s: any, uid: string, role: 'user' | 'assistant' | 'system', content: string) => Promise<any>,
  userId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
) {
  const s = makeSupabase(client);
  return appendThread(s as any, userId, role, content);
}

export async function getRecentThreadsViaPg(
  client: Client,
  getRecentThreads: (s: any, uid: string, limit?: number) => Promise<any[]>,
  userId: string,
  limit?: number
) {
  const s = makeSupabase(client);
  return getRecentThreads(s as any, userId, limit);
}
