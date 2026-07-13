"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, Loader2, LogOut, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/use-toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDateTime } from "@/lib/format"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { displayWorkspaceName } from "@/lib/i18n/workspace-name"
import { httpClient } from "@/lib/http/client"
import type {
  InviteRole,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from "@/lib/types"

type HomeT = ReturnType<typeof useLanguage>["home"]

type ExpiryOption = "24" | "72" | "168"

function roleBadgeVariant(role: WorkspaceRole): "default" | "secondary" | "outline" {
  return role === "owner" ? "default" : role === "admin" ? "secondary" : "outline"
}

export function WorkspaceMembersDialog({
  workspace,
  open,
  onOpenChange,
  currentUserId,
  onLeft,
  onMembersChanged,
  t,
}: {
  /** The active workspace; the dialog only renders content when non-null. */
  workspace: WorkspaceSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUserId: string
  onLeft: (workspaceId: string) => void
  onMembersChanged: () => void
  t: HomeT
}) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [inviteRole, setInviteRole] = useState<InviteRole>("member")
  const [inviteExpiry, setInviteExpiry] = useState<ExpiryOption>("72")
  const [isGenerating, setIsGenerating] = useState(false)
  const [lastInviteId, setLastInviteId] = useState<string | null>(null)
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<WorkspaceMember | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const { language } = useLanguage()
  const showErrorToast = useErrorToast()

  const viewerRole = workspace?.role
  const canManageInvites = viewerRole === "owner" || viewerRole === "admin"

  const roleLabel = useCallback(
    (role: WorkspaceRole) =>
      role === "owner" ? t.roleOwner : role === "admin" ? t.roleAdmin : t.roleMember,
    [t],
  )

  const canChangeRole = (member: WorkspaceMember) =>
    viewerRole === "owner" && member.role !== "owner"

  const canRemove = (member: WorkspaceMember) =>
    member.userId !== currentUserId &&
    member.role !== "owner" &&
    (viewerRole === "owner" || (viewerRole === "admin" && member.role === "member"))

  const loadData = useCallback(async () => {
    if (!workspace) return
    setIsLoading(true)
    try {
      const [membersData, invitesData] = await Promise.all([
        httpClient.get<{ members: WorkspaceMember[] }>(
          `/api/workspaces/${workspace.id}/members`,
        ),
        canManageInvites
          ? httpClient.get<{ invites: WorkspaceInvite[] }>(
              `/api/workspaces/${workspace.id}/invites`,
            )
          : Promise.resolve({ invites: [] as WorkspaceInvite[] }),
      ])
      setMembers(membersData.members)
      setInvites(invitesData.invites)
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.membersLoadFailed)
    } finally {
      setIsLoading(false)
    }
  }, [workspace, canManageInvites, showErrorToast, t])

  useEffect(() => {
    if (open && workspace) {
      setLastInviteId(null)
      void loadData()
    }
  }, [open, workspace, loadData])

  // A non-owner can never mint admin invites; drop a stale "admin" selection
  // carried over from a workspace where the viewer was owner, or the generate
  // button would POST role:"admin" and surface a confusing 403.
  useEffect(() => {
    if (viewerRole && viewerRole !== "owner") {
      setInviteRole("member")
    }
  }, [viewerRole])

  const handleRoleChange = async (member: WorkspaceMember, role: InviteRole) => {
    if (!workspace || role === member.role) return
    setUpdatingUserId(member.userId)
    try {
      await httpClient.patch(`/api/workspaces/${workspace.id}/members/${member.userId}`, { role })
      setMembers((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, role } : m)))
      toast({ title: t.roleUpdated })
      onMembersChanged()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.roleUpdateFailed)
    } finally {
      setUpdatingUserId(null)
    }
  }

  const handleRemove = async () => {
    if (!workspace || !confirmingRemove) return
    setIsRemoving(true)
    try {
      await httpClient.delete(`/api/workspaces/${workspace.id}/members/${confirmingRemove.userId}`)
      setMembers((prev) => prev.filter((m) => m.userId !== confirmingRemove.userId))
      setConfirmingRemove(null)
      toast({ title: t.memberRemoved })
      onMembersChanged()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.removeMemberFailed)
    } finally {
      setIsRemoving(false)
    }
  }

  const handleLeave = async () => {
    if (!workspace) return
    setIsLeaving(true)
    try {
      await httpClient.post(`/api/workspaces/${workspace.id}/leave`)
      setIsConfirmingLeave(false)
      onOpenChange(false)
      toast({ title: t.leftWorkspaceTitle })
      onLeft(workspace.id)
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.leaveFailed)
    } finally {
      setIsLeaving(false)
    }
  }

  const handleGenerateInvite = async () => {
    if (!workspace || isGenerating) return
    setIsGenerating(true)
    try {
      const data = await httpClient.post<{ invite: WorkspaceInvite }>(
        `/api/workspaces/${workspace.id}/invites`,
        { role: inviteRole, expiresInHours: Number(inviteExpiry) },
      )
      setInvites((prev) => [data.invite, ...prev])
      setLastInviteId(data.invite.id)
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.inviteCreateFailed)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      toast({ title: t.codeCopied })
    } catch {
      showErrorToast(t.copyFailed)
    }
  }

  const handleRevoke = async (inviteId: string) => {
    if (!workspace) return
    try {
      await httpClient.delete(`/api/workspaces/${workspace.id}/invites/${inviteId}`)
      setInvites((prev) => prev.filter((i) => i.id !== inviteId))
      if (lastInviteId === inviteId) setLastInviteId(null)
      toast({ title: t.inviteRevoked })
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.revokeInviteFailed)
    }
  }

  const formatExpiry = (iso: string) =>
    t.inviteExpiresLabel.replace("{date}", formatDateTime(iso, language))

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !isRemoving && !isLeaving && onOpenChange(next)}>
        <DialogContent
          disableAnimation
          className="max-h-[85vh] overflow-y-auto rounded-[1.1rem] border-black/8 bg-popover sm:max-w-lg dark:border-white/8 dark:bg-popover"
        >
          <DialogHeader>
            <DialogTitle>{t.membersTitle}</DialogTitle>
            <DialogDescription className="mt-2 text-sm/6 text-muted-foreground">
              {t.membersDescription.replace(
                "{workspaceName}",
                workspace ? displayWorkspaceName(workspace.name, t) : "",
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Member list */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-secondary/60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {member.email}
                    {member.userId === currentUserId && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{t.youLabel}</span>
                    )}
                  </span>
                  {canChangeRole(member) ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => handleRoleChange(member, value as InviteRole)}
                      disabled={updatingUserId === member.userId}
                    >
                      <SelectTrigger className="h-7 w-28 shrink-0 cursor-pointer rounded-lg text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin" className="cursor-pointer">
                          {t.roleAdmin}
                        </SelectItem>
                        <SelectItem value="member" className="cursor-pointer">
                          {t.roleMember}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={roleBadgeVariant(member.role)} className="shrink-0 font-mono text-[10px]">
                      {roleLabel(member.role)}
                    </Badge>
                  )}
                  {canRemove(member) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmingRemove(member)}
                      aria-label={t.removeMemberAction}
                      className="h-7 w-7 shrink-0 cursor-pointer rounded-full text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Invite codes (owner/admin only) */}
          {canManageInvites && !isLoading && (
            <div className="mt-2 border-t border-border pt-4">
              <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t.invitesTitle}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={inviteRole}
                  onValueChange={(value) => setInviteRole(value as InviteRole)}
                >
                  <SelectTrigger
                    aria-label={t.inviteRoleLabel}
                    className="h-8 w-28 cursor-pointer rounded-lg text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member" className="cursor-pointer">
                      {t.roleMember}
                    </SelectItem>
                    {viewerRole === "owner" && (
                      <SelectItem value="admin" className="cursor-pointer">
                        {t.roleAdmin}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Select
                  value={inviteExpiry}
                  onValueChange={(value) => setInviteExpiry(value as ExpiryOption)}
                >
                  <SelectTrigger
                    aria-label={t.inviteExpiryLabel}
                    className="h-8 w-28 cursor-pointer rounded-lg text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24" className="cursor-pointer">{t.expiry24h}</SelectItem>
                    <SelectItem value="72" className="cursor-pointer">{t.expiry72h}</SelectItem>
                    <SelectItem value="168" className="cursor-pointer">{t.expiry7d}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleGenerateInvite}
                  disabled={isGenerating}
                  className="h-8 cursor-pointer rounded-lg px-3 text-xs"
                >
                  {isGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isGenerating ? t.generatingInvite : t.generateInvite}
                </Button>
              </div>

              {invites.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">{t.noActiveInvites}</p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className={
                        invite.id === lastInviteId
                          ? "flex items-center gap-2 rounded-xl bg-secondary px-2.5 py-2"
                          : "flex items-center gap-2 rounded-xl px-2.5 py-2 hover:bg-secondary/60"
                      }
                    >
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                        {invite.token}
                      </code>
                      <Badge
                        variant={roleBadgeVariant(invite.role)}
                        className="shrink-0 font-mono text-[10px]"
                      >
                        {roleLabel(invite.role)}
                      </Badge>
                      <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
                        {formatExpiry(invite.expiresAt)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(invite.token)}
                        aria-label={t.copyCode}
                        className="h-7 w-7 shrink-0 cursor-pointer rounded-full"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevoke(invite.id)}
                        aria-label={t.revokeInvite}
                        className="h-7 w-7 shrink-0 cursor-pointer rounded-full text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Leave (non-owner only) */}
          {viewerRole && viewerRole !== "owner" && !isLoading && (
            <DialogFooter className="mt-2 border-t border-border pt-4 sm:justify-start">
              <Button
                variant="outline"
                onClick={() => setIsConfirmingLeave(true)}
                className="cursor-pointer rounded-lg text-destructive hover:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t.leaveWorkspace}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove-member confirmation */}
      <ConfirmDialog
        open={confirmingRemove !== null}
        onOpenChange={(next) => !next && setConfirmingRemove(null)}
        title={t.removeMemberConfirmTitle}
        description={t.removeMemberConfirmDesc.replace("{email}", confirmingRemove?.email || "")}
        cancelLabel={t.cancel}
        confirmLabel={t.removeMemberAction}
        busyLabel={t.removing}
        busy={isRemoving}
        icon={<Trash2 className="h-4 w-4" />}
        onConfirm={handleRemove}
      />

      {/* Leave-workspace confirmation */}
      <ConfirmDialog
        open={isConfirmingLeave}
        onOpenChange={setIsConfirmingLeave}
        title={t.leaveConfirmTitle}
        description={t.leaveConfirmDesc.replace(
          "{workspaceName}",
          workspace ? displayWorkspaceName(workspace.name, t) : "",
        )}
        cancelLabel={t.cancel}
        confirmLabel={t.leaveWorkspace}
        busyLabel={t.leaving}
        busy={isLeaving}
        icon={<LogOut className="h-4 w-4" />}
        onConfirm={handleLeave}
      />
    </>
  )
}
