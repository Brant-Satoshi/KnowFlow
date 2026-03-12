"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileText, Plus, Loader2, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/use-toast"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { KnowledgeBase } from "@/lib/types"

export default function HomePage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [newKbName, setNewKbName] = useState("")
  const [newKbDesc, setNewKbDesc] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()
  const { home: t } = useLanguage()

  const fetchKnowledgeBases = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-bases")
      const json = await res.json()
      if (json.ok) {
        setKnowledgeBases(json.data.knowledgeBases)
      }
    } catch (e) {
      console.error("Failed to fetch knowledge bases:", e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKnowledgeBases()
  }, [fetchKnowledgeBases])

  const handleCreateKnowledgeBase = async () => {
    if (!newKbName.trim()) return

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKbName.trim(), description: newKbDesc.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        setKnowledgeBases((prev) => [json.data.knowledgeBase, ...prev])
        setIsCreating(false)
        setNewKbName("")
        setNewKbDesc("")
        // Redirect to chat with the new knowledge base
        router.push(`/knowledge-bases/${json.data.knowledgeBase.id}/chat`)
      } else {
        toast({ variant: "destructive", description: json.error || "Failed to create" })
      }
    } catch (e) {
      toast({
        variant: "destructive",
        description: e instanceof Error ? e.message : "Failed to create",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  return (
    <div className="min-h-screen bg-[var(--chat-page-bg)]">
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold text-foreground">{t.title}</h1>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">{t.knowledgeBases}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.knowledgeBasesDesc}
            </p>
          </div>
          <Button onClick={() => setIsCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t.createKnowledgeBase}
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="border-border">
                <CardHeader className="pb-3">
                  <Skeleton className="h-5 w-3/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : knowledgeBases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <h3 className="text-lg font-medium text-foreground">{t.noKnowledgeBases}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.noKnowledgeBasesHint}
            </p>
            <Button onClick={() => setIsCreating(true)} className="mt-4 gap-2">
              <Plus className="h-4 w-4" />
              {t.createKnowledgeBase}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {knowledgeBases.map((kb) => (
              <Link key={kb.id} href={`/knowledge-bases/${kb.id}/chat`}>
                <Card className="cursor-pointer transition-colors hover:bg-secondary/50 border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="h-4 w-4 text-primary" />
                      {kb.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {kb.description ? (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {kb.description}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground/60">{t.noDescription}</p>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t.created} {formatDate(kb.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.createKnowledgeBase}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t.name}</label>
              <Input
                placeholder={t.namePlaceholder}
                value={newKbName}
                onChange={(e) => setNewKbName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateKnowledgeBase()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t.description}</label>
              <Input
                placeholder={t.descriptionPlaceholder}
                value={newKbDesc}
                onChange={(e) => setNewKbDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateKnowledgeBase()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreating(false)}>
              {t.cancel}
            </Button>
            <Button onClick={handleCreateKnowledgeBase} disabled={!newKbName.trim() || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t.creating}
                </>
              ) : (
                t.create
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
