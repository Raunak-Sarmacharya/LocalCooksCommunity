import * as React from "react"
import { cn } from "@/lib/utils"
import { ChatAvatar } from "./chat-avatar"
import { MessageBubbleContent } from "./message-bubble-content"
import { formatDistanceToNow } from "date-fns"

export interface ChatBubbleProps {
  variant: "sent" | "received"
  avatarSrc?: string
  avatarFallback?: string
  senderName?: string
  timestamp?: string | Date
  content?: string
  children?: React.ReactNode
  className?: string
}

export function ChatBubble({
  variant,
  avatarSrc,
  avatarFallback,
  senderName,
  timestamp,
  content,
  children,
  className,
}: ChatBubbleProps) {
  const isSent = variant === "sent";

  return (
    <li className={cn("flex gap-3 mb-4", isSent && "flex-row-reverse", className)}>
      <ChatAvatar 
        src={avatarSrc} 
        fallback={avatarFallback || (senderName?.[0] || "?")} 
        className="shrink-0 mt-auto" // Bottom align avatar like modern apps (optional, shadboard puts it top usually, checking ref: 'mt-0' or default)
        // Ref says: no mt class, so it's top aligned. Let's stick to Shadboard.
      />
      
      <div className={cn("flex flex-col gap-1 min-w-0 max-w-[80%]", isSent ? "items-end" : "items-start")}>
        <div className="flex items-center gap-2 px-1">
            <span className={cn("text-xs font-medium text-muted-foreground", isSent && "order-2")}>
                {senderName}
            </span>
        </div>

        <MessageBubbleContent isSent={isSent} text={content}>
            {children}
        </MessageBubbleContent>
        
        <div className="flex items-center gap-1 px-1">
            <span className="text-[10px] text-muted-foreground select-none">
                {typeof timestamp === 'string' ? timestamp : timestamp && formatDistanceToNow(timestamp, { addSuffix: true })}
            </span>
        </div>
      </div>
    </li>
  )
}

