'use client';
import { useState, useId, type ReactNode } from 'react';

export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const tipId = `tooltip-${reactId.replace(/:/g, '')}`;

  return (
    <span
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ position: 'relative', display: 'inline-block' }}
      aria-describedby={open ? tipId : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={tipId}
          data-component="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 0.25rem)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--ink, #1A1A1A)',
            color: 'var(--paper, #FAF8F4)',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontFamily: 'Inter, system-ui',
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
