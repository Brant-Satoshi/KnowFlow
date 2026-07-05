"use client"

import { Building2, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { displayWorkspaceName } from "@/lib/i18n/workspace-name"
import type { WorkspaceRole, WorkspaceSummary } from "@/lib/types"

// Radix radio groups only take string values; this sentinel stands in for
// `null` (the merged all-workspaces view).
const ALL_SENTINEL = "__all__"

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onManageMembers,
  onJoin,
  t,
}: {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string | null
  onSelect: (id: string | null) => void
  onManageMembers: () => void
  onJoin: () => void
  t: ReturnType<typeof useLanguage>["home"]
}) {
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  const roleLabel = (role: WorkspaceRole) =>
    role === "owner" ? t.roleOwner : role === "admin" ? t.roleAdmin : t.roleMember

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t.workspaceSwitcherLabel}
          className="h-8 cursor-pointer rounded-full px-3.5 font-mono text-xs font-medium tracking-wide"
        >
          <Building2 className="h-3.5 w-3.5" />
          <span className="hidden max-w-28 truncate sm:inline">
            {active ? displayWorkspaceName(active.name, t) : t.allWorkspaces}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
        <DropdownMenuLabel className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t.workspacesLabel}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={activeWorkspaceId ?? ALL_SENTINEL}
          onValueChange={(value) => onSelect(value === ALL_SENTINEL ? null : value)}
        >
          <DropdownMenuRadioItem value={ALL_SENTINEL} className="cursor-pointer">
            {t.allWorkspaces}
          </DropdownMenuRadioItem>
          {workspaces.map((ws) => (
            <DropdownMenuRadioItem key={ws.id} value={ws.id} className="cursor-pointer">
              <span className="min-w-0 flex-1 truncate">{displayWorkspaceName(ws.name, t)}</span>
              <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                {roleLabel(ws.role)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onManageMembers}
          disabled={!active}
          className="cursor-pointer"
        >
          <Users className="h-4 w-4" />
          {t.manageMembers}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onJoin} className="cursor-pointer">
          <UserPlus className="h-4 w-4" />
          {t.joinWorkspace}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
