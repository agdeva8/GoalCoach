'use client';
import { useEffect, useState } from 'react';

const TICK_MS = 100;

export function ThinkingIndicator({
  startedAt,
  persona,
  onCancel,
}: {
  startedAt: number;
  persona: string;
  onCancel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(i);
  }, []);

  const elapsed = now - startedAt;

  if (elapsed < 2000) return null;

  if (elapsed < 4000) {
    return (
      <p aria-live="polite">
        {persona} is thinking…
      </p>
    );
  }

  return (
    <div aria-live="polite">
      <p>{persona} is still working. Cancel?</p>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Stop
        </button>
      )}
    </div>
  );
}
