import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'app/api/**/__tests__/**/*.test.ts',
      'lib/**/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 70,
        branches: 59,
      },
      include: ['app/api/**/*.ts', 'lib/**/*.ts'],
    },
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` is a Next.js build-time guard that throws when
      // a server module is imported from a client component. In the
      // Vitest environment there is no client/server split, so we
      // alias it to a no-op. This lets route handlers under test
      // import `lib/auth`, `lib/db`, etc. which all `import 'server-only'`.
      'server-only': path.resolve(__dirname, 'vitest.empty.ts'),
    },
  },
})
