'use client';
import type { Goal } from '@goalcoach/db';

const EXPLANATION =
  'Plan card: goals and reflections you have logged with the coach. Ask the coach to update them.';

export function PlanCard({ goal }: { goal: Goal }) {
  return (
    <article
      data-card-type="goal"
      data-horizon={goal.horizon}
      data-status={goal.status}
      style={{
        borderRadius: '0',
        border: '1px solid var(--slate, #6B6B68)',
        padding: '1rem',
        background: 'var(--paper, #FAF8F4)',
        color: 'var(--ink, #1A1A1A)',
        fontFamily: 'Inter, system-ui',
      }}
    >
      <header>
        <h3
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            margin: 0,
            fontSize: '1.125rem',
          }}
        >
          {goal.title}
        </h3>
      </header>
      <footer style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.875rem' }}>
        <span data-badge="horizon">{goal.horizon}</span>
        <span data-pill="status">{goal.status}</span>
        <span
          aria-label="plan card explanation"
          title={EXPLANATION}
          data-tooltip="card-explanation"
          style={{
            marginLeft: 'auto',
            cursor: 'help',
            borderBottom: '1px dotted var(--slate, #6B6B68)',
          }}
        >
          ?
        </span>
        <span hidden>{EXPLANATION}</span>
      </footer>
    </article>
  );
}
