import { logger } from "@/lib/logger";
import { normalizeChatSystemMessage } from "@/lib/chat-system-message";
import { useTranslation } from "react-i18next";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { CalendarCheck, CalendarX, CalendarClock, ChevronLeft } from "lucide-react";
import type { ChatContext, ChatContextEvent } from "@/services/chat-service";
import { itemWhen } from "./chat-context-format";
import { ContextItemRow } from "./ChatContextPanel";
import { X, Info, FileText, AlertCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import FacilityDocumentsPanel from './FacilityDocumentsPanel';
import { MessageThreadSkeleton } from './ConversationItemSkeleton';
import { useChat } from "@/hooks/use-chat";
import { auth } from '@/lib/firebase';
import { uploadChatFile } from "@/services/chat-service";
import { Timestamp } from "firebase/firestore";

// Authenticated file link component for chat attachments
function AuthenticatedFileLink({ url, fileName, className, conversationId }: { url: string | null | undefined; fileName?: string; className?: string; conversationId: string }) {
  const [isLoading, setIsLoading] = useState(false), [error, setError] = useState('');
  const open = async () => {
    if (!url) return;
    setIsLoading(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw Error('Sign in to open this attachment');
      const response = await fetch(`/api/files/chat/${encodeURIComponent(conversationId)}/file?url=${encodeURIComponent(url)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw Error('This attachment is unavailable for your current account. Please retry.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = objectUrl; link.download = fileName || 'Attachment'; link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) { setError((error as Error).message); }
    finally { setIsLoading(false); }
  };
  
  if (!url) return null;
  
  return (
    <div><button type="button" disabled={isLoading} onClick={() => void open()}
      className={className}
    >
      <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center group-hover:bg-primary/20">
        {isLoading ? (
          <LoadingSpinner size="sm" />
        ) : (
          <FileText className="h-4 w-4 text-primary" />
        )}
      </div>
      <span className="text-xs underline truncate max-w-[150px]">
        {fileName || 'Attached File'}
      </span>
    </button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>
  );
}

// Shadcn Chat Components
import { ChatBubble } from "@/components/ui/chat/chat-bubble";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { ChatMessageList } from "@/components/ui/chat/chat-message-list";
import { ChatAvatar } from "@/components/ui/chat/chat-avatar";
import { Separator } from "@/components/ui/separator";

interface ChatPanelProps {
  initialDraft?: string;
  conversationId: string;
  applicationId?: number;
  canBook?: boolean;
  chefId: number;
  managerId: number;
  locationId: number;
  locationName?: string;
  chefName?: string;
  managerName?: string;
  /** Label for the Local Cooks team, shown on admin messages. Defaults to "Local Cooks". */
  adminName?: string;
  /**
   * Set to 'admin' when the Local Cooks team is the viewer. Without it the
   * viewer matches neither chefId nor managerId and the panel cannot send or
   * mark anything read — see the note on `useChat`'s `viewerRole`.
   */
  viewerRole?: 'admin';
  /**
   * True when one participant's account has been deleted, so the thread is kept
   * for its history but can accept no new messages. Rendered as a read-only
   * notice in place of the composer, rather than a disabled box the user would
   * keep trying to type into.
   */
  unavailable?: boolean;
  /** Which side is gone — lets the notice name the right party. */
  unavailableRole?: 'chef' | 'manager' | 'admin' | 'user';
  /**
   * True while we are still verifying whether the other participant's account
   * exists. Rendering the thread before that answer arrives showed "this chef's
   * account was deleted" on open and then replaced it with the real
   * conversation, so the thread and composer are held behind a skeleton until
   * the question is actually settled.
   */
  availabilityPending?: boolean;
  onClose?: () => void;
  onUnreadCountUpdate?: () => void;
  embedded?: boolean;
  bookingId?: number;
  /** What the thread is about: woven into the timeline and pinned on smaller screens. */
  context?: ChatContext;
  /** Kitchen photo for the chef's side of the header. */
  partnerImage?: string | null;
  /** Phones: back to the inbox. */
  onBack?: () => void;
}

export default function ChatPanel({
  initialDraft,
  conversationId,
  applicationId,
  canBook = false,
  chefId,
  managerId,
  locationId,
  locationName,
  chefName,
  managerName,
  adminName,
  viewerRole,
  unavailable = false,
  unavailableRole,
  availabilityPending = false,
  onClose,
  onUnreadCountUpdate,
  embedded = false,
  bookingId,
  context,
  partnerImage,
  onBack,
}: ChatPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    if (!panelRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting && entry.intersectionRatio > 0));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [attachedFacilityDocuments, setAttachedFacilityDocuments] = useState<Array<{
    name: string;
    url: string;
  }>>([]);

  const { t, i18n } = useTranslation("chef");
  const {
    messages,
    isLoading,
    isSending,
    currentUserId,
    handleSendMessage,
    isManager,
    isAdmin,
    role,
    error,
  } = useChat({
    conversationId,
    chefId,
    managerId,
    onUnreadCountUpdate,
    viewerRole,
    isVisible: isVisible && !availabilityPending,
    bookingId,
  });

  const localCooksName = adminName || t("chatLocalCooks", "Local Cooks");

  const onSend = async (content: string, files?: File[]) => {
    // Guarded here as well as in the UI: the composer is the only caller today,
    // but a send into a thread whose other participant no longer exists would
    // create a message nobody can ever read.
    if (unavailable) return;
    try {
      // Finish every upload before publishing any messages. A rejected file
      // should leave the entire draft in the composer for correction or retry.
      const uploadedFiles = await Promise.all((files || []).map(async (file) => ({
        name: file.name,
        url: await uploadChatFile(conversationId, file),
      })));

      if (attachedFacilityDocuments.length > 0) {
        for (const doc of attachedFacilityDocuments) {
          // Send as a file message with URL
          await handleSendMessage('', { name: doc.name, url: doc.url });
        }
        setAttachedFacilityDocuments([]);
      }

      for (const file of uploadedFiles) await handleSendMessage('', file);
      if (content.trim()) await handleSendMessage(content);
    } catch (error) {
      logger.error('Failed to send message:', error);
      throw error;
    }
  };

  const handleAttachFacilityDocuments = (documents: Array<{ name: string; url: string }>) => {
    setAttachedFacilityDocuments(prev => [...prev, ...documents]);
  };

  const removeAttachedDocument = (index: number) => {
    setAttachedFacilityDocuments(prev => prev.filter((_, i) => i !== index));
  };


  // ... scroll effect kept same ...
  // Scroll to bottom when messages change
  // Open at the newest message straight away; later messages glide in.
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (messages.length === 0 && !context?.events.length) return;
    messagesEndRef.current?.scrollIntoView({ behavior: scrolledOnce.current ? 'smooth' : 'auto', block: 'end' });
    scrolledOnce.current = true;
  }, [messages, context]);

  // ... helpers getPartnerName/getPartnerLabel kept same ...
  // From the admin's seat this is the chef's conversation, exactly as it is for
  // the manager — an admin does not sit opposite themselves.
  const viewerSeesChef = isManager || isAdmin;
  const getPartnerName = () => {
    if (viewerSeesChef) return chefName || t(isManager ? "chatCustomer" : "chatChef");
    return managerName || t("chatManager");
  };

  const getPartnerLabel = () => {
    if (viewerSeesChef) return t(isManager ? "chatCustomer" : "chatChef");
    return t("chatManager");
  }

  // ... renderHeader kept same ...
  // Chef side leads with the kitchen (that's what they book); the kitchen side leads with the customer.
  const headerTitle = viewerSeesChef ? getPartnerName() : locationName || getPartnerName();
  const headerSub = viewerSeesChef ? locationName || getPartnerLabel() : managerName && locationName ? t("chatAtKitchen", { name: managerName }) : getPartnerLabel();
  const nextUp = context?.upcoming[0];
  const renderHeader = () => (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" className="-ml-2 shrink-0 md:hidden" onClick={onBack} aria-label={t("chatBackToInbox")}>
              <ChevronLeft className="size-5" />
            </Button>
          )}
          <ChatAvatar src={!viewerSeesChef ? partnerImage ?? undefined : undefined} fallback={headerTitle[0]} className={!viewerSeesChef ? "rounded-lg" : undefined} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold text-foreground">{headerTitle}</span>
            <span className="truncate text-xs text-muted-foreground">{headerSub}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {error && (
            <div className="mr-2 flex items-center text-sm text-destructive">
              <Info className="mr-1 h-4 w-4" />
              <span>{t("chatConnectionError")}</span>
            </div>
          )}
          {onClose && (
            <>
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-destructive/10 hover:text-destructive">
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      {/* Wide screens show the side panel; smaller ones pin the next thing here. */}
      {nextUp && <div className="border-t bg-muted/30 px-4 wide:hidden"><ContextItemRow item={nextUp} compact /></div>}
    </div>
  );

  // ... renderMessages kept same generally ...
  const sentAt = (message: { createdAt?: unknown }) => message.createdAt instanceof Date ? message.createdAt
    : message.createdAt instanceof Timestamp ? message.createdAt.toDate() : null;
  const sameDay = (a: Date | null, b: Date) => !!a && a.toDateString() === b.toDateString();
  const dayLabel = (at: Date) => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    return sameDay(new Date(), at) ? t("chatToday") : sameDay(yesterday, at) ? t("chatYesterday")
      : new Intl.DateTimeFormat(i18n.language, { weekday: "short", month: "short", day: "numeric" }).format(at);
  };

  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const eventIcon = (event: ChatContextEvent) => event.action === "cancelled" ? CalendarX : event.action === "requested" ? CalendarClock : CalendarCheck;
  const renderEvent = (event: ChatContextEvent) => {
    const Icon = eventIcon(event);
    return (
      <li key={`ev-${event.kind}-${event.id}-${event.action}`} className="my-3 flex justify-center">
        <span className="flex max-w-[92%] items-center gap-2.5 rounded-xl bg-background px-3 py-2 text-[13px] shadow-[inset_0_0_0_1px_hsl(var(--border))]">
          <Icon className={event.action === "cancelled" ? "size-4 shrink-0 text-muted-foreground" : "size-4 shrink-0 text-emerald-700"} aria-hidden />
          <span className="min-w-0">{t(`chatEvent_${event.kind}_${event.action}`)} · {itemWhen(event.item, i18n.language, context?.kitchen.timezone)}</span>
          <Link href={event.item.href} className="shrink-0 font-semibold underline underline-offset-4">{t("chatDetails")}</Link>
        </span>
      </li>
    );
  };

  const renderMessages = () => {
    // Booking, tour and storage events from the time this thread's messages start (or the last 60 days for a new one).
    const firstAt = messages.length ? sentAt(messages[0]) : null;
    const since = firstAt ? firstAt.getTime() : Date.now() - 60 * 86_400_000;
    type Entry = { type: "message"; message: typeof messages[number]; at: Date | null } | { type: "event"; event: ChatContextEvent; at: Date };
    const entries: Entry[] = [
      ...messages.map((message) => ({ type: "message" as const, message, at: sentAt(message) })),
      ...(context?.events ?? []).filter((event) => new Date(event.at).getTime() >= since).map((event) => ({ type: "event" as const, event, at: new Date(event.at) })),
    ].sort((x, y) => (x.at?.getTime() ?? Infinity) - (y.at?.getTime() ?? Infinity));

    if (entries.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-8 text-sm text-muted-foreground">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Info className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <p>{t("chatNoMessages")}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t("chatStartConversation")}</p>
        </div>
      );
    }

    const lastSentIndex = entries.reduce((found, entry, index) => entry.type === "message" && entry.message.senderId === currentUserId && entry.message.senderRole !== "system" ? index : found, -1);
    const sameSender = (x?: Entry, y?: Entry) => x?.type === "message" && y?.type === "message" && x.message.senderRole !== "system" && y.message.senderRole !== "system"
      && x.message.senderId === y.message.senderId && x.message.senderRole === y.message.senderRole
      && !!x.at && !!y.at && sameDay(x.at, y.at) && Math.abs(y.at.getTime() - x.at.getTime()) < 5 * 60_000;

    const out: JSX.Element[] = [];
    let index = 0;
    while (index < entries.length) {
      const entry = entries[index];
      const previous = entries[index - 1];
      // Several updates in a row (a busy customer) collapse to the latest, with the rest one tap away.
      let end = index;
      if (entry.type === "event") while (entries[end + 1]?.type === "event") end++;
      const at = entries[end].at;
      // A day divider whenever the day changes, so last night's message isn't read as this morning's.
      if (at && !(previous?.at && sameDay(previous.at, at))) {
        out.push(<li key={`day-${index}`} role="separator" className="my-4 text-center text-xs font-medium text-muted-foreground">{dayLabel(at)}</li>);
      }
      if (entry.type === "event") {
        const run = entries.slice(index, end + 1) as Extract<Entry, { type: "event" }>[];
        const key = `${index}-${run.length}`;
        if (run.length > 2 && !openRuns.has(key)) {
          out.push(<li key={`more-${key}`} className="flex justify-center"><button type="button" className="text-xs font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setOpenRuns((current) => new Set(current).add(key))}>{t("chatEarlierUpdates", { count: run.length - 1 })}</button></li>);
          out.push(renderEvent(run[run.length - 1].event));
        } else run.forEach((item) => out.push(renderEvent(item.event)));
        index = end + 1;
        continue;
      }
      const message = entry.message;
      if (message.senderRole === "system") {
        const systemMessage = normalizeChatSystemMessage(message.content, canBook);
        if (systemMessage) out.push(
          <li key={message.id} className="my-3 flex justify-center">
            <span className="rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">{systemMessage}</span>
          </li>);
        index++;
        continue;
      }
      const isMe = message.senderId === currentUserId;
      let senderName = "User";
      if (message.senderRole === "chef") senderName = chefName || t(isManager ? "chatCustomer" : "chatChef");
      if (message.senderRole === "manager") senderName = managerName || t("chatManager");
      // The admin role is internal; the chef only ever sees the team name.
      if (message.senderRole === "admin") senderName = localCooksName;
      const first = !sameSender(previous, entry), last = !sameSender(entry, entries[index + 1]);
      // The app's clock: "11:46 a.m." in English, the reader's own convention in other languages.
      const timestamp = new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit" }).format(at ?? new Date());
      out.push(
        <ChatBubble
          key={message.id}
          variant={isMe ? "sent" : "received"}
          avatarSrc={!viewerSeesChef && message.senderRole === "manager" ? partnerImage ?? undefined : undefined}
          avatarFallback={senderName[0]}
          // Names only where it isn't obvious who's talking: Local Cooks in the thread, or an admin reading both sides.
          senderName={message.senderRole === "admin" || isAdmin ? senderName : undefined}
          timestamp={timestamp}
          status={index === lastSentIndex && message.readAt ? t("chatSeen") : undefined}
          first={first}
          last={last || index === lastSentIndex}
        >
          {message.type === "file" ? (
            <div className="flex flex-col gap-2 p-1">
              {message.content && <span className="text-sm">{message.content}</span>}
              <AuthenticatedFileLink
                conversationId={conversationId}
                url={message.fileUrl}
                fileName={message.fileName}
                className="group flex items-center gap-2 rounded border bg-background/50 p-2 transition-colors hover:bg-background/80"
              />
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </ChatBubble>,
      );
      index++;
    }

    return (
      <ChatMessageList scrollRef={messagesEndRef} className="gap-0 px-4 py-4 sm:px-6">
        <ul className="flex flex-col">{out}</ul>
      </ChatMessageList>
    );
  };

  const renderContent = (
    <div className="flex-1 flex flex-col overflow-hidden">
      {renderHeader()}

      <div className="flex-1 overflow-hidden relative bg-muted/20">
        {isLoading || availabilityPending ? (
          <MessageThreadSkeleton count={6} />
        ) : (
          renderMessages()
        )}
      </div>

      <div className="border-t bg-background">
        {/* Attaching facility documents is pointless once the thread is dormant,
            and the pending-attachment chip row would dangle. Both are hidden
            behind the same read-only state rather than the composer alone. */}
        {!unavailable && !availabilityPending && isManager && !!applicationId && (
          <div className="border-b bg-muted/10">
            <FacilityDocumentsPanel
              locationId={locationId}
              applicationId={applicationId}
              onAttachDocuments={handleAttachFacilityDocuments}
            />
          </div>
        )}

        {!unavailable && !availabilityPending && attachedFacilityDocuments.length > 0 && (
          <div className="px-4 py-2 bg-muted/30 border-b flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
            {attachedFacilityDocuments.map((doc, index) => (
              <div key={index} className="flex items-center gap-2 bg-background border px-2 py-1 rounded-md text-sm shadow-sm">
                <span className="flex items-center gap-2 max-w-[150px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span className="font-medium truncate">{doc.name}</span>
                </span>
                <Button variant="ghost" size="icon" className="h-4 w-4 rounded-full -mr-1" onClick={() => removeAttachedDocument(index)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {availabilityPending ? (
          // Availability is still being verified — claiming the account was
          // deleted here is exactly the bug this replaces: the notice flashed on
          // open and then vanished once the check came back.
          <div className="px-4 py-5" aria-busy="true">
            <div className="h-9 w-full rounded-md bg-muted animate-pulse" />
          </div>
        ) : unavailable ? (
          // A notice, not a disabled input: a greyed-out box invites the user to
          // keep trying, and never explains why nothing happens.
          <div className="px-4 py-5 flex items-start gap-3 bg-muted/30" role="note">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {unavailableRole === 'chef'
                  ? (isManager ? t("chatUnavailableCustomerTitle") : t("chatUnavailableChefTitle", "This chef's account was deleted"))
                  : unavailableRole === 'manager'
                    ? t("chatUnavailableManagerTitle", "This manager's account was deleted")
                    : t("chatUnavailableTitle", "This account was deleted")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("chatUnavailableDescription", "This conversation is no longer active. You can still read the history above, but new messages can't be sent or received.")}
              </p>
            </div>
          </div>
        ) : (
          <ChatInput
            initialDraft={initialDraft}
            onSend={onSend}
            isLoading={isSending}
            disabled={!role}
            hasExternalAttachments={attachedFacilityDocuments.length > 0}
            className="border-0 shadow-none bg-background pb-6"
            placeholder={t("chatWriteMessage")}
          />
        )}
        {!unavailable && !availabilityPending && !isAdmin && (
          <p className="-mt-3 px-4 pb-3 text-[11.5px] text-muted-foreground">{t("chatKeepOnPlatform")}</p>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div ref={panelRef} className="flex flex-col h-full bg-background border-none shadow-none">
        {renderContent}
      </div>
    );
  }

  return (
    <Card className="w-full max-w-4xl mx-auto h-[700px] flex flex-col shadow-2xl border-border/50 overflow-hidden">
      <CardContent ref={panelRef} className="flex-1 p-0 flex flex-col h-full">
        {renderContent}
      </CardContent>
    </Card>
  );
}
