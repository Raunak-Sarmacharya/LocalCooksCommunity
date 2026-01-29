import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MessageBubbleContentProps {
  text?: string;
  files?: Array<{ name: string; url: string }>;
  isSent: boolean;
  children?: ReactNode;
}

export function MessageBubbleContent({
  text,
  files,
  isSent,
  children
}: MessageBubbleContentProps) {
  return (
    <div
      className={cn(
        "text-sm text-accent-foreground bg-accent px-4 py-2.5 rounded-2xl break-words max-w-[100%]",
        isSent
          ? "bg-primary text-primary-foreground rounded-br-sm" // Shadboard uses rounded-se-none (start-end), keeping consistent with direction
          : "bg-muted text-foreground rounded-bl-sm"
      )}
    >
      {text}
      {children}
    </div>
  );
}
