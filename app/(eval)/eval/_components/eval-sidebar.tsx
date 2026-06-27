'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { SettingsMenu } from '@/components/settings-menu';
import type { EvalTranslationKeys } from '@/lib/i18n/translations';

export type EvalTab = 'overview' | 'compare' | 'inspector' | 'dataset';

function CheckSquare({ active, dim }: { active?: boolean; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block w-[15px] h-[15px] rounded-[4px] shrink-0"
      style={{
        border: '1.6px solid currentColor',
        opacity: dim ? 0.6 : 0.85,
        background: active ? 'currentColor' : 'transparent',
      }}
    />
  );
}

function NavItem({
  tab,
  active,
  label,
  onSelect,
}: {
  tab: EvalTab;
  active: boolean;
  label: string;
  onSelect: (t: EvalTab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      className="cursor-pointer w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] font-sans text-left transition-colors focus:outline-none hover:bg-muted/60"
      style={{
        color: active ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
        background: active ? 'hsl(var(--muted))' : 'transparent',
        fontWeight: active ? 600 : 400,
      }}
    >
      <CheckSquare active={active} />
      {label}
    </button>
  );
}

function ManageItem({ label }: { label: string }) {
  return (
    <div
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] font-sans text-muted-foreground/70 cursor-default select-none"
      title={label}
    >
      <CheckSquare dim />
      {label}
    </div>
  );
}

export function EvalSidebar({
  activeTab,
  onSelect,
  appName,
  kbLabel,
  evalT,
}: {
  activeTab: EvalTab;
  onSelect: (t: EvalTab) => void;
  appName: string;
  kbLabel: string | null;
  evalT: EvalTranslationKeys;
}) {
  const items: { tab: EvalTab; label: string }[] = [
    { tab: 'overview', label: evalT.tabOverview },
    { tab: 'compare', label: evalT.tabCompare },
    { tab: 'inspector', label: evalT.tabInspector },
  ];

  return (
    <aside className="md:sticky md:top-0 md:h-screen flex flex-col border-b md:border-b-0 md:border-r border-sidebar-border bg-sidebar px-3 py-4 gap-1">
      <Link href="/" className="cursor-pointer flex items-center px-2 pb-4">
        <BrandLogo
          name={appName}
          textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
        />
      </Link>

      <div className="px-2 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
        {evalT.navSectionEvaluate}
      </div>
      {items.map(it => (
        <NavItem key={it.tab} tab={it.tab} active={activeTab === it.tab} label={it.label} onSelect={onSelect} />
      ))}

      <div className="px-2 pt-4 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
        {evalT.navSectionManage}
      </div>
      <NavItem tab="dataset" active={activeTab === 'dataset'} label={evalT.navDatasets} onSelect={onSelect} />
      <ManageItem label={evalT.navExperiments} />

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 p-2 border-t border-sidebar-border">
        <span
          aria-hidden
          className="w-[26px] h-[26px] shrink-0 rounded-full"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), color-mix(in srgb, hsl(var(--primary)) 70%, black))' }}
        />
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-[12.5px] font-sans text-foreground truncate">{kbLabel ?? evalT.selectPlaceholder}</div>
          <div className="text-[10.5px] font-sans text-muted-foreground">{evalT.navSectionEvaluate}</div>
        </div>
        <SettingsMenu />
      </div>
    </aside>
  );
}
