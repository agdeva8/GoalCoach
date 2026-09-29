'use client';
import { AreaCarousel } from './AreaCarousel';
import type { AreaKey } from '@goalcoach/db';

export function AreaCarouselClient() {
  function handle(keys: AreaKey[]) {
    const el = document.getElementById('areas-input') as HTMLInputElement | null;
    if (el) el.value = JSON.stringify(keys);
  }
  return <AreaCarousel onConfirm={handle} />;
}
