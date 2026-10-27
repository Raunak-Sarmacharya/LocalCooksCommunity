import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationItem, ApplicationStatus } from "./ConversationItem";
import { ConversationListSkeleton } from "./ConversationItemSkeleton";
import { Conversation } from "@/services/chat-service";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
  getPartnerName: (conversation: Conversation) => string;
  getPartnerLocation: (conversation: Conversation) => string;
  getApplicationStatus?: (conversation: Conversation) => ApplicationStatus;
  viewerRole?: 'chef' | 'manager';
  /**
   * Renders row-shaped skeletons in place of the (possibly empty) list while
   * conversations — or the application details they depend on — are loading.
   */
  isLoading?: boolean;
  /**
   * Resolves whether a conversation is dormant because a participant's account
   * was deleted. Passed in rather than read off the conversation so a caller can
   * combine the stored flag with a live check against Postgres.
   */
  isConversationUnavailable?: (conversation: Conversation) => boolean;
  onToggleArchive?: (conversation: Conversation, archived: boolean) => void;
  archiveBusyId?: string | null;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  getPartnerName,
  getPartnerLocation,
  getApplicationStatus,
  viewerRole,
  isLoading = false,
  isConversationUnavailable,
  onToggleArchive,
  archiveBusyId,
}: ConversationListProps) {
  const { t } = useTranslation('chef');
  const [searchQuery, setSearchQuery] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  type Filter = 'all' | 'unread' | 'booking' | 'tour' | 'storage';
  const [filter, setFilter] = useState<Filter>('all');
  const unread = (c: Conversation) => (viewerRole === 'chef' ? c.unreadChefCount : c.unreadManagerCount) > 0;
  const kinds = (['booking', 'tour', 'storage'] as const).filter(kind => conversations.some(c => c.summary?.kinds.includes(kind)));
  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: t('chatFilterAll') },
    { id: 'unread', label: t('chatFilterUnread'), count: conversations.filter(unread).length },
    ...kinds.map(kind => ({ id: kind, label: t(`chatFilter_${kind}`) })),
  ];

  const query = searchQuery.trim().toLowerCase();
  const filteredConversations = conversations.filter(c =>
    (filter === 'all' || (filter === 'unread' ? unread(c) : !!c.summary?.kinds.includes(filter)))
    && (!query || [getPartnerName(c), getPartnerLocation(c), c.lastMessageText ?? ''].some(text => text.toLowerCase().includes(query)))
  );
  const isArchived = (c: Conversation) => viewerRole === 'chef' ? !!c.archivedChefAt : !!c.archivedManagerAt;
  const isInactive = (c: Conversation) => isConversationUnavailable?.(c) ?? (c.unavailable === true);
  const archived = filteredConversations.filter(c => isArchived(c) || isInactive(c));
  const active = filteredConversations.filter(c => !isArchived(c) && !isInactive(c));
  const selectedArchived = archived.some(c => c.id === selectedId);
  useEffect(() => {
    if (selectedArchived) setArchivedOpen(true);
  }, [selectedArchived]);
  const renderConversation = (conversation: Conversation) => (
    <ConversationItem
      key={conversation.id}
      conversation={conversation}
      isSelected={selectedId === conversation.id}
      onClick={() => onSelect(conversation)}
      partnerName={getPartnerName(conversation)}
      partnerLocation={getPartnerLocation(conversation)}
      applicationStatus={getApplicationStatus?.(conversation)}
      viewerRole={viewerRole}
      unavailable={isConversationUnavailable?.(conversation) ?? conversation.unavailable}
      archived={isArchived(conversation)}
      archiveBusy={archiveBusyId === conversation.id}
      onToggleArchive={onToggleArchive ? () => onToggleArchive(conversation, !isArchived(conversation)) : undefined}
    />
  );

  return (
    <div className="flex flex-col h-full bg-background border-r">
      <div className="p-4 border-b space-y-4">
        <h2 className="font-semibold text-lg tracking-tight">{t("shellMessages")}</h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("chatSearchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-muted/50"
          />
        </div>
        {conversations.length > 1 && (
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label={t('chatFilters')}>
            {filters.map(item => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}
                className={filter === item.id ? "shrink-0 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background"
                  : "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium shadow-[inset_0_0_0_1px_hsl(var(--border))] hover:bg-muted"}>
                {item.label}{item.count ? <span className={filter === item.id ? "ml-1" : "ml-1 text-primary"}>{item.count}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {isLoading ? (
            <ConversationListSkeleton count={4} />
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center text-muted-foreground">
              <MessageCircle className="mb-3 size-6 text-primary/50" />
              <p className="text-sm font-medium text-foreground">{t(searchQuery || filter !== 'all' ? "chatNoSearchResults" : "chatNoConversations")}</p>
              {(searchQuery || filter !== 'all') && <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => { setSearchQuery(""); setFilter('all'); }}>{t("chatClearSearch")}</button>}
            </div>
          ) : (
            <>
              {active.map(renderConversation)}
              {archived.length > 0 && (
                <Collapsible open={archivedOpen || Boolean(searchQuery)} onOpenChange={setArchivedOpen}>
                  <CollapsibleTrigger className="group mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted">
                    <span>{t('chatArchivedChats', 'Archived')} ({archived.length})</span>
                    <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1">{archived.map(renderConversation)}</CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
