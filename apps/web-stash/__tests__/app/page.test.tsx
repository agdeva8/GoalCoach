import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT;${url}`);
    (err as any).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => ({
    type: 'a', props: { href, ...rest, children },
    key: null, ref: null, $$typeof: Symbol.for('react.element'),
  }),
}));

vi.mock('@/components/AreaCarousel', () => ({
  AreaCarousel: ({ onConfirm }: any) => ({
    type: 'div',
    props: { 'data-testid': 'area-carousel', 'data-has-onconfirm': typeof onConfirm },
    key: null, ref: null, $$typeof: Symbol.for('react.element'),
  }),
}));

// AreaCarouselClient wraps AreaCarousel. Mirror that tree shape: an outer
// stub host element carrying the wrapper's data-testid plus its drilled props
// (so we can assert on what the parent passed/not), and an inner child that
// matches the AreaCarousel mock's output (so existing walker-based assertions
// that look for data-testid="area-carousel" still resolve after this mock was
// added).
vi.mock('@/components/AreaCarouselClient', () => ({
  AreaCarouselClient: (props: any) => ({
    type: 'div',
    props: {
      'data-testid': 'area-carousel-client-stub',
      ...props,
      children: {
        type: 'div',
        props: { 'data-testid': 'area-carousel', 'data-has-onconfirm': 'function' },
        key: null, ref: null, $$typeof: Symbol.for('react.element'),
      },
    },
    key: null, ref: null, $$typeof: Symbol.for('react.element'),
  }),
}));

import { default as HomePage } from '@/app/page';
import { getServerSupabase } from '@/lib/supabase/server';

function walkHostTags(el: any): any[] {
  const out: any[] = [];
  const seen = new WeakSet();
  function walk(node: any) {
    if (node == null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.type === 'function') return walk(node.type(node.props ?? {}));
    if (typeof node.type === 'string') {
      out.push(node);
      if (node.props?.children) walk(node.props.children);
    }
  }
  walk(el);
  return out;
}

describe('/ (home page)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /chat when the user is signed in and has at least one area', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ data: [{ area_key: 'career' }], error: null }) }) }),
      }),
    });

    let redirected: string | null = null;
    try { await HomePage(); } catch (e: any) { redirected = e?.message ?? ''; }
    expect(redirected).toMatch(/NEXT_REDIRECT;\/chat/);
  });

  it('renders AreaCarousel when the user is signed in but has no areas', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }),
      }),
    });

    const el = await HomePage();
    const tags = walkHostTags(el);
    expect(tags.find((t) => t.props['data-testid'] === 'area-carousel')).toBeTruthy();
  });

  it('renders a sign-in CTA when the user is anonymous', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => { throw new Error('should not query areas when anonymous'); },
    });

    const el = await HomePage();
    const tags = walkHostTags(el);
    const link = tags.find((t) => t.props['data-testid'] === 'sign-in-link');
    expect(link).toBeTruthy();
    expect(link!.props.href).toContain('/api/auth/google');
  });

  // Server-component constraint: a server component cannot pass an inline
  // function (closure) as a prop to a client component -- React forbids it
  // ("Event handlers cannot be passed to Client Component props"). The
  // hidden-input DOM write must happen inside AreaCarouselClient.handle
  // (the wrapper itself), not via an onChange prop drilled from the server
  // page. This test pins that contract.
  it('does not pass an onChange prop to AreaCarouselClient (server-component constraint)', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }),
      }),
    });

    const el = await HomePage();
    const tags = walkHostTags(el);
    const stub = tags.find((t) => t.props['data-testid'] === 'area-carousel-client-stub');
    expect(stub).toBeTruthy();
    expect(stub!.props.onChange).toBeUndefined();
  });
});
