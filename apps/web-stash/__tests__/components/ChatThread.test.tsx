import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ChatThread } from '@/components/ChatThread';

afterEach(() => cleanup());

// Minimal stand-in for a streaming fetch Response. The component only
// reads `ok`, `status` and `body.getReader()`, so a real Response (and a
// real ReadableStream) is not needed here.
function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: encoder.encode(chunks[i++]), done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('message input'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
}

describe('ChatThread re-auth prompt', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a re-auth CTA when the server reports reauth_required', async () => {
    (fetch as any).mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ type: 'reauth_required', reason: 'token_refresh_failed' })}\n\n`,
        'data: [DONE]\n\n',
      ])
    );

    render(<ChatThread persona="week" />);
    await sendMessage('hi');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent(/sign in again/i);

    const link = within(alert).getByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/api/auth/google?returnTo=/chat');
  });

  it('does not render the re-auth CTA on a normal stream', async () => {
    (fetch as any).mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ type: 'text', text: 'Hello there' })}\n\n`,
        'data: [DONE]\n\n',
      ])
    );

    render(<ChatThread persona="week" />);
    await sendMessage('hi');

    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
