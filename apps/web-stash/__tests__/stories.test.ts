import { describe, it, expect } from 'vitest';

type Story = {
  title: string;
  render: () => unknown;
};

describe('story files', () => {
  it('PlanCard story renders', async () => {
    const { default: story } = (await import('@/components/PlanCard.stories')) as { default: Story };
    expect(typeof story.title).toBe('string');
    expect(story.title).toMatch(/PlanCard/);
    expect(story.render()).toBeTruthy();
  });

  it('SplitPane story renders', async () => {
    const { default: story } = (await import('@/components/SplitPane.stories')) as { default: Story };
    expect(story.title).toMatch(/SplitPane/);
    expect(story.render()).toBeTruthy();
  });

  it('CardErrorBanner story renders', async () => {
    const { default: story } = (await import('@/components/CardErrorBanner.stories')) as { default: Story };
    expect(story.title).toMatch(/CardErrorBanner/);
    expect(story.render()).toBeTruthy();
  });

  it('ThinkingIndicator story renders', async () => {
    const { default: story } = (await import('@/components/ThinkingIndicator.stories')) as { default: Story };
    expect(story.title).toMatch(/ThinkingIndicator/);
    expect(story.render()).toBeTruthy();
  });

  it('ChatThread story renders', async () => {
    const { default: story } = (await import('@/components/ChatThread.stories')) as { default: Story };
    expect(story.title).toMatch(/ChatThread/);
    expect(story.render()).toBeTruthy();
  });
});
