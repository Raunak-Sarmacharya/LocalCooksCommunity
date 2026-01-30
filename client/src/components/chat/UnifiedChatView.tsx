import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, MessageCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { getAllConversations, type Conversation } from '@/services/chat-service';
import ChatPanel from './ChatPanel';
import { ConversationList } from './ConversationList';
import { ApplicationStatus } from './ConversationItem';
import { cn } from '@/lib/utils';

interface ApplicationDetails {
  id: number;
  location?: {
    name?: string;
  };
  chef?: {
    username?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
  };
  fullName?: string;
  status?: string;
  current_tier?: number;
  tier1_completed_at?: string | null;
  tier2_completed_at?: string | null;
}

interface UnifiedChatViewProps {
  userId: number;
  role: 'chef' | 'manager';
  initialConversationId?: string | null;
}

export default function UnifiedChatView({ userId, role, initialConversationId }: UnifiedChatViewProps) {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [applicationDetails, setApplicationDetails] = useState<Record<number, ApplicationDetails>>({});
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [partnerNames, setPartnerNames] = useState<Record<number, string>>({});
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);

  // Fetch all conversations
  const { data: conversations = [], isLoading, error, refetch } = useQuery({
    queryKey: [`${role}-conversations`, userId],
    queryFn: async () => {
      if (!userId) return [];
      return await getAllConversations(userId, role);
    },
    enabled: !!userId,
    refetchInterval: 30000,
    retry: 2,
    retryDelay: 1000,
  });

  // Set initial conversation if provided
  useEffect(() => {
    if (initialConversationId && conversations.length > 0) {
      const conv = conversations.find(c => c.id === initialConversationId);
      if (conv) {
        setSelectedConversation(conv);
        setIsMobileListVisible(false);
      }
    }
  }, [initialConversationId, conversations]);



  // Track failed fetches to prevent infinite retries
  const failedLocationIds = useRef(new Set<number>());

  // Memoize the refresh callback to prevent re-renders in ChatPanel -> useChat
  const handleUnreadCountUpdate = useCallback(() => {
    refetch();
  }, [refetch]);

  // Fetch application details
  useEffect(() => {
    if (conversations.length === 0) return;

    const fetchApplicationDetails = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      try {
        const token = await currentUser.getIdToken();
        const details: Record<number, ApplicationDetails> = {};
        const locations: Record<number, string> = {};
        const partners: Record<number, string> = {};

        // Choose endpoint based on role
        const endpoint = role === 'manager'
          ? '/api/manager/kitchen-applications'
          : '/api/firebase/chef/kitchen-applications';

        const appsResponse = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });

        if (appsResponse.ok) {
          const allApps = await appsResponse.json();
          if (Array.isArray(allApps)) {
            for (const conv of conversations) {
              const matchingApp = allApps.find((app: ApplicationDetails) => app.id === conv.applicationId);
              if (matchingApp) {
                details[conv.applicationId] = matchingApp;

                if (matchingApp?.location?.name) {
                  locations[conv.locationId] = matchingApp.location.name;
                }

                if (role === 'manager') {
                  // Partner is chef
                  if (matchingApp?.chef?.username) {
                    partners[conv.chefId] = matchingApp.chef.username;
                  }
                  if (matchingApp?.fullName) {
                    partners[conv.chefId] = matchingApp.fullName;
                  }
                } else {
                  // Partner is manager - usually just "Manager" since we don't have manager names easily here
                  partners[conv.managerId] = "Manager";
                }
              }
            }
          }
        }

        // Fill in any missing location names (only fetch if not already known)
        const locationPromises = conversations
          .filter(conv => {
            if (locations[conv.locationId]) return false;
            if (locationNames[conv.locationId] && !locationNames[conv.locationId].startsWith('Location #')) return false;
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
                // API returns name directly at root level, not nested under location
                const locationName = locationData?.name || locationData?.location?.name;
                if (locationName) {
                  locations[conv.locationId] = locationName;
                } else {
                  locations[conv.locationId] = "Unknown Location";
                  failedLocationIds.current.add(conv.locationId);
                }
              } else {
                // Location not found - use a friendly fallback
                locations[conv.locationId] = `Location #${conv.locationId}`;
                failedLocationIds.current.add(conv.locationId);
              }
            } catch (error) {
              console.error(`Error fetching location ${conv.locationId}:`, error);
              locations[conv.locationId] = `Location #${conv.locationId}`;
              failedLocationIds.current.add(conv.locationId);
            }
          });

        await Promise.all(locationPromises);

        setApplicationDetails(prev => ({ ...prev, ...details }));
        setLocationNames(prev => ({ ...prev, ...locations }));
        setPartnerNames(prev => ({ ...prev, ...partners }));
      } catch (err) {
        console.error('Error in fetchApplicationDetails:', err);
      }
    };

    fetchApplicationDetails();
    // Removed locationNames from dependency array to prevent infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, role]);

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setIsMobileListVisible(false);
  };

  // Helpers
  const getPartnerNameLabel = (c: Conversation) => {
    if (role === 'manager') {
      const app = applicationDetails[c.applicationId];
      if (partnerNames[c.chefId]) return partnerNames[c.chefId];
      if (app?.fullName) return app.fullName;
      if (app?.chef?.username) return app.chef.username;
      if (app?.chef?.first_name) {
        return `${app.chef.first_name} ${app.chef.last_name || ''}`.trim();
      }
      return `Chef #${c.chefId}`;
    }
    return partnerNames[c.managerId] || "Manager";
  };

  const getPartnerLocation = (c: Conversation) =>
    applicationDetails[c.applicationId]?.location?.name || locationNames[c.locationId] || `Location #${c.locationId}`;

  // Compute application status for conversation thread display
  const getApplicationStatus = useCallback((c: Conversation): ApplicationStatus => {
    const app = applicationDetails[c.applicationId];
    if (!app) return 'unknown';

    const status = app.status;
    const tier = app.current_tier ?? 1;

    if (status === 'rejected') return 'rejected';
    if (status === 'inReview') return 'inReview';

    if (status === 'approved') {
      // Step 2 needs review: tier=2 and tier2_completed_at is set
      if (tier === 2 && app.tier2_completed_at) {
        return 'step2_review';
      }
      // Step 1 approved, awaiting Step 2: tier=1
      if (tier === 1) {
        return 'step1_approved';
      }
      // Fully approved: tier >= 3
      if (tier >= 3) {
        return 'fully_approved';
      }
    }

    return 'unknown';
  }, [applicationDetails]);

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
    <Card className="w-full h-full min-h-[500px] border shadow-sm overflow-hidden flex bg-background">
      {/* Sidebar List */}
      <div className={cn(
        "w-full md:w-80 border-r flex-col bg-muted/10",
        isMobileListVisible ? "flex" : "hidden md:flex"
      )}>
        <ConversationList
          conversations={filteredConversations}
          selectedId={selectedConversation?.id}
          onSelect={handleSelectConversation}
          getPartnerName={getPartnerNameLabel}
          getPartnerLocation={getPartnerLocation}
          getApplicationStatus={getApplicationStatus}
          viewerRole={role}
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
            chefId={selectedConversation.chefId}
            managerId={selectedConversation.managerId}
            locationId={selectedConversation.locationId}
            locationName={getPartnerLocation(selectedConversation)}
            chefName={role === 'chef' ? (auth.currentUser?.displayName || "Me") : getPartnerNameLabel(selectedConversation)}
            managerName={role === 'manager' ? (auth.currentUser?.displayName || "Me") : getPartnerNameLabel(selectedConversation)}
            onUnreadCountUpdate={handleUnreadCountUpdate}
            embedded={true}
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
