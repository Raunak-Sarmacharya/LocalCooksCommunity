import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChatAvatar } from "@/components/ui/chat/chat-avatar";
import { Conversation } from "@/services/chat-service";
import { Timestamp } from "firebase/firestore";
import { CheckCircle, Clock, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ApplicationStatus = 'inReview' | 'step1_approved' | 'step2_review' | 'fully_approved' | 'rejected' | 'unknown';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
  partnerName: string;
  partnerLocation?: string;
  applicationStatus?: ApplicationStatus;
  viewerRole?: 'chef' | 'manager';
  /**
   * Dormant because a participant's account was deleted. Passed explicitly so
   * the caller can combine the stored flag with a live liveness check.
   */
  unavailable?: boolean;
}

export function ConversationItem({
  conversation,
  isSelected,
  onClick,
  partnerName,
  partnerLocation,
  applicationStatus = 'unknown',
  viewerRole,
  unavailable = false
}: ConversationItemProps) {
  const { t } = useTranslation('chef');
  const lastMessageDate = conversation.lastMessageAt instanceof Date
    ? conversation.lastMessageAt
    : conversation.lastMessageAt instanceof Timestamp
      ? conversation.lastMessageAt.toDate()
      : new Date();

  // Anything under a minute reads as "now" rather than date-fns's wordy
  // "less than a minute", which is both long for this column and clashes with
  // the terse "3 minutes" / "2 days" style of the older entries.
  const isJustNow = Date.now() - lastMessageDate.getTime() < 60_000;
  const relativeTime = isJustNow
    ? t("timeNow")
    : formatDistanceToNow(lastMessageDate, { addSuffix: false }).replace('about ', '');

  // Determine unread count based on the viewer's role
  // Chef sees unreadChefCount (messages from manager they haven't read)
  // Manager sees unreadManagerCount (messages from chef they haven't read)
  //
  // Suppressed entirely once the thread is dormant: an unread badge is a call to
  // action, and there is no action left to take in a conversation whose other
  // participant no longer exists.
  const unreadCount = unavailable
    ? 0
    : viewerRole === 'chef'
      ? (conversation.unreadChefCount || 0)
      : viewerRole === 'manager'
        ? (conversation.unreadManagerCount || 0)
        : 0;

  // Get status badge configuration based on application status
  const getStatusBadge = () => {
    switch (applicationStatus) {
      case 'step1_approved':
        return {
          label: t('chatStep1Approved'),
          icon: Clock,
          className: 'bg-blue-50 text-blue-700 border-blue-200'
        };
      case 'step2_review':
        return {
          label: t('chatStep2Review'),
          icon: Clock,
          className: 'bg-orange-50 text-orange-700 border-orange-200'
        };
      case 'fully_approved':
        return {
          label: t('chatApproved'),
          icon: CheckCircle,
          className: 'bg-green-50 text-green-700 border-green-200'
        };
      case 'inReview':
        return {
          label: t('chatPending'),
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
          className={cn("shrink-0", unavailable && "opacity-50 grayscale")}
        />
        
        <div className="flex-1 overflow-hidden grid grid-cols-12 gap-2">
          <div className="col-span-8 flex flex-col min-w-0">
            <span className={cn(
              "font-medium truncate text-sm",
              unavailable && "text-muted-foreground"
            )}>
              {partnerName}
            </span>
            <span
              className={cn(
                "text-xs truncate",
                unavailable
                  ? "text-muted-foreground/80 italic"
                  : unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {unavailable
                // Overrides the last-message preview: the more useful fact about
                // a dormant thread is that it is dormant, not what was last said.
                ? t("chatUnavailableShort", "Account deleted — no longer available")
                : conversation.lastMessageText?.trim() ||
                  partnerLocation ||
                  t("chatCooksCommunity")}
            </span>
          </div>
          
          <div className="col-span-4 flex flex-col items-end justify-between py-0.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {relativeTime}
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
              "text-xs px-2 py-0.5 font-medium flex items-center gap-1",
              statusBadge.className
            )}
          >
            <statusBadge.icon className="h-3 w-3" />
            {statusBadge.label}
          </Badge>
          {applicationStatus === 'step1_approved' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageCircle className="h-3 w-3" />
              {t("chatEnabled")}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
