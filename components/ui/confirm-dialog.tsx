"use client"

import type { ReactNode } from "react"
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

interface ConfirmDialogProps {
  open: boolean
  /** Close requests are ignored while `busy`. */
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  /** Confirm-button label while busy; falls back to `confirmLabel`. */
  busyLabel?: string
  busy?: boolean
  /** Idle icon on the confirm button; replaced by a spinner while busy. */
  icon?: ReactNode
  onConfirm: () => void
}

/** Destructive-action confirmation dialog (delete / remove / leave). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  busyLabel,
  busy = false,
  icon,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        disableAnimation
        className="rounded-[1.1rem] border-black/8 bg-popover dark:border-white/8 dark:bg-popover"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm/6 text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded-lg"
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
