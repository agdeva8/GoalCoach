'use client';
import { useState } from 'react';
import { getAreas, type AreaKey } from '@goalcoach/db';

export function AreaCarousel({ onConfirm }: { onConfirm: (keys: AreaKey[]) => void }) {
  const [selected, setSelected] = useState<Set<AreaKey>>(new Set());
  const areas = getAreas();

  function toggle(key: AreaKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section
      aria-label="Pick the areas you care about"
      data-component="area-carousel"
      className="area-carousel"
    >
      <h1 className="area-carousel__title">Pick the areas you care about.</h1>
      <p className="area-carousel__subtitle" suppressHydrationWarning>
        The coach uses this to focus each reply. You can change it later.
      </p>
      <div role="group" aria-label="life areas" className="area-carousel__group">
        {areas.map((a) => {
          const isSelected = selected.has(a.key);
          return (
            <button
              key={a.key}
              type="button"
              data-area={a.key}
              data-selected={isSelected ? 'true' : 'false'}
              aria-pressed={isSelected}
              aria-label={`Add area ${a.label} to your message`}
              onClick={() => toggle(a.key)}
              className={`area-carousel__chip${isSelected ? ' area-carousel__chip--selected' : ''}`}
            >
              #{a.key}
            </button>
          );
        })}
      </div>
      <div className="area-carousel__actions">
        <button
          type="button"
          data-testid="area-carousel-continue"
          onClick={() => onConfirm([...selected])}
        >
          Continue
        </button>
        <button
          type="button"
          data-testid="area-carousel-skip"
          className="area-carousel__skip"
          onClick={() => onConfirm([])}
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}
