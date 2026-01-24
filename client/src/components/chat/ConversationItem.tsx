import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ChatAvatar } from '@/components/ui/chat/chat-avatar';
import { Conversation } from '@/services/chat-service';
import { Timestamp } from 'firebase/firestore';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
  partnerName: string;
  partnerLocation?: string;
}

export function ConversationItem({
  conversation,
  isSelected,
  onClick,
  partnerName,
  partnerLocation
}: ConversationItemProps) {
  const lastMessageDate = conversation.lastMessageAt instanceof Date
    ? conversation.lastMessageAt
    : conversation.lastMessageAt instanceof Timestamp
      ? conversation.lastMessageAt.toDate()
      : new Date();

  // Determine unread count based on logic passed or implied by conversation object
  // (Note: The caller logic handles checking which role's unread count to show, 
  // but here we just show what's available or need a prop. For now, we'll assume the conversation object 
  // passed has the relevant count or we check both if unsure, but better to pass it in.)
  const unreadCount = Math.max(conversation.unreadChefCount || 0, conversation.unreadManagerCount || 0);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
        "hover:bg-accent hover:text-accent-foreground",
        isSelected ? "bg-accent text-accent-foreground" : "bg-background"
      )}
    >
      <ChatAvatar
        fallback={partnerName[0]}
        className="shrink-0"
      />
      
      <div className="flex-1 overflow-hidden grid grid-cols-12 gap-2">
        <div className="col-span-8 flex flex-col min-w-0">
          <span className="font-medium truncate text-sm">
            {partnerName}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {partnerLocation || "Cooks Community"}
          </span>
        </div>
        
        <div className="col-span-4 flex flex-col items-end justify-between py-0.5">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(lastMessageDate, { addSuffix: false }).replace('about ', '')}
          </span>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="h-5 min-w-5 px-1 flex items-center justify-center text-[10px]">
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
