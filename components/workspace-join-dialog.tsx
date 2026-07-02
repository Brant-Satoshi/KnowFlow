"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { displayWorkspaceName } from "@/lib/i18n/workspace-name"
import { httpClient, HttpError } from "@/lib/http/client"
import type { WorkspaceRole } from "@/lib/types"

export type JoinedWorkspace = { id: string; name: string; role: WorkspaceRole }

export function WorkspaceJoinDialog({
  open,
  onOpenChange,
  onJoined,
  t,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onJoined: (workspace: JoinedWorkspace, alreadyMember: boolean) => void
  t: ReturnType<typeof useLanguage>["home"]
}) {
  const [code, setCode] = useState("")
  const [isJoining, setIsJoining] = useState(false)
  const showErrorToast = useErrorToast()

  const handleJoin = async () => {
    const trimmed = code.trim()
    if (!trimmed || isJoining) return
    setIsJoining(true)
    try {
      const data = await httpClient.post<{ workspace: JoinedWorkspace; alreadyMember: boolean }>(
        "/api/workspaces/join",
        { code: trimmed },
      )
      const workspaceName = displayWorkspaceName(data.workspace.name, t)
      if (data.alreadyMember) {
        toast({
          title: t.alreadyMemberTitle,
          description: t.alreadyMemberDesc.replace("{workspaceName}", workspaceName),
        })
      } else {
        toast({
          title: t.joinSuccessTitle,
          description: t.joinSuccessDesc.replace("{workspaceName}", workspaceName),
        })
      }
      setCode("")
      onOpenChange(false)
      onJoined(data.workspace, data.alreadyMember)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        // Keep the dialog open so the user can fix a typo and retry.
        showErrorToast(t.joinInvalidCode)
        return
      }
      showErrorToast(error instanceof Error ? error.message : t.joinFailed)
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isJoining && onOpenChange(next)}>
      <DialogContent
        disableAnimation
        className="rounded-[1.1rem] border-black/8 bg-popover dark:border-white/8 dark:bg-popover"
      >
        <DialogHeader>
          <DialogTitle>{t.joinWorkspaceTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
            {t.joinWorkspaceDescription}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleJoin()
          }}
          placeholder={t.inviteCodePlaceholder}
          className="font-mono text-sm"
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isJoining}
            className="rounded-lg"
          >
            {t.cancel}
          </Button>
          <Button
            onClick={handleJoin}
            disabled={!code.trim() || isJoining}
            className="rounded-lg"
          >
            {isJoining && <Loader2 className="h-4 w-4 animate-spin" />}
            {isJoining ? t.joining : t.joinAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
