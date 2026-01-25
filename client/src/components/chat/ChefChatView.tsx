import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, MessageCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { getAllConversations, type Conversation } from '@/services/chat-service';
import ChatPanel from './ChatPanel';
import { ConversationList } from './ConversationList';
import { cn } from '@/lib/utils';

// Define a minimal type for application details to avoid 'any'
interface ApplicationDetails {
  id: number;
  location?: {
    name?: string;
  };
  tier1_completed_at?: string | null;
}

interface ChefChatViewProps {
  chefId: number;
  embedded?: boolean;
}

export default function ChefChatView({
  chefId,
}: ChefChatViewProps) {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [applicationDetails, setApplicationDetails] = useState<Record<number, ApplicationDetails>>({});
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [managerNames, setManagerNames] = useState<Record<number, string>>({});

  // Mobile handling
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);

  // Fetch all conversations for this chef
  const { data: conversations = [], isLoading, error, refetch } = useQuery({
    queryKey: ['chef-conversations', chefId],
    queryFn: async () => {
      if (!chefId) return [];
      return await getAllConversations(chefId, 'chef');
    },
    enabled: !!chefId,
    refetchInterval: 30000,
  });

  // Track failed fetches to prevent infinite retries
  const failedLocationIds = useRef(new Set<number>());

  // Fetch application details...
  useEffect(() => {
    if (conversations.length === 0) return;

    const fetchApplicationDetails = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const token = await currentUser.getIdToken();
      const details: Record<number, ApplicationDetails> = {};
      const locations: Record<number, string> = {};
      const managers: Record<number, string> = {};

      try {
        const appsResponse = await fetch('/api/firebase/chef/kitchen-applications', {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });

        if (appsResponse.ok) {
          const allApps = await appsResponse.json();
          // Verify it's an array
          if (Array.isArray(allApps)) {
            for (const conv of conversations) {
              const matchingApp = allApps.find((app: ApplicationDetails) => app.id === conv.applicationId);
              if (matchingApp) {
                details[conv.applicationId] = matchingApp;
                if (matchingApp?.location?.name) {
                  locations[conv.locationId] = matchingApp.location.name;
                }
              }
            }
          } else {
            console.warn('[ChefChatView] Expected applications array but got:', typeof allApps);
          }
        }
      } catch (error) {
        console.error('Error fetching chef applications:', error);
      }

      // Fill in any missing location names
      const locationPromises = conversations
        .filter(conv => {
          // Skip if:
          // 1. We already have it in the local batch (locations)
          // 2. We already have it in component state (locationNames)
          // 3. We already failed to fetch it (failedLocationIds)
          if (locations[conv.locationId]) return false;
          if (locationNames[conv.locationId] && !locationNames[conv.locationId].startsWith('Unknown')) return false;
          if (failedLocationIds.current.has(conv.locationId)) return false;
          return true;
        })
        .map(async (conv) => {
          try {
            const locationResponse = await fetch(`/api/public/locations/${conv.locationId}/details`, {
              credentials: 'include',
            });
            if (locationResponse.ok) {
              const locationData = await locationResponse.json();
              if (locationData?.location?.name) {
                locations[conv.locationId] = locationData.location.name;
              } else {
                locations[conv.locationId] = "Unknown Location (No Name)";
                failedLocationIds.current.add(conv.locationId);
              }
            } else {
              locations[conv.locationId] = "Unknown Location (Not Found)";
              failedLocationIds.current.add(conv.locationId);
            }
          } catch (error) {
            console.error(`Error fetching location ${conv.locationId}:`, error);
            locations[conv.locationId] = "Unknown Location (Error)";
            failedLocationIds.current.add(conv.locationId);
          }
        });

      await Promise.all(locationPromises);
      setApplicationDetails(details);
      setLocationNames(prev => ({ ...prev, ...locations }));
      setManagerNames(managers);
    };

    fetchApplicationDetails();
  }, [conversations]);

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setIsMobileListVisible(false);
  };


  // Helpers to get display names
  const getPartnerName = (c: Conversation) =>
    managerNames[c.managerId] || "Manager";

  const getPartnerLocation = (c: Conversation) =>
    applicationDetails[c.applicationId]?.location?.name || locationNames[c.locationId] || `Location #${c.locationId}`;


  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 h-[600px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#208D80]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-2" />
        <p className="text-muted-foreground">Failed to load conversations.</p>
        <Button onClick={() => refetch()} variant="link">Retry</Button>
      </div>
    );
  }

  const filteredConversations = conversations.filter((conversation) => {
    const app = applicationDetails[conversation.applicationId];
    return !!app;
  });

  return (
    <Card className="w-full h-[calc(100vh-120px)] min-h-[500px] border shadow-sm overflow-hidden flex bg-background">
      {/* Sidebar List */}
      <div className={cn(
        "w-full md:w-80 border-r flex-col bg-muted/10",
        isMobileListVisible ? "flex" : "hidden md:flex"
      )}>
        <ConversationList
          conversations={filteredConversations}
          selectedId={selectedConversation?.id}
          onSelect={handleSelectConversation}
          getPartnerName={getPartnerName}
          getPartnerLocation={getPartnerLocation}
        />
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-background",
        !isMobileListVisible ? "flex" : "hidden md:flex"
      )}>
        {selectedConversation ? (
          <ChatPanel
            key={selectedConversation.id}
            conversationId={selectedConversation.id}
            chefId={chefId}
            managerId={selectedConversation.managerId}
            locationId={selectedConversation.locationId}
            locationName={getPartnerLocation(selectedConversation)}
            chefName={auth.currentUser?.displayName || "Me"}
            managerName={getPartnerName(selectedConversation)}
            onUnreadCountUpdate={() => refetch()}
            embedded={true}
            onClose={() => setIsMobileListVisible(true)} // In mobile this acts as "Back"
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h3 className="font-semibold text-lg">No chat selected</h3>
            <p className="text-sm">Select a conversation from the sidebar to start chatting.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
