import { logger } from "@/lib/logger";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { getAllConversations, getLiveChatParticipants, type Conversation } from "@/services/chat-service";
import ChatPanel from './ChatPanel';
import { ConversationList } from "./ConversationList";
import { ConversationListSkeleton } from "./ConversationItemSkeleton";
import { ApplicationStatus } from "./ConversationItem";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface ApplicationDetails {
  id: number;
  location?: {
    name?: string;
    managerId?: number;
  };
  /**
   * Display name of the kitchen's manager, resolved server-side against the
   * manager profile (and falling back to the chef application's full name).
   * The chef list endpoint supplies this so chefs can tell threads apart —
   * without it every chef-side thread was labelled a generic "Manager".
   */
  managerName?: string | null;
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
  const { t } = useTranslation('chef');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [applicationDetails, setApplicationDetails] = useState<Record<number, ApplicationDetails>>({});
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [partnerNames, setPartnerNames] = useState<Record<number, string>>({});
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);
  // Whether the application-details pass has finished at least once. The list
  // used to hide every conversation until its application arrived, which made
  // the sidebar look empty (then pop in) even though the data was already here.
  const [hasResolvedDetails, setHasResolvedDetails] = useState(false);

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

  /**
   * Reconcile each conversation against who still has an account.
   *
   * The delete-time flag on the conversation document only covers deletions that
   * happened after it shipped, so every thread orphaned earlier still looked
   * live. That is what let a manager keep opening and replying to a deleted
   * chef's conversation. This asks Postgres — the authority — which participants
   * still exist, and treats a missing one as an ended thread.
   *
   * Runs independently of the application-details fetch on purpose: a deleted
   * chef's application disappears from the manager's list entirely, so the app
   * fetch can never be the thing that reveals the deletion.
   */
  const [deletedParticipantIds, setDeletedParticipantIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (conversations.length === 0) return;

    let cancelled = false;

    const reconcileParticipants = async () => {
      const participantIds = conversations.flatMap((c) => [c.chefId, c.managerId]);
      const live = await getLiveChatParticipants(participantIds);
      // null means "could not tell" — leave the threads alone rather than
      // disabling every chat because one request failed.
      if (cancelled || !live) return;
      setDeletedParticipantIds(
        new Set(participantIds.filter((id) => !live.has(id))),
      );
    };

    reconcileParticipants();
    return () => {
      cancelled = true;
    };
  }, [conversations]);

  /** True when one participant no longer has an account. */
  const isConversationUnavailable = useCallback(
    (c: Conversation) =>
      c.unavailable === true ||
      deletedParticipantIds.has(c.chefId) ||
      deletedParticipantIds.has(c.managerId),
    [deletedParticipantIds],
  );

  /** Which side is gone, preferring the server's stamp when present. */
  const getUnavailableRole = useCallback(
    (c: Conversation): 'chef' | 'manager' | 'admin' | 'user' | undefined => {
      if (c.unavailableRole === 'chef' || c.unavailableRole === 'manager') return c.unavailableRole;
      if (deletedParticipantIds.has(c.chefId)) return 'chef';
      if (deletedParticipantIds.has(c.managerId)) return 'manager';
      return c.unavailableRole;
    },
    [deletedParticipantIds],
  );

  // Fetch application details
  useEffect(() => {
    if (conversations.length === 0) {
      setHasResolvedDetails(true);
      return;
    }

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
                } else if (matchingApp?.managerName) {
                  // Partner is the manager. The server resolves their real name
                  // for us; a chef working across several kitchens needs to see
                  // *which* manager each thread belongs to, so only fall back to
                  // the generic label when the name genuinely isn't available.
                  partners[conv.managerId] = matchingApp.managerName;
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
              logger.error(`Error fetching location ${conv.locationId}:`, error);
              locations[conv.locationId] = `Location #${conv.locationId}`;
              failedLocationIds.current.add(conv.locationId);
            }
          });

        await Promise.all(locationPromises);

        setApplicationDetails(prev => ({ ...prev, ...details }));
        setLocationNames(prev => ({ ...prev, ...locations }));
        setPartnerNames(prev => ({ ...prev, ...partners }));
      } catch (err) {
        logger.error('Error in fetchApplicationDetails:', err);
      } finally {
        // Even on failure, stop showing skeletons — a list of real rows
        // degrading to id fallbacks beats an indefinite loading state.
        setHasResolvedDetails(true);
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
    // Chef's view. Prefer the manager's real name from the application payload,
    // then whatever the resolver already stored. Only when neither exists do we
    // fall back — and then to the kitchen, which at least disambiguates two
    // threads, rather than a flat "Manager" that tells the chef nothing.
    const app = applicationDetails[c.applicationId];
    return (
      partnerNames[c.managerId] ||
      app?.managerName ||
      getPartnerLocation(c) ||
      t("chatManager")
    );
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
      // Kitchen coordination submitted, awaiting manager review
      if (tier === 2 && app.tier2_completed_at) {
        return 'step2_review';
      }
      // Request to apply approved; kitchen coordination docs still needed (chat open)
      if (tier === 1 || (tier === 2 && !app.tier2_completed_at)) {
        return 'step1_approved';
      }
      // Manager approved kitchen coordination — ready to book
      if (tier >= 3) {
        return 'fully_approved';
      }
    }

    return 'unknown';
  }, [applicationDetails]);

  // Whether the list itself is still waiting on data. Details resolving is a
  // second, softer phase — the sidebar shows skeleton rows for both so the
  // layout never collapses to a bare spinner or an empty box.
  const isListLoading = isLoading || !hasResolvedDetails;

  if (isLoading) {
    // Skeleton shaped like the real two-pane layout, so the panel settles in
    // place rather than flashing a centred spinner and reflowing.
    return (
      <Card className="w-full h-full min-h-[500px] border shadow-sm overflow-hidden flex bg-background">
        <div className="w-full md:w-80 border-r bg-muted/10 flex flex-col">
          <div className="p-4 border-b space-y-4">
            <div className="h-6 w-28 rounded bg-muted animate-pulse" />
            <div className="h-9 w-full rounded-md bg-muted/70 animate-pulse" />
          </div>
          <div className="p-3">
            <ConversationListSkeleton count={5} />
          </div>
        </div>
        <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-4 bg-background">
          <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
          <div className="h-4 w-40 rounded bg-muted animate-pulse" />
          <div className="h-3 w-56 rounded bg-muted/70 animate-pulse" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-2" />
        <p className="text-muted-foreground">{t("chatFailedToLoad")}</p>
        <Button onClick={() => refetch()} variant="link">{t("chatRetry")}</Button>
      </div>
    );
  }

  // Show every conversation the user actually has. Previously rows were hidden
  // until their application details resolved, so a chef opening Messages saw an
  // empty sidebar that filled in late. Rows now render immediately and their
  // labels update as the details land; partner-name/location getters already
  // fall back gracefully, so nothing renders blank.
  const visibleConversations = conversations;

  return (
    <Card className="w-full h-full min-h-[500px] border shadow-sm overflow-hidden flex bg-background">
      {/* Sidebar List */}
      <div className={cn(
        "w-full md:w-80 border-r flex-col bg-muted/10",
        isMobileListVisible ? "flex" : "hidden md:flex"
      )}>
        <ConversationList
          conversations={visibleConversations}
          selectedId={selectedConversation?.id}
          onSelect={handleSelectConversation}
          getPartnerName={getPartnerNameLabel}
          getPartnerLocation={getPartnerLocation}
          getApplicationStatus={getApplicationStatus}
          viewerRole={role}
          isLoading={isListLoading}
          isConversationUnavailable={isConversationUnavailable}
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
            chefName={role === 'chef' ? (auth.currentUser?.displayName || t("chatMe")) : getPartnerNameLabel(selectedConversation)}
            managerName={role === 'manager' ? (auth.currentUser?.displayName || t("chatMe")) : getPartnerNameLabel(selectedConversation)}
            // True when a participant's account is gone — either flagged at
            // delete time or detected by reconciling against Postgres. The
            // history stays readable; the composer is replaced by a notice.
            unavailable={isConversationUnavailable(selectedConversation)}
            unavailableRole={getUnavailableRole(selectedConversation)}
            onUnreadCountUpdate={handleUnreadCountUpdate}
            embedded={true}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h3 className="font-semibold text-lg">{t("chatNoChatSelected")}</h3>
            <p className="text-sm">{t("chatSelectConversation")}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
