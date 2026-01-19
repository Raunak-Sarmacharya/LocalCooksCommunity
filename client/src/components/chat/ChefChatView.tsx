import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Loader2, AlertCircle, User, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { auth } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';
import { getAllConversations, type Conversation } from '@/services/chat-service';
import ChatPanel from './ChatPanel';
import { useToast } from '@/hooks/use-toast';

interface ChefChatViewProps {
  chefId: number;
  embedded?: boolean;
  showHeader?: boolean;
  hideIfEmpty?: boolean;
}

export default function ChefChatView({
  chefId,
  embedded = false,
  showHeader = false,
  hideIfEmpty = false
}: ChefChatViewProps) {
  const { toast } = useToast();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [applicationDetails, setApplicationDetails] = useState<Record<number, any>>({});
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [managerNames, setManagerNames] = useState<Record<number, string>>({});

  // Fetch location name for selected conversation when dialog opens
  const { data: selectedLocationName } = useQuery({
    queryKey: ['location-name', selectedConversation?.locationId],
    queryFn: async () => {
      if (!selectedConversation?.locationId) return null;

      // First check if we already have it
      if (locationNames[selectedConversation.locationId]) {
        return locationNames[selectedConversation.locationId];
      }

      // Check application details
      const app = applicationDetails[selectedConversation.applicationId];
      if (app?.location?.name) {
        // Update locationNames state
        setLocationNames(prev => ({
          ...prev,
          [selectedConversation.locationId]: app.location.name
        }));
        return app.location.name;
      }

      // Fetch from API
      try {
        const response = await fetch(`/api/public/locations/${selectedConversation.locationId}/details`, {
          credentials: 'include',
        });
        if (response.ok) {
          const locationData = await response.json();
          const name = locationData?.name || null;
          if (name) {
            // Update locationNames state
            setLocationNames(prev => ({
              ...prev,
              [selectedConversation.locationId]: name
            }));
          }
          return name;
        }
      } catch (error) {
        console.error(`Error fetching location ${selectedConversation.locationId}:`, error);
      }

      return null;
    },
    enabled: !!selectedConversation?.locationId && showChatDialog,
  });

  // Fetch all conversations for this chef
  const { data: conversations = [], isLoading, error, refetch } = useQuery({
    queryKey: ['chef-conversations', chefId],
    queryFn: async () => {
      if (!chefId) return [];
      return await getAllConversations(chefId, 'chef');
    },
    enabled: !!chefId,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch application details and location names for each conversation
  useEffect(() => {
    if (conversations.length === 0) return;

    const fetchApplicationDetails = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const token = await currentUser.getIdToken();
      const details: Record<number, any> = {};
      const locations: Record<number, string> = {};
      const managers: Record<number, string> = {};

      try {
        // Fetch all chef's applications at once
        const appsResponse = await fetch('/api/firebase/chef/kitchen-applications', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        if (appsResponse.ok) {
          const allApps = await appsResponse.json();

          // Match conversations with applications
          for (const conv of conversations) {
            const matchingApp = allApps.find((app: any) => app.id === conv.applicationId);
            if (matchingApp) {
              details[conv.applicationId] = matchingApp;

              // Use location from application if available
              if (matchingApp?.location?.name) {
                locations[conv.locationId] = matchingApp.location.name;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching chef applications:', error);
      }

      // Fill in any missing location names
      const locationPromises = conversations
        .filter(conv => !locations[conv.locationId])
        .map(async (conv) => {
          try {
            const locationResponse = await fetch(`/api/public/locations/${conv.locationId}/details`, {
              credentials: 'include',
            });
            if (locationResponse.ok) {
              const locationData = await locationResponse.json();
              if (locationData?.location?.name) {
                locations[conv.locationId] = locationData.location.name;
              }
            }
          } catch (error) {
            console.error(`Error fetching location ${conv.locationId}:`, error);
          }
        });

      await Promise.all(locationPromises);

      setApplicationDetails(details);
      setLocationNames(locations);
      setManagerNames(managers);
    };

    fetchApplicationDetails();
  }, [conversations]);

  const openChat = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setShowChatDialog(true);
  };

  const closeChat = () => {
    setShowChatDialog(false);
    setSelectedConversation(null);
    // Refetch conversations to update unread counts
    refetch();
  };

  const handleUnreadCountUpdate = () => {
    // Immediately refetch conversations when unread counts change
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#208D80]" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">Failed to load conversations. Please try again.</p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const filteredConversations = conversations.filter((conversation) => {
    const app = applicationDetails[conversation.applicationId];
    // Only show chats for applications that have completed tier 1
    return app?.tier1_completed_at != null;
  });

  if (filteredConversations.length === 0) {
    if (hideIfEmpty) return null;

    return (
      <Card>
        <CardContent className="p-12 text-center">
          <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Messages Yet</h3>
          <p className="text-gray-600">
            When you apply to kitchens and managers approve your applications, you'll be able to chat with them here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {(showHeader || !embedded) && (
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Messages</h2>
            <p className="text-gray-600">Chat with managers about your applications</p>
          </div>
        )}

        <div className="grid gap-4">
          {filteredConversations
            .map((conversation) => {
              const app = applicationDetails[conversation.applicationId];
              const unreadCount = conversation.unreadChefCount || 0;
              const lastMessageDate = conversation.lastMessageAt instanceof Date
                ? conversation.lastMessageAt
                : conversation.lastMessageAt instanceof Timestamp
                  ? conversation.lastMessageAt.toDate()
                  : new Date();

              return (
                <Card
                  key={conversation.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openChat(conversation)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Building2 className="h-5 w-5 text-[#208D80] flex-shrink-0" />
                          <h3 className="font-semibold text-gray-900 truncate">
                            {app?.location?.name || locationNames[conversation.locationId] || `Location #${conversation.locationId}`}
                          </h3>
                          {unreadCount > 0 && (
                            <Badge variant="destructive" className="ml-2">
                              {unreadCount}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                          <User className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">
                            {managerNames[conversation.managerId] || 'Manager'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          Last message: {lastMessageDate.toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openChat(conversation);
                        }}
                      >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Open
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      </div>

      {/* Chat Dialog */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogTitle className="sr-only">
            {selectedConversation
              ? `Chat with ${applicationDetails[selectedConversation.applicationId]?.location?.name || 'Manager'}`
              : 'Chat Conversation'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Chat conversation about kitchen application
          </DialogDescription>
          {selectedConversation && (
            <ChatPanel
              conversationId={selectedConversation.id}
              applicationId={selectedConversation.applicationId}
              chefId={chefId}
              managerId={selectedConversation.managerId}
              locationId={selectedConversation.locationId}
              locationName={
                applicationDetails[selectedConversation.applicationId]?.location?.name ||
                locationNames[selectedConversation.locationId] ||
                selectedLocationName ||
                "Unknown Location"
              }
              chefName={auth.currentUser?.displayName || auth.currentUser?.email || `Chef #${chefId}`}
              managerName={managerNames[selectedConversation.managerId] || `Manager #${selectedConversation.managerId}`}
              onClose={closeChat}
              onUnreadCountUpdate={handleUnreadCountUpdate}
              embedded={true}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
