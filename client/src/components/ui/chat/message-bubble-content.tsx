import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MessageBubbleContentProps {
  text?: string;
  isSent: boolean;
  /** Grouped bubbles keep the tail corner only on the last one. */
  first?: boolean;
  last?: boolean;
  children?: ReactNode;
}

export function MessageBubbleContent({ text, isSent, first = true, last = true, children }: MessageBubbleContentProps) {
  return (
    <div
      className={cn(
        "max-w-full break-words rounded-2xl px-3.5 py-2 text-[14.5px] leading-relaxed",
        isSent ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        isSent ? [!first && "rounded-tr-md", !last && "rounded-br-md", last && "rounded-br-sm"] : [!first && "rounded-tl-md", !last && "rounded-bl-md", last && "rounded-bl-sm"],
      )}
    >
      {text}
      {children}
    </div>
  );
}
