import type { ReactNode } from 'react';
import { Fraunces, Inter } from 'next/font/google';
import { Navbar } from '@/components/Navbar';
import './globals.css';

// Load brand fonts as CSS variables so globals.css can reference them
// without us hardcoding font names in two places. Subsets are kept
// minimal ('latin') to keep the download small; non-latin glyphs fall
// back through the family stack in --font-serif/--font-sans.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'GoalCoach',
  description: 'Think through your goals, out loud.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning on <html> is the React-recommended escape
    // hatch for browser extensions (Dark Reader, Vimium, etc.) that
    // mutate root attributes before hydration. The actual lang/structure
    // are still correct; this just tells React not to warn about the
    // injected attribute mismatch. See https://react.dev/link/hydration-mismatch
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${inter.variable}`}
    >
      <body>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
