import * as React from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
    scrollRef?: React.RefObject<HTMLDivElement>
}

export function ChatMessageList({
    children,
    className,
    scrollRef,
    ...props
}: ChatMessageListProps) {
    return (
        <ScrollArea className="flex-1 h-full">
            <div
                className={cn("flex flex-col gap-6 p-4", className)}
                {...props}
            >
                {children}
                <div ref={scrollRef} />
            </div>
        </ScrollArea>
    )
}
