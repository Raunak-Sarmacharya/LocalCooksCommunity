import { logger } from "@/lib/logger";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { getAllConversations, getLiveChatParticipants, setConversationArchived, resolveTourConversation, type Conversation } from "@/services/chat-service";
import { useToast } from "@/hooks/use-toast";
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
  initialDraft?: string;
  userId: number;
  role: 'chef' | 'manager';
  initialConversationId?: string | null;
  initialTourId?: string | null;
  onNavigate?: (view: string) => void;
  chefHasApplications?: boolean;
  managerHasKitchen?: boolean;
  /**
   * Hide the conversation sidebar. Set when the chat was opened *for* one
   * specific application — a row action on the chef-application table. The
   * viewer asked to see that chef, so a list of every other thread is noise
   * that also invites them to navigate away from the one they came for.
   */
  hideConversationList?: boolean;
}
const EMPTY_CONVERSATIONS: Conversation[] = [];

export default function UnifiedChatView({ userId, role, initialConversationId, initialTourId, initialDraft, onNavigate, chefHasApplications = false, managerHasKitchen = true, hideConversationList = false }: UnifiedChatViewProps) {
  const { t } = useTranslation('chef');
  const { toast } = useToast();
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [applicationDetails, setApplicationDetails] = useState<Record<number, ApplicationDetails>>({});
  const [locationNames] = useState<Record<number, string>>({});
  const [partnerNames] = useState<Record<number, string>>({});
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);
  // Whether the application-details pass has finished at least once. The list
  // used to hide every conversation until its application arrived, which made
  // the sidebar look empty (then pop in) even though the data was already here.
  const [hasResolvedDetails, setHasResolvedDetails] = useState(false);
  const [applicationContextError, setApplicationContextError] = useState('');

  // Fetch all conversations
  const { data: conversations = EMPTY_CONVERSATIONS, isLoading, error, refetch } = useQuery({
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

  const exactTour = useQuery({
    queryKey: ['chat-exact-tour', initialTourId, initialConversationId],
    enabled: !!initialTourId,
    queryFn: async () => {
      if (!/^\d+$/.test(initialTourId || '')) throw Error('Invalid tour context');
      const result = await resolveTourConversation(Number(initialTourId));
      if (!initialConversationId || result.conversationId !== initialConversationId)
        throw Error('This tour link no longer matches its shared conversation. Reopen messaging from My Tours.');
      return result;
    }, retry: false,
  });
  const appliedContext = useRef<string | null>(null);
  const contextKey = initialConversationId + ':' + (initialTourId || '');
  useEffect(() => {
    if (initialTourId && !exactTour.data) { setSelectedConversation(null); return; }
    if (appliedContext.current !== contextKey) {
      const conv = conversations.find(c => c.id === initialConversationId);
      setSelectedConversation(conv || null);
      if (conv) { setIsMobileListVisible(false); appliedContext.current = contextKey; }
    } else {
      setSelectedConversation(current => conversations.find(c => c.id === current?.id) || null);
    }
  }, [initialConversationId, initialTourId, exactTour.data, conversations, contextKey]);

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
  const [participantStatus, setParticipantStatus] = useState<{ checked: Set<number>; live: Set<number> } | null>(null);
  /**
   * Whether the reconciliation below has finished. Until it has, we cannot say
   * whether a participant exists, and the conversation's own `unavailable` flag
   * is not trustworthy on its own — it is stamped at delete time and several
   * threads carry a stale `true` while their chef is perfectly alive. Rendering
   * the thread before the answer lands flashed "this chef's account was deleted"
   * on every open and then corrected itself.
   */
  const [participantsResolved, setParticipantsResolved] = useState(false);

  useEffect(() => {
    if (conversations.length === 0) return;

    let cancelled = false;

    const reconcileParticipants = async () => {
      const participantIds = conversations.flatMap((c) => [c.chefId, c.managerId]);
      let live: Set<number> | null = null;
      try {
        live = await getLiveChatParticipants(participantIds);
      } catch (error) {
        logger.error('Chat participant reconciliation failed:', error);
      }
      // null means "could not tell" — leave the threads alone rather than
      // disabling every chat because one request failed.
      if (cancelled) return;
      if (live) {
        setParticipantStatus({ checked: new Set(participantIds), live });
        setDeletedParticipantIds(
          new Set(participantIds.filter((id) => !live.has(id))),
        );
      }
      // Resolved either way: on a failed lookup the threads fall back to the
      // server's delete-time stamp instead of skeletoning forever.
      setParticipantsResolved(true);
    };

    reconcileParticipants();
    return () => {
      cancelled = true;
    };
  }, [conversations]);

  /** True when one participant no longer has an account. */
  const isConversationUnavailable = useCallback(
    (c: Conversation) =>
      participantStatus?.checked.has(c.chefId) && participantStatus.checked.has(c.managerId)
        ? !participantStatus.live.has(c.chefId) || !participantStatus.live.has(c.managerId)
        : c.unavailable === true || deletedParticipantIds.has(c.chefId) || deletedParticipantIds.has(c.managerId),
    [deletedParticipantIds, participantStatus],
  );

  /** Which side is gone, preferring the server's stamp when present. */
  const getUnavailableRole = useCallback(
    (c: Conversation): 'chef' | 'manager' | 'admin' | 'user' | undefined => {
      if (deletedParticipantIds.has(c.chefId)) return 'chef';
      if (deletedParticipantIds.has(c.managerId)) return 'manager';
      if (participantStatus?.live.has(c.chefId) && participantStatus?.live.has(c.managerId)) return undefined;
      if (c.unavailableRole === 'chef' || c.unavailableRole === 'manager') return c.unavailableRole;
      return c.unavailableRole;
    },
    [deletedParticipantIds, participantStatus],
  );

  // Optional application details control only application panels and booking.
  useEffect(() => {
    let active = true;
    if (!conversations.some(c => c.applicationId)) { setApplicationDetails({}); setApplicationContextError(''); setHasResolvedDetails(true); return; }
    const load = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw Error('Not authenticated');
        const response = await fetch(role === 'manager' ? '/api/manager/kitchen-applications' : '/api/firebase/chef/kitchen-applications', {
          credentials: 'include', headers: { Authorization: 'Bearer ' + token } });
        if (!response.ok) throw Error('Could not load application context');
        const apps = await response.json(), details: Record<number, ApplicationDetails> = {};
        for (const conv of conversations) {
          const app = Array.isArray(apps) ? apps.find(app => app.id === conv.applicationId && app.status === 'approved') : null;
          if (app) details[app.id] = app;
        }
        if (active) { setApplicationDetails(details); setApplicationContextError(''); }
      } catch (error) { if (active) { setApplicationDetails({}); setApplicationContextError('Application details could not be loaded. Messaging remains available.'); logger.error('Optional application context unavailable:', error); } }
      finally { if (active) setHasResolvedDetails(true); }
    };
    void load(); return () => { active = false; };
  }, [conversations, role]);

  const handleSelectConversation = (conversation: Conversation) => {
    appliedContext.current = contextKey;
    setSelectedConversation(conversation);
    setIsMobileListVisible(false);
  };

  const handleToggleArchive = async (conversation: Conversation, archived: boolean) => {
    setArchiveBusyId(conversation.id);
    try {
      await setConversationArchived(conversation.id, role, archived);
      await refetch();
    } catch (error) {
      logger.error('Could not update chat archive:', error);
      toast({ title: t('chatArchiveFailed', 'Could not update this chat'), variant: 'destructive' });
    } finally {
      setArchiveBusyId(null);
    }
  };

  // Helpers
  const getPartnerNameLabel = (c: Conversation) => {
    if (role === 'manager') {
      if (c.chefName) return c.chefName;
      const app = applicationDetails[c.applicationId ?? 0];
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
    const app = applicationDetails[c.applicationId ?? 0];
    return (
      c.managerName || partnerNames[c.managerId] ||
      app?.managerName ||
      getPartnerLocation(c) ||
      t("chatManager")
    );
  };

  const getPartnerLocation = (c: Conversation) =>
    c.locationName || applicationDetails[c.applicationId ?? 0]?.location?.name || locationNames[c.locationId] || `Location #${c.locationId}`;

  // Compute application status for conversation thread display
  const getApplicationStatus = useCallback((c: Conversation): ApplicationStatus => {
    const app = applicationDetails[c.applicationId ?? 0];
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
        {!hideConversationList && (
          <div className="w-full md:w-80 border-r bg-muted/10 flex flex-col">
            <div className="p-4 border-b space-y-4">
              <div className="h-6 w-28 rounded bg-muted animate-pulse" />
              <div className="h-9 w-full rounded-md bg-muted/70 animate-pulse" />
            </div>
            <div className="p-3">
              <ConversationListSkeleton count={5} />
            </div>
          </div>
        )}
        <div className={cn(
          "flex-1 flex-col items-center justify-center gap-4 bg-background",
          hideConversationList ? "flex" : "hidden md:flex",
        )}>
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

  if (initialTourId && exactTour.isPending) return <div role="status" className="p-8">Opening tour messaging…</div>;
  if (exactTour.error || (initialConversationId && !conversations.some(c => c.id === initialConversationId))) {
    return <div role="alert" className="p-8 space-y-3">
      <p>{exactTour.error?.message || 'This conversation is unavailable for your current account. Reopen messaging from your tour or application.'}</p>
      <Button onClick={() => { void refetch(); if (initialTourId) void exactTour.refetch(); }}>Retry</Button>
    </div>;
  }

  // Show every conversation the user actually has. Previously rows were hidden
  // until their application details resolved, so a chef opening Messages saw an
  // empty sidebar that filled in late. Rows now render immediately and their
  // labels update as the details land; partner-name/location getters already
  // fall back gracefully, so nothing renders blank.
  const visibleConversations = conversations;
  const showEmptyInbox = conversations.length === 0 && !isListLoading;

  return (
    <Card className={cn("w-full h-full border shadow-sm overflow-hidden flex bg-background", hideConversationList ? "min-h-0" : "min-h-[500px]")}>
      {/* Sidebar List */}
      {!hideConversationList && (
        <div className={cn(
          "w-full md:w-80 border-r flex-col bg-muted/10",
          isMobileListVisible && !showEmptyInbox ? "flex" : "hidden md:flex"
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
            onToggleArchive={handleToggleArchive}
            archiveBusyId={archiveBusyId}
          />
        </div>
      )}

      {/* Main Chat Area */}
      <div className={cn(
        "min-h-0 min-w-0 flex-1 flex flex-col bg-background",
        hideConversationList || showEmptyInbox || !isMobileListVisible ? "flex" : "hidden md:flex"
      )}>
        {applicationContextError && <div role="alert" className="p-3 text-sm">{applicationContextError} <Button variant="link" onClick={() => void refetch()}>Retry</Button></div>}
        {selectedConversation ? (
          <ChatPanel
            initialDraft={initialDraft}
            key={selectedConversation.id}
            conversationId={selectedConversation.id}
            bookingId={initialConversationId === selectedConversation.id && /^\d+$/.test(new URLSearchParams(window.location.search).get('booking') || '') ? Number(new URLSearchParams(window.location.search).get('booking')) : undefined}
            applicationId={applicationDetails[selectedConversation.applicationId ?? 0]?.status === 'approved' ? selectedConversation.applicationId : undefined}
            canBook={applicationDetails[selectedConversation.applicationId ?? 0]?.status === 'approved' && (applicationDetails[selectedConversation.applicationId ?? 0]?.current_tier ?? 1) >= 3 && !!applicationDetails[selectedConversation.applicationId ?? 0]?.tier2_completed_at}
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
            // Hold the thread behind a skeleton until we actually know whether
            // the other participant still has an account.
            availabilityPending={!participantsResolved}
            onUnreadCountUpdate={handleUnreadCountUpdate}
            embedded={true}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessageCircle className="size-6" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">{t(conversations.length ? "chatNoChatSelected" : role === "manager" ? "chatManagerEmptyTitle" : "chatChefEmptyTitle")}</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{t(conversations.length ? "chatSelectConversation" : role === "manager" ? managerHasKitchen ? "chatManagerEmptyBody" : "chatManagerNoKitchenBody" : chefHasApplications ? "chatChefAppliedEmptyBody" : "chatChefEmptyBody")}</p>
            {!conversations.length && onNavigate && <Button className="mt-5 rounded-full" onClick={() => onNavigate(role === "manager" ? managerHasKitchen ? "applications" : "kitchens" : chefHasApplications ? "kitchen-requests" : "discover-kitchens")}>{t(role === "manager" ? managerHasKitchen ? "chatManagerEmptyAction" : "chatManagerNoKitchenAction" : chefHasApplications ? "chatChefAppliedEmptyAction" : "chatChefEmptyAction")}</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}
