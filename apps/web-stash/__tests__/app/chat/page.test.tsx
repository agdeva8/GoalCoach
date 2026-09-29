import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => ({
    type: 'a',
    props: { href, ...rest, children },
    key: null,
    ref: null,
    $$typeof: Symbol.for('react.element'),
  }),
}));

vi.mock('@/components/ChatThread', () => ({
  ChatThread: ({ persona }: { persona: string }) => ({
    type: 'div',
    props: { 'data-testid': 'chat-thread', 'data-persona': persona },
    key: null,
    ref: null,
    $$typeof: Symbol.for('react.element'),
  }),
}));

import { default as ChatPage } from '@/app/chat/page';
import { getServerSupabase } from '@/lib/supabase/server';

function renderElement(el: any): Array<{ tag: string; props: Record<string, any>; text: string }> {
  // Flatten a JSX tree for assertions. Host elements (string type)
  // are collected. Custom components (function type) are invoked with
  // their props to obtain the rendered element, then walked recursively.
  // This lets us assert on ChatThread's data-testid by walking through
  // its mock-returned `<div>` without needing a real renderer.
  const out: Array<{ tag: string; props: Record<string, any>; text: string }> = [];
  const seen = new WeakSet();

  function walk(node: any): string {
    if (node == null || typeof node !== 'object') return '';
    if (seen.has(node)) return '';
    seen.add(node);

    if (Array.isArray(node)) {
      return node.map((n) => walk(n)).join('');
    }

    // Function-type: invoke with props to get the rendered element.
    if (typeof node.type === 'function') {
      const rendered = node.type(node.props ?? {});
      return walk(rendered);
    }

    // String-type host element: collect and recurse into children.
    if (typeof node.type === 'string') {
      const childText = node.props?.children
        ? walk(node.props.children)
        : '';
      out.push({
        tag: node.type,
        props: node.props ?? {},
        text: typeof childText === 'string' ? childText : '',
      });
      return childText;
    }

    return '';
  }

  walk(el);
  return out;
}

describe('/chat page (server component)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ChatThread with default persona "week" when no horizon param is given', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const el = await ChatPage({ searchParams: Promise.resolve({}) } as any);
    const nodes = renderElement(el);
    const thread = nodes.find((n) => n.props['data-testid'] === 'chat-thread');
    expect(thread).toBeTruthy();
    expect(thread!.props['data-persona']).toBe('week');
  });

  it('renders ChatThread with the requested horizon when ?horizon=week', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const el = await ChatPage({ searchParams: Promise.resolve({ horizon: 'week' }) } as any);
    const nodes = renderElement(el);
    const thread = nodes.find((n) => n.props['data-testid'] === 'chat-thread');
    expect(thread!.props['data-persona']).toBe('week');
  });

  it('renders sign-in CTA when no user', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const el = await ChatPage({ searchParams: Promise.resolve({}) } as any);
    const nodes = renderElement(el);
    const link = nodes.find((n) => n.props['data-testid'] === 'sign-in-link');
    expect(link).toBeTruthy();
    expect(link!.props.href).toContain('returnTo=');
    expect(link!.props.href).toContain(encodeURIComponent('/chat'));
  });
});
