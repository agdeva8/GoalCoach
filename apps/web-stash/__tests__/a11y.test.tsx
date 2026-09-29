import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { PlanCard } from '@/components/PlanCard';
import { SplitPane } from '@/components/SplitPane';
import { CardErrorBanner } from '@/components/CardErrorBanner';
import { ThinkingIndicator } from '@/components/ThinkingIndicator';

afterEach(() => cleanup());

async function checkA11y(container: HTMLElement, label: string) {
  const results = await axe.run(container, {
    rules: {
      // Color contrast on jsdom renders is unreliable; skip in tests
      'color-contrast': { enabled: false },
    },
  });
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.description}`)
      .join('\n');
    throw new Error(`[${label}] a11y violations:\n${summary}`);
  }
}

const baseGoal = {
  id: 'g1',
  user_id: 'u1',
  title: 'Ship phase 1',
  horizon: 'week' as const,
  status: 'active' as const,
  created_at: '2026-09-22T00:00:00Z',
  updated_at: '2026-09-22T00:00:00Z',
};

describe('a11y: components have no axe violations', () => {
  it('PlanCard', async () => {
    const { container } = render(<PlanCard goal={baseGoal} />);
    await checkA11y(container, 'PlanCard');
  });

  it('SplitPane', async () => {
    const { container } = render(
      <SplitPane left={<div>chat</div>} right={<div>cards</div>} />
    );
    await checkA11y(container, 'SplitPane');
  });

  it('CardErrorBanner retryable', async () => {
    const { container } = render(
      <CardErrorBanner error={{ kind: 'retryable', message: 'oops' }} onRetry={() => {}} />
    );
    await checkA11y(container, 'CardErrorBanner');
  });

  it('CardErrorBanner fatal', async () => {
    const { container } = render(
      <CardErrorBanner error={{ kind: 'fatal', message: 'no auth' }} onRetry={() => {}} />
    );
    await checkA11y(container, 'CardErrorBanner-fatal');
  });

  it('ThinkingIndicator (cancelled scenario)', async () => {
    const { container } = render(
      <ThinkingIndicator startedAt={Date.now() - 5000} persona="Coach" onCancel={() => {}} />
    );
    await checkA11y(container, 'ThinkingIndicator');
  });
});
