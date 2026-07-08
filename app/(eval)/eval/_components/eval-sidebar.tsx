'use client';

import type { ComponentType } from 'react';
import Link from 'next/link';
import { Beaker, Database, GitCompare, LayoutDashboard, ScanSearch } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { SidebarBody, SidebarSectionLabel, navItemClass } from '@/components/app-sidebar';
import { cn } from '@/lib/utils';
import type { EvalTranslationKeys } from '@/lib/i18n/translations';

export type EvalTab = 'overview' | 'compare' | 'inspector' | 'dataset';

type IconType = ComponentType<{ className?: string }>;

function NavItem({
  tab,
  active,
  label,
  icon: Icon,
  onSelect,
}: {
  tab: EvalTab;
  active: boolean;
  label: string;
  icon: IconType;
  onSelect: (t: EvalTab) => void;
}) {
  return (
    <button type="button" onClick={() => onSelect(tab)} className={navItemClass(active)}>
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

function ManageItem({ label, icon: Icon }: { label: string; icon: IconType }) {
  return (
    <div
      className={cn(
        navItemClass(false),
        'cursor-default select-none opacity-60 hover:bg-transparent hover:text-sidebar-foreground/70'
      )}
      title={label}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </div>
  );
}

type EvalSidebarProps = {
  activeTab: EvalTab;
  onSelect: (t: EvalTab) => void;
  appName: string;
  kbLabel: string | null;
  evalT: EvalTranslationKeys;
};

/**
 * Sidebar body (everything below the brand logo). Shared by the desktop
 * `<aside>` and the mobile drawer.
 */
export function EvalSidebarNav({
  activeTab,
  onSelect,
  kbLabel,
  evalT,
}: Omit<EvalSidebarProps, 'appName'>) {
  const items: { tab: EvalTab; label: string; icon: IconType }[] = [
    { tab: 'overview', label: evalT.tabOverview, icon: LayoutDashboard },
    { tab: 'compare', label: evalT.tabCompare, icon: GitCompare },
    { tab: 'inspector', label: evalT.tabInspector, icon: ScanSearch },
  ];

  return (
    <SidebarBody
      footerTitle={kbLabel ?? evalT.selectPlaceholder}
      footerSubtitle={evalT.navSectionEvaluate}
    >
      <SidebarSectionLabel>{evalT.navSectionEvaluate}</SidebarSectionLabel>
      {items.map(it => (
        <NavItem
          key={it.tab}
          tab={it.tab}
          active={activeTab === it.tab}
          label={it.label}
          icon={it.icon}
          onSelect={onSelect}
        />
      ))}

      <SidebarSectionLabel>{evalT.navSectionManage}</SidebarSectionLabel>
      <NavItem
        tab="dataset"
        active={activeTab === 'dataset'}
        label={evalT.navDatasets}
        icon={Database}
        onSelect={onSelect}
      />
      <ManageItem label={evalT.navExperiments} icon={Beaker} />
    </SidebarBody>
  );
}

/** Desktop sidebar — hidden below `md`, where {@link MobileNav} takes over. */
export function EvalSidebar({ appName, ...rest }: EvalSidebarProps) {
  return (
    <aside className="hidden flex-col gap-1 border-r border-sidebar-border bg-sidebar px-3 py-4 md:sticky md:top-0 md:flex md:h-screen">
      <Link href="/" className="cursor-pointer flex items-center px-2 pb-4">
        <BrandLogo
          name={appName}
          wordmarkAccent
          textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
        />
      </Link>
      <EvalSidebarNav {...rest} />
    </aside>
  );
}
