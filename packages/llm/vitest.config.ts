import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest runs in plain Node, not the Next.js bundler that would otherwise
// make `server-only` a no-op in server contexts. Alias to an empty module
// so the package's `import 'server-only'` side-effect import doesn't throw
// in tests. Production behavior is unchanged: Next.js bundler still rejects
// any client-component import of this package.
export default defineConfig({
  resolve: {
    alias: {
      'server-only': resolve(__dirname, 'test-shims/server-only.ts'),
    },
  },
});
