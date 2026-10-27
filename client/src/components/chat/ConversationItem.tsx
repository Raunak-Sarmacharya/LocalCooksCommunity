import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChatAvatar } from "@/components/ui/chat/chat-avatar";
import { Conversation } from "@/services/chat-service";
import { Timestamp } from "firebase/firestore";
import { Archive, ArchiveRestore, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import { itemStatus, itemTag } from "./chat-context-format";
import { StatusChip } from "./ChatContextPanel";

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
  archived?: boolean;
  archiveBusy?: boolean;
  onToggleArchive?: () => void;
}

export function ConversationItem({
  conversation,
  isSelected,
  onClick,
  partnerName,
  partnerLocation,
  applicationStatus = 'unknown',
  viewerRole,
  unavailable = false,
  archived = false,
  archiveBusy = false,
  onToggleArchive,
}: ConversationItemProps) {
  const { t, i18n } = useTranslation('chef');
  const lastMessageDate = conversation.lastMessageAt instanceof Date
    ? conversation.lastMessageAt
    : conversation.lastMessageAt instanceof Timestamp
      ? conversation.lastMessageAt.toDate()
      : new Date();

  // Inbox clock: "11:48" today, "Mon" this week, "Oct 18" before that.
  const isJustNow = Date.now() - lastMessageDate.getTime() < 60_000;
  const ageDays = (Date.now() - lastMessageDate.getTime()) / 86_400_000;
  const relativeTime = isJustNow ? t("timeNow")
    : new Intl.DateTimeFormat(i18n.language, lastMessageDate.toDateString() === new Date().toDateString() ? { hour: "numeric", minute: "2-digit" }
      : ageDays < 6 ? { weekday: "short" } : { month: "short", day: "numeric" }).format(lastMessageDate);

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
          // Same state, opposite job. The chef has something to do; the manager is
          // waiting on them. One shared label told both sides the wrong thing.
          label: viewerRole === 'manager' ? t('chatAwaitingApplication') : t('chatStep1Approved'),
          icon: Clock,
          className: 'bg-blue-50 text-blue-700 border-blue-200'
        };
      case 'step2_review':
        return {
          label: t('chatStep2Review'),
          icon: Clock,
          className: 'bg-orange-50 text-orange-700 border-orange-200'
        };
      // Fully approved is the normal state: no badge (only steps still in progress get one).
      case 'fully_approved':
        return null;
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

  // Chef side leads with the kitchen and its photo; the kitchen side leads with the customer.
  const title = viewerRole === 'chef' ? partnerLocation || partnerName : partnerName;
  const subtitle = viewerRole === 'chef' ? (partnerLocation ? partnerName : '') : partnerLocation;
  const next = conversation.summary?.next;
  const nextStatus = next ? itemStatus(next, t as unknown as (key: string, options?: Record<string, unknown>) => string) : null;
  return (
    <div className="group relative">
    <button
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "grid w-full grid-cols-[44px_1fr_auto] items-start gap-3 rounded-xl p-3 pr-3 text-left transition-colors",
        isSelected ? "bg-primary/[0.07] shadow-[inset_3px_0_0_hsl(var(--primary))]" : "hover:bg-muted/60",
      )}
    >
      <ChatAvatar
        src={viewerRole === 'chef' ? resolveImageUrl(conversation.summary?.imageUrl) ?? undefined : undefined}
        fallback={(title || '?')[0]}
        className={cn("size-11 shrink-0", viewerRole === 'chef' && "rounded-xl", unavailable && "opacity-50 grayscale")}
      />
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-semibold", unavailable && "text-muted-foreground")}>{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
        {(unavailable || conversation.lastMessageText?.trim()) && (
          <span className={cn("mt-0.5 block truncate text-[13px]",
            unavailable ? "italic text-muted-foreground/80" : unreadCount > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {unavailable
              // Overrides the last-message preview: the more useful fact about
              // a dormant thread is that it is dormant, not what was last said.
              ? t("chatUnavailableShort", "Account deleted — no longer available")
              : conversation.lastMessageText!.trim()}
          </span>
        )}
        {(next || statusBadge || unavailable) && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {unavailable && <Badge variant="outline" className="bg-muted text-xs font-normal text-muted-foreground">{t('chatInactive', 'Inactive')}</Badge>}
            {next && nextStatus && !unavailable && <StatusChip tone={nextStatus.tone}>{itemTag(next, t as unknown as (key: string, options?: Record<string, unknown>) => string, i18n.language)}</StatusChip>}
            {statusBadge && !unavailable && !next && <StatusChip tone="wait">{statusBadge.label}</StatusChip>}
          </span>
        )}
      </span>
      <span className="flex flex-col items-end gap-1.5 pt-0.5">
        <span className="whitespace-nowrap text-xs text-muted-foreground">{relativeTime}</span>
        {unreadCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground" aria-label={t("chatUnreadCount", { count: unreadCount })}>{unreadCount}</span>}
      </span>
    </button>
    {onToggleArchive && !unavailable && (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={archiveBusy}
        onClick={onToggleArchive}
        aria-label={archived ? t('chatRestore', 'Restore chat') : t('chatArchive', 'Archive chat')}
        title={archived ? t('chatRestore', 'Restore chat') : t('chatArchive', 'Archive chat')}
        className="absolute bottom-2 right-2 size-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      </Button>
    )}
    </div>
  );
}
