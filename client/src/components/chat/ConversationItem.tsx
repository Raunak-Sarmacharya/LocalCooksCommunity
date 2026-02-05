import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ChatAvatar } from '@/components/ui/chat/chat-avatar';
import { Conversation } from '@/services/chat-service';
import { Timestamp } from 'firebase/firestore';
import { CheckCircle, Clock, MessageCircle } from 'lucide-react';

export type ApplicationStatus = 'inReview' | 'step1_approved' | 'step2_review' | 'fully_approved' | 'rejected' | 'unknown';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
  partnerName: string;
  partnerLocation?: string;
  applicationStatus?: ApplicationStatus;
  viewerRole?: 'chef' | 'manager';
}

export function ConversationItem({
  conversation,
  isSelected,
  onClick,
  partnerName,
  partnerLocation,
  applicationStatus = 'unknown',
  viewerRole
}: ConversationItemProps) {
  const lastMessageDate = conversation.lastMessageAt instanceof Date
    ? conversation.lastMessageAt
    : conversation.lastMessageAt instanceof Timestamp
      ? conversation.lastMessageAt.toDate()
      : new Date();

  // Determine unread count based on the viewer's role
  // Chef sees unreadChefCount (messages from manager they haven't read)
  // Manager sees unreadManagerCount (messages from chef they haven't read)
  const unreadCount = viewerRole === 'chef' 
    ? (conversation.unreadChefCount || 0)
    : viewerRole === 'manager'
      ? (conversation.unreadManagerCount || 0)
      : 0;

  // Get status badge configuration based on application status
  const getStatusBadge = () => {
    switch (applicationStatus) {
      case 'step1_approved':
        return {
          label: 'Step 1 Approved',
          icon: CheckCircle,
          className: 'bg-blue-50 text-blue-700 border-blue-200'
        };
      case 'step2_review':
        return {
          label: 'Step 2 Review',
          icon: Clock,
          className: 'bg-orange-50 text-orange-700 border-orange-200'
        };
      case 'fully_approved':
        return {
          label: 'Approved',
          icon: CheckCircle,
          className: 'bg-green-50 text-green-700 border-green-200'
        };
      case 'inReview':
        return {
          label: 'Pending',
          icon: Clock,
          className: 'bg-yellow-50 text-yellow-700 border-yellow-200'
        };
      default:
        return null;
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex flex-col gap-2 p-3 rounded-lg transition-all text-left",
        "hover:bg-accent hover:text-accent-foreground",
        isSelected ? "bg-accent text-accent-foreground" : "bg-background"
      )}
    >
      <div className="flex items-center gap-3 w-full">
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
              <Badge variant="destructive" className="flex items-center justify-center">
                {unreadCount}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Application Status Badge - Enterprise indicator */}
      {statusBadge && (
        <div className="flex items-center gap-1.5 ml-11">
          <Badge 
            variant="outline" 
            className={cn(
              "text-[10px] px-2 py-0.5 font-medium flex items-center gap-1",
              statusBadge.className
            )}
          >
            <statusBadge.icon className="h-3 w-3" />
            {statusBadge.label}
          </Badge>
          {applicationStatus === 'step1_approved' && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <MessageCircle className="h-3 w-3" />
              Chat enabled
            </span>
          )}
        </div>
      )}
    </button>
  );
}
