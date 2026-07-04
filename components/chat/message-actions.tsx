"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Check, Copy, RefreshCw, Square, Volume2 } from "lucide-react"
import type { useLanguage } from "@/lib/i18n/LanguageContext"

type ChatT = ReturnType<typeof useLanguage>["t"]

const subscribeToTtsSupport = () => () => undefined
const getTtsSupportSnapshot = () => typeof window !== "undefined" && "speechSynthesis" in window
const getTtsSupportServerSnapshot = () => false
// speechSynthesis is a single browser-wide channel; this tracks which card
// owns the current utterance so unmounts only cancel their own speech.
let activeSpeechOwner: symbol | null = null

interface MessageActionsProps {
  text: string
  onRegenerate?: () => void
  regenerateDisabled?: boolean
  t: ChatT
}

export function MessageActions({
  text,
  onRegenerate,
  regenerateDisabled,
  t,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const speechOwnerRef = useRef(Symbol("message-speech"))
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const ttsSupported = useSyncExternalStore(
    subscribeToTtsSupport,
    getTtsSupportSnapshot,
    getTtsSupportServerSnapshot,
  )

  useEffect(() => {
    const speechOwner = speechOwnerRef.current
    return () => {
      if (activeSpeechOwner !== speechOwner) return
      activeSpeechOwner = null
      currentUtteranceRef.current = null
      if ("speechSynthesis" in window) window.speechSynthesis.cancel()
    }
  }, [])

  const handleCopy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable in insecure contexts; silently no-op.
    }
  }

  const handleSpeak = () => {
    const synth = window.speechSynthesis
    if (speaking) {
      activeSpeechOwner = null
      currentUtteranceRef.current = null
      synth.cancel()
      setSpeaking(false)
      return
    }
    if (!text) return
    // Strip citation markers and light markdown so they aren't read aloud.
    const spoken = text
      .replace(/\[\d+\]/g, "")
      .replace(/[#*_`~>]/g, "")
      .trim()
    if (!spoken) return
    const utterance = new SpeechSynthesisUtterance(spoken)
    utterance.onend = () => {
      if (currentUtteranceRef.current === utterance) currentUtteranceRef.current = null
      if (activeSpeechOwner === speechOwnerRef.current) activeSpeechOwner = null
      setSpeaking(false)
    }
    utterance.onerror = utterance.onend
    synth.cancel()
    activeSpeechOwner = speechOwnerRef.current
    currentUtteranceRef.current = utterance
    synth.speak(utterance)
    setSpeaking(true)
  }

  const hasText = text.length > 0

  return (
    <div className="-ml-2 flex items-center gap-1 text-muted-foreground">
      {hasText && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t.messageActions.copied : t.messageActions.copy}
          title={copied ? t.messageActions.copied : t.messageActions.copy}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {ttsSupported && hasText && (
        <button
          type="button"
          onClick={handleSpeak}
          aria-label={speaking ? t.messageActions.stop : t.messageActions.say}
          title={speaking ? t.messageActions.stop : t.messageActions.say}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {speaking ? <Square className="h-3.5 w-3.5 text-primary" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerateDisabled}
          aria-label={t.messageActions.regenerate}
          title={t.messageActions.regenerate}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
