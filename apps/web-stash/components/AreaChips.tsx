'use client';
import { getAreas } from '@goalcoach/db';

export function AreaChips({ onPick }: { onPick: (p: { prefix: string; key: string }) => void }) {
  const areas = getAreas();
  return (
    <div role="group" aria-label="life areas" data-component="area-chips">
      {areas.map((a) => (
        <button
          key={a.key}
          type="button"
          data-area={a.key}
          aria-label={`Add area ${a.label} to your message`}
          onClick={() =>
            onPick({ prefix: `I'm thinking about ${a.label.toLowerCase()}:`, key: a.key })
          }
        >
          #{a.key}
        </button>
      ))}
    </div>
  );
}
