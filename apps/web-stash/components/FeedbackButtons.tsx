'use client';
import { useState } from 'react';

export type Sentiment = 'up' | 'down';

export function FeedbackButtons({
  messageId,
  onFeedback,
}: {
  messageId: string;
  onFeedback: (sentiment: Sentiment) => void;
}) {
  const [picked, setPicked] = useState<Sentiment | null>(null);

  const handle = (sentiment: Sentiment) => {
    setPicked(sentiment);
    onFeedback(sentiment);
  };

  return (
    <div
      data-message-id={messageId}
      data-component="feedback-buttons"
      style={{ display: 'inline-flex', gap: '0.25rem' }}
    >
      <button
        type="button"
        aria-label="Helpful"
        aria-pressed={picked === 'up'}
        onClick={() => handle('up')}
        style={{
          border: '1px solid var(--slate, #6B6B68)',
          background: picked === 'up' ? 'var(--moss, #4A5D3A)' : 'var(--paper, #FAF8F4)',
          color: picked === 'up' ? 'var(--paper, #FAF8F4)' : 'var(--ink, #1A1A1A)',
          borderRadius: '4px',
          padding: '0.125rem 0.5rem',
          fontFamily: 'Inter, system-ui',
          fontSize: '0.75rem',
          cursor: 'pointer',
        }}
      >
        Up
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        aria-pressed={picked === 'down'}
        onClick={() => handle('down')}
        style={{
          border: '1px solid var(--slate, #6B6B68)',
          background: picked === 'down' ? 'var(--slate, #6B6B68)' : 'var(--paper, #FAF8F4)',
          color: picked === 'down' ? 'var(--paper, #FAF8F4)' : 'var(--ink, #1A1A1A)',
          borderRadius: '4px',
          padding: '0.125rem 0.5rem',
          fontFamily: 'Inter, system-ui',
          fontSize: '0.75rem',
          cursor: 'pointer',
        }}
      >
        Down
      </button>
    </div>
  );
}
