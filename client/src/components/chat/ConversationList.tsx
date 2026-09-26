import { useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
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

  const filteredConversations = conversations.filter(c => 
    getPartnerName(c).toLowerCase().includes(searchQuery.toLowerCase()) ||
    getPartnerLocation(c).toLowerCase().includes(searchQuery.toLowerCase())
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
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {isLoading ? (
            <ConversationListSkeleton count={4} />
          ) : filteredConversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("chatNoConversations")}
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
