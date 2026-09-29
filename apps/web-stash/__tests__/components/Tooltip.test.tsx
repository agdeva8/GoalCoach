import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '@/components/Tooltip';

afterEach(() => cleanup());

describe('Tooltip', () => {
  it('does not show tooltip by default', () => {
    render(
      <Tooltip text="Explanatory text">
        <button>trigger</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip on mouse enter', () => {
    render(
      <Tooltip text="Explanatory text">
        <button>trigger</button>
      </Tooltip>
    );
    const trigger = screen.getByText('trigger');
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explanatory text');
  });

  it('hides tooltip on mouse leave', () => {
    render(
      <Tooltip text="Explanatory text">
        <button>trigger</button>
      </Tooltip>
    );
    const wrap = screen.getByText('trigger').parentElement!;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(wrap);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('wires aria-describedby to the trigger', () => {
    render(
      <Tooltip text="hint">
        <button>trigger</button>
      </Tooltip>
    );
    const wrap = screen.getByText('trigger').parentElement!;
    fireEvent.mouseEnter(wrap);
    const tip = screen.getByRole('tooltip');
    expect(wrap).toHaveAttribute('aria-describedby', tip.id);
  });
});
