import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Voice rules from design §10:
//   - No em dash (—)
//   - No AI-vocabulary: "delve", "crucial", "robust", "comprehensive", "nuanced", "multifaceted"
//   - No "as an ai"
//   - No ellipsis-cluster ("...") — use a single period instead
//   - No exclamation overload (no "!!")

const BANNED_WORDS = [
  'delve',
  'crucial',
  'robust',
  'comprehensive',
  'nuanced',
  'multifaceted',
  'as an ai',
  "i'm an ai",
];

const SOURCE_DIRS = ['components', 'app'];
const TSX = /\.(tsx?|jsx?)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir) as unknown as string[];
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    // skip test dirs and node_modules
    if (e === 'node_modules' || e === '__tests__' || e === '.next' || e === 'dist') continue;
    try {
      const stat = readFileSync;
      // crude: try to read as file; if fails it's a dir
      try {
        stat(full);
        if (TSX.test(e)) out.push(full);
      } catch {
        out.push(...walk(full));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

describe('empty-state copy voice', () => {
  const files = SOURCE_DIRS.flatMap((d) => walk(resolve(__dirname, '..', d)));

  it('finds at least one source file to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no em dashes', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/—/);
  });

  it.each(files)('%s contains no banned AI vocabulary', (file) => {
    const src = readFileSync(file, 'utf8').toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(src).not.toContain(word);
    }
  });

  it('ChatThread empty-state copy uses single period, not "..."', () => {
    const file = resolve(__dirname, '../components/ChatThread.tsx');
    const src = readFileSync(file, 'utf8');
    // Find the empty-state literal
    const match = src.match(/Pick a horizon[^\n]*/);
    expect(match).toBeTruthy();
    if (match) {
      expect(match[0]).not.toMatch(/\.\.\./);
    }
  });
});
