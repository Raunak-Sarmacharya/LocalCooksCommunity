import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export interface ChatAvatarProps {
  src?: string
  fallback: string
  className?: string
  status?: string
}

export function ChatAvatar({ 
  src, 
  fallback, 
  className,
  status
}: ChatAvatarProps) {
  return (
    <div className={cn("relative inline-block", className)}>
      <Avatar>
        <AvatarImage src={src} />
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
      {status && (
        <span 
          className={cn(
            "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background",
            status === "online" ? "bg-green-500" : "bg-gray-400"
          )} 
        />
      )}
    </div>
  )
}
