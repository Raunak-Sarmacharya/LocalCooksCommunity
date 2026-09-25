import { logger } from "@/lib/logger";
import { normalizeChatSystemMessage } from "@/lib/chat-system-message";
import { useTranslation } from "react-i18next";
import { useState, useRef, useEffect } from "react";
import { X, Info, FileText, AlertCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import FacilityDocumentsPanel from './FacilityDocumentsPanel';
import { MessageThreadSkeleton } from './ConversationItemSkeleton';
import { useChat } from "@/hooks/use-chat";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { Timestamp } from "firebase/firestore";

// Authenticated file link component for chat attachments
function AuthenticatedFileLink({ url, fileName, className }: { url: string | null | undefined; fileName?: string; className?: string }) {
  const { url: presignedUrl, isLoading } = usePresignedDocumentUrl(url);
  
  if (!url) return null;
  
  return (
    <a
      href={presignedUrl || url}
      target="_blank"
      rel="noopener noreferrer"
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
    </a>
  );
}

// Shadcn Chat Components
import { ChatBubble } from "@/components/ui/chat/chat-bubble";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { ChatMessageList } from "@/components/ui/chat/chat-message-list";
import { ChatAvatar } from "@/components/ui/chat/chat-avatar";
import { Separator } from "@/components/ui/separator";

interface ChatPanelProps {
  conversationId: string;
  applicationId?: number; // Kept for prop compatibility but unused
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
  onClose?: () => void;
  onUnreadCountUpdate?: () => void;
  embedded?: boolean;
}

export default function ChatPanel({
  conversationId,
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
  onClose,
  onUnreadCountUpdate,
  embedded = false,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [attachedFacilityDocuments, setAttachedFacilityDocuments] = useState<Array<{
    name: string;
    url: string;
  }>>([]);

  const { t } = useTranslation("chef");
  const {
    messages,
    isLoading,
    isSending,
    currentUserId,
    handleSendMessage,
    isManager,
    isAdmin,
    error,
  } = useChat({
    conversationId,
    chefId,
    managerId,
    onUnreadCountUpdate,
    viewerRole,
  });

  const localCooksName = adminName || t("chatLocalCooks", "Local Cooks");

  const onSend = async (content: string, files?: File[]) => {
    // Guarded here as well as in the UI: the composer is the only caller today,
    // but a send into a thread whose other participant no longer exists would
    // create a message nobody can ever read.
    if (unavailable) return;
    try {
      // 1. Send text message first if exists
      if (content.trim()) {
        await handleSendMessage(content);
      }

      // 2. Send attached facility documents
      if (attachedFacilityDocuments.length > 0) {
        for (const doc of attachedFacilityDocuments) {
          // Send as a file message with URL
          await handleSendMessage('', { name: doc.name, url: doc.url });
        }
        setAttachedFacilityDocuments([]);
      }

      // 3. Send uploaded files
      if (files && files.length > 0) {
        for (const file of files) {
          await handleSendMessage('', file);
        }
      }
    } catch (error) {
      logger.error('Failed to send message:', error);
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
  useEffect(() => {
    if (messages.length > 0) {
      // Only scroll if we are already near the bottom OR it's the first load
      // For now, let's just make it behavior: 'auto' to avoid the whole page jumping visibly
      // And scope it to the container if possible, but scrollIntoView works on element.
      // Better: check if we should scroll.
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages]);

  // ... helpers getPartnerName/getPartnerLabel kept same ...
  // From the admin's seat this is the chef's conversation, exactly as it is for
  // the manager — an admin does not sit opposite themselves.
  const viewerSeesChef = isManager || isAdmin;
  const getPartnerName = () => {
    if (viewerSeesChef) return chefName || t("chatChef");
    return managerName || t("chatManager");
  };

  const getPartnerLabel = () => {
    if (viewerSeesChef) return t("chatChef");
    return t("chatManager");
  }

  // ... renderHeader kept same ...
  const renderHeader = () => (
    <div className="flex flex-row items-center justify-between space-y-0 gap-x-3 py-3 px-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-3">
        <ChatAvatar
          fallback={getPartnerName()[0]}
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{getPartnerName()}</span>
          <span className="text-xs text-muted-foreground">{locationName || getPartnerLabel()}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {error && (
          <div className="flex items-center text-destructive text-sm mr-2">
            <Info className="h-4 w-4 mr-1" />
            <span>{t("chatConnectionError")}</span>
          </div>
        )}
        {onClose && (
          <>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-destructive/10 hover:text-destructive">
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );

  // ... renderMessages kept same generally ...
  const renderMessages = () => {
    if (messages.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm p-8">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Info className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <p>{t("chatNoMessages")}</p>
          <p className="text-xs mt-1 text-muted-foreground/70">{t("chatStartConversation")}</p>
        </div>
      );
    }

    return (
      <ChatMessageList scrollRef={messagesEndRef} className="px-4 py-6">
        {messages.map((message) => {
          if (message.senderRole === 'system') {
            return (
              <div key={message.id} className="flex justify-center my-4">
                <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full border">
                  {normalizeChatSystemMessage(message.content)}
                </span>
              </div>
            );
          }

          const isMe = message.senderId === currentUserId;
          let senderName = "User";
          if (message.senderRole === 'chef') senderName = chefName || t("chatChef");
          if (message.senderRole === 'manager') senderName = managerName || t("chatManager");
          // The admin role is internal; the chef only ever sees the team name.
          if (message.senderRole === 'admin') senderName = localCooksName;

          const timestamp = message.createdAt instanceof Date
            ? message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : message.createdAt instanceof Timestamp
              ? message.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return (
            <ChatBubble
              key={message.id}
              variant={isMe ? "sent" : "received"}
              avatarFallback={senderName[0]}
              senderName={!isMe ? senderName : "You"}
              timestamp={timestamp}
            >
              {message.type === 'file' ? (
                <div className="flex flex-col gap-2 p-1">
                  {message.content && <span className="text-sm">{message.content}</span>}
                  <AuthenticatedFileLink
                    url={message.fileUrl}
                    fileName={message.fileName}
                    className="flex items-center gap-2 p-2 rounded bg-background/50 border hover:bg-background/80 transition-colors group"
                  />
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </ChatBubble>
          );
        })}
      </ChatMessageList>
    );
  };

  const renderContent = (
    <div className="flex-1 flex flex-col overflow-hidden">
      {renderHeader()}

      <div className="flex-1 overflow-hidden relative bg-muted/20">
        {isLoading ? (
          <MessageThreadSkeleton count={6} />
        ) : (
          renderMessages()
        )}
      </div>

      <div className="border-t bg-background">
        {/* Attaching facility documents is pointless once the thread is dormant,
            and the pending-attachment chip row would dangle. Both are hidden
            behind the same read-only state rather than the composer alone. */}
        {!unavailable && isManager && (
          <div className="border-b bg-muted/10">
            <FacilityDocumentsPanel
              locationId={locationId}
              onAttachDocuments={handleAttachFacilityDocuments}
            />
          </div>
        )}

        {!unavailable && attachedFacilityDocuments.length > 0 && (
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

        {unavailable ? (
          // A notice, not a disabled input: a greyed-out box invites the user to
          // keep trying, and never explains why nothing happens.
          <div className="px-4 py-5 flex items-start gap-3 bg-muted/30" role="note">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {unavailableRole === 'chef'
                  ? t("chatUnavailableChefTitle", "This chef's account was deleted")
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
            onSend={onSend}
            isLoading={isSending}
            hasExternalAttachments={attachedFacilityDocuments.length > 0}
            className="border-0 shadow-none bg-background pb-6"
            placeholder={t("chatMessagePlaceholder", { name: getPartnerName() })}
          />
        )}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full bg-background border-none shadow-none">
        {renderContent}
      </div>
    );
  }

  return (
    <Card className="w-full max-w-4xl mx-auto h-[700px] flex flex-col shadow-2xl border-border/50 overflow-hidden">
      <CardContent className="flex-1 p-0 flex flex-col h-full">
        {renderContent}
      </CardContent>
    </Card>
  );
}
