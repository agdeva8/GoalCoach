import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SplitPane } from '@/components/SplitPane';

afterEach(() => cleanup());

describe('SplitPane', () => {
  it('renders both panes with labels', () => {
    render(
      <SplitPane left={<div>chat</div>} right={<div>cards</div>} />
    );
    expect(screen.getByLabelText(/chat pane/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cards pane/i)).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
    expect(screen.getByText('cards')).toBeInTheDocument();
  });

  it('uses CSS grid for side-by-side on desktop', () => {
    const { container } = render(
      <SplitPane left={<div>chat</div>} right={<div>cards</div>} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.display).toBe('grid');
    expect(wrapper.style.gridTemplateColumns).toMatch(/1fr 1fr/);
  });

  it('marks left pane as primary for mobile ordering', () => {
    render(
      <SplitPane left={<div>chat</div>} right={<div>cards</div>} />
    );
    const left = screen.getByLabelText(/chat pane/i);
    expect(left.getAttribute('data-pane')).toBe('primary');
  });
});
