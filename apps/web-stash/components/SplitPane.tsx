'use client';
import type { ReactNode } from 'react';

export function SplitPane({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div
      data-component="split-pane"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem',
        minHeight: '100vh',
        padding: '1rem',
      }}
    >
      <section
        aria-label="chat pane"
        data-pane="primary"
        style={{ minWidth: 0 }}
      >
        {left}
      </section>
      <section
        aria-label="cards pane"
        data-pane="secondary"
        style={{ minWidth: 0 }}
      >
        {right}
      </section>
      <style>{`
        @media (max-width: 1023px) {
          [data-component="split-pane"] {
            grid-template-columns: 1fr !important;
          }
          [data-pane="primary"] { order: 1; }
          [data-pane="secondary"] { order: 2; }
        }
      `}</style>
    </div>
  );
}
