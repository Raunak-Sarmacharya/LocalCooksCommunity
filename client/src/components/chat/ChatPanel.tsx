import { useState, useRef, useEffect } from 'react';
import { X, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import FacilityDocumentsPanel from './FacilityDocumentsPanel';
import { useChat } from '@/hooks/use-chat';
import { Timestamp } from 'firebase/firestore';

// Shadcn Chat Components
import { ChatBubble } from '@/components/ui/chat/chat-bubble';
import { ChatInput } from '@/components/ui/chat/chat-input';
import { ChatMessageList } from '@/components/ui/chat/chat-message-list';
import { ChatAvatar } from '@/components/ui/chat/chat-avatar';
import { Separator } from '@/components/ui/separator';

interface ChatPanelProps {
  conversationId: string;
  applicationId?: number; // Kept for prop compatibility but unused
  chefId: number;
  managerId: number;
  locationId: number;
  locationName?: string;
  chefName?: string;
  managerName?: string;
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
  onClose,
  onUnreadCountUpdate,
  embedded = false,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [attachedFacilityDocuments, setAttachedFacilityDocuments] = useState<Array<{
    name: string;
    url: string;
  }>>([]);

  const {
    messages,
    isLoading,
    isSending,
    currentUserId,
    handleSendMessage,
    isManager,
    error,
  } = useChat({
    conversationId,
    chefId,
    managerId,
    onUnreadCountUpdate,
  });

  const onSend = async (content: string, files?: File[]) => {
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
      console.error('Failed to send message:', error);
    }
  };

  const handleAttachFacilityDocuments = (documents: Array<{ name: string; url: string }>) => {
    setAttachedFacilityDocuments(prev => [...prev, ...documents]);
  };
  
  const removeAttachedDocument = (index: number) => {
      setAttachedFacilityDocuments(prev => prev.filter((_, i) => i !== index));
  };


  // ... scroll effect kept same ...
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ... helpers getPartnerName/getPartnerLabel kept same ...
  const getPartnerName = () => {
    if (isManager) return chefName || "Chef";
    return managerName || "Manager";
  };

  const getPartnerLabel = () => {
     if (isManager) return "Chef";
     return "Manager";
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
              <span>Connection error</span>
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
           <p>No messages yet.</p>
           <p className="text-xs mt-1 text-muted-foreground/70">Start the conversation by saying hello!</p>
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
                  {message.content}
                </span>
              </div>
            );
          }

          const isMe = message.senderId === currentUserId;
          let senderName = "User";
          if (message.senderRole === 'chef') senderName = chefName || "Chef";
          if (message.senderRole === 'manager') senderName = managerName || "Manager";

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
                     <span className="text-sm">{message.content}</span>
                     <a
                        href={message.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2 rounded bg-background/50 border hover:bg-background/80 transition-colors group"
                     >
                        <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center group-hover:bg-primary/20">
                            <Info className="h-4 w-4 text-primary" /> 
                        </div>
                        <span className="text-xs underline truncate max-w-[150px]">
                           {message.fileName || 'Attached File'}
                        </span>
                     </a>
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
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
                </div>
            ) : (
                renderMessages()
            )}
        </div>

        <div className="border-t bg-background">
            {isManager && (
                <div className="border-b bg-muted/10">
                    <FacilityDocumentsPanel
                    locationId={locationId}
                    onAttachDocuments={handleAttachFacilityDocuments}
                    />
                </div>
            )}

            {attachedFacilityDocuments.length > 0 && (
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

            <ChatInput
                onSend={onSend}
                isLoading={isSending}
                className="border-0 shadow-none bg-background pb-6"
                placeholder={`Message ${getPartnerName()}...`}
            />
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
