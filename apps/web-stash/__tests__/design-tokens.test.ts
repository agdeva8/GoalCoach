import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('design tokens', () => {
  const css = readFileSync(
    resolve(__dirname, '../app/globals.css'),
    'utf8'
  );

  it('declares the four brand color tokens', () => {
    expect(css).toMatch(/--ink:\s*#1A1A1A/i);
    expect(css).toMatch(/--paper:\s*#FAF8F4/i);
    expect(css).toMatch(/--moss:\s*#4A5D3A/i);
    expect(css).toMatch(/--slate:\s*#6B6B68/i);
  });

  it('declares typography tokens for Fraunces, Inter, JetBrains Mono', () => {
    // Tokens reference next/font's CSS variables with paper-stack
    // fallbacks (so a font load failure still renders something).
    expect(css).toMatch(/--font-serif:\s*var\(--font-fraunces\).*Fraunces/);
    expect(css).toMatch(/--font-sans:\s*var\(--font-inter\).*Inter/);
    expect(css).toMatch(/--font-mono:.*JetBrains Mono/);
  });

  it('declares next/font CSS variables for the loaded webfonts', () => {
    // layout.tsx applies Fraunces.variable and Inter.variable to <html>,
    // which set --font-fraunces and --font-inter on the root. globals.css
    // references them by those names; the existence of those references
    // is what wires the two files together.
    expect(css).toMatch(/var\(--font-fraunces\)/);
    expect(css).toMatch(/var\(--font-inter\)/);
  });

  it('declares zero card radius and four pixel button radius', () => {
    expect(css).toMatch(/--radius-card:\s*0px/);
    expect(css).toMatch(/--radius-button:\s*4px/);
  });

  it('exposes a Tailwind theme mapping that reuses brand tokens', () => {
    // Tailwind v4 @theme block exposes brand tokens as utility classes
    expect(css).toMatch(/@theme\s+inline\s*\{/);
    expect(css).toMatch(/--color-ink:\s*var\(--ink\)/);
    expect(css).toMatch(/--color-paper:\s*var\(--paper\)/);
    expect(css).toMatch(/--color-moss:\s*var\(--moss\)/);
    expect(css).toMatch(/--color-slate:\s*var\(--slate\)/);
  });
});
