import type { ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { Inter_Tight, JetBrains_Mono } from 'next/font/google';

// Fonts scoped to /eval only — override the app's --font-sans / --font-mono tokens
// for this subtree so the eval dashboard matches its design without touching the
// rest of the app (which keeps DM Sans / DM Mono).
const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter-tight',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const fontOverride: CSSProperties = {
  ['--font-sans' as string]: 'var(--font-inter-tight), "SF Pro Text", system-ui, sans-serif',
  ['--font-mono' as string]: 'var(--font-jetbrains-mono), "Courier New", monospace',
  // Re-root the subtree so elements without an explicit font-* class also pick up
  // Inter Tight (body's computed font-family would otherwise stay DM Sans).
  fontFamily: 'var(--font-sans)',
};

export default function EvalLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${interTight.variable} ${jetbrainsMono.variable} min-h-screen`} style={fontOverride}>
      {children}
    </div>
  );
}
