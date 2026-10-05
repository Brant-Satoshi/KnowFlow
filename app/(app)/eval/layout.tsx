import type { CSSProperties, ReactNode } from 'react';

const fontOverride: CSSProperties = {
  ['--font-sans' as string]: 'var(--font-inter-tight), "SF Pro Text", system-ui, sans-serif',
  ['--font-mono' as string]: 'var(--font-jetbrains-mono), "Courier New", monospace',
  // Re-root the subtree so elements without an explicit font-* class also pick up
  // the eval font stack instead of inheriting the root app font.
  fontFamily: 'var(--font-sans)',
};

export default function EvalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen text-foreground" style={fontOverride}>
      {children}
    </div>
  );
}
