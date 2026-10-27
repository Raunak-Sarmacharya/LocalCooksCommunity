import * as React from "react"
import { cn } from "@/lib/utils"
import { ChatAvatar } from "./chat-avatar"
import { MessageBubbleContent } from "./message-bubble-content"

export interface ChatBubbleProps {
  variant: "sent" | "received"
  avatarSrc?: string
  avatarFallback?: string
  /** Shown above the first bubble of a group from someone else (who's talking when it isn't obvious). */
  senderName?: string
  timestamp?: string
  /** "Seen" on your latest message once the other side has read it. */
  status?: string
  /** Messages from one person within a few minutes read as one group: name on the first, time and avatar on the last. */
  first?: boolean
  last?: boolean
  content?: string
  children?: React.ReactNode
  className?: string
}

export function ChatBubble({ variant, avatarSrc, avatarFallback, senderName, timestamp, status, first = true, last = true, content, children, className }: ChatBubbleProps) {
  const isSent = variant === "sent"
  return (
    <li className={cn("flex items-end gap-2", isSent ? "justify-end" : "justify-start", first ? "mt-4" : "mt-1", className)}>
      {!isSent && (
        <div className="size-8 shrink-0" aria-hidden={!last}>
          {last && <ChatAvatar src={avatarSrc} fallback={avatarFallback || senderName?.[0] || "?"} className="size-8" />}
        </div>
      )}
      <div className={cn("flex min-w-0 max-w-[75%] flex-col", isSent ? "items-end" : "items-start")}>
        {first && !isSent && senderName && <span className="mb-1 px-1 text-xs font-medium text-muted-foreground">{senderName}</span>}
        <MessageBubbleContent isSent={isSent} text={content} first={first} last={last}>{children}</MessageBubbleContent>
        {last && (timestamp || status) && (
          <span className="mt-1 px-1 text-[11px] text-muted-foreground select-none">{[timestamp, status].filter(Boolean).join(" · ")}</span>
        )}
      </div>
    </li>
  )
}
