import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationItem, ApplicationStatus } from './ConversationItem';
import { Conversation } from '@/services/chat-service';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
  getPartnerName: (conversation: Conversation) => string;
  getPartnerLocation: (conversation: Conversation) => string;
  getApplicationStatus?: (conversation: Conversation) => ApplicationStatus;
  viewerRole?: 'chef' | 'manager';
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  getPartnerName,
  getPartnerLocation,
  getApplicationStatus,
  viewerRole
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = conversations.filter(c => 
    getPartnerName(c).toLowerCase().includes(searchQuery.toLowerCase()) ||
    getPartnerLocation(c).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-background border-r">
      <div className="p-4 border-b space-y-4">
        <h2 className="font-semibold text-lg tracking-tight">Messages</h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-muted/50"
          />
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No conversations found.
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => onSelect(conversation)}
                partnerName={getPartnerName(conversation)}
                partnerLocation={getPartnerLocation(conversation)}
                applicationStatus={getApplicationStatus?.(conversation)}
                viewerRole={viewerRole}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
