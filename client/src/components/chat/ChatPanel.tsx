import { useState, useEffect, useRef } from 'react';
import { X, Send, Paperclip, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFirebaseAuth } from '@/hooks/use-auth';
import {
  getMessages,
  sendMessage,
  subscribeToMessages,
  markAsRead,
  uploadChatFile,
  type ChatMessage,
} from '@/services/chat-service';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import ChatHeader from './ChatHeader';
import FacilityDocumentsPanel from './FacilityDocumentsPanel';

interface ChatPanelProps {
  conversationId: string;
  applicationId: number;
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
  applicationId,
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
  const { user } = useFirebaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [attachedFacilityDocument, setAttachedFacilityDocument] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get Neon user ID from API
  const { data: userInfo } = useQuery({
    queryKey: ['/api/firebase/user/me'],
    queryFn: async () => {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/user/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to get user info');
      return response.json();
    },
    enabled: !!user,
  });

  const currentUserId = userInfo?.id || 0;
  const isChef = currentUserId === chefId;
  const isManager = currentUserId === managerId;

  useEffect(() => {
    if (!conversationId) {
      console.log('No conversationId, skipping message load');
      return;
    }

    if (!currentUserId || currentUserId === 0) {
      console.log('Waiting for currentUserId...', { currentUserId, userInfo });
      return;
    }

    console.log('Setting up message subscription for conversation:', conversationId, {
      currentUserId,
      isChef,
      isManager,
    });

    // Load initial messages
    const loadMessages = async () => {
      try {
        console.log('Loading initial messages...');
        const initialMessages = await getMessages(conversationId);
        console.log('Loaded messages:', initialMessages.length);
        setMessages(initialMessages);
        setIsLoading(false);

        // Mark as read
        if (isChef || isManager) {
          await markAsRead(conversationId, currentUserId, isChef ? 'chef' : 'manager');
          // Notify parent component to update conversation list
          if (onUnreadCountUpdate) {
            onUnreadCountUpdate();
          }
        }
      } catch (error) {
        console.error('Error loading messages:', error);
        setIsLoading(false);
      }
    };

    loadMessages();

    // Subscribe to real-time updates
    console.log('Setting up real-time subscription...');
    const unsubscribe = subscribeToMessages(
      conversationId,
      (newMessages) => {
        console.log('Received new messages from subscription:', newMessages.length);
        setMessages(newMessages);
        // Auto-scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      },
      (error) => {
        console.error('Subscription error:', error);
        // Show error to user if subscription fails
        if (error && typeof error === 'object' && 'code' in error) {
          const firebaseError = error as { code: string };
          if (firebaseError.code === 'permission-denied') {
            console.error('Permission denied - check Firestore rules');
          } else if (firebaseError.code === 'failed-precondition') {
            console.error('Index required - check Firestore indexes');
          }
        }
      }
    );

    return () => {
      console.log('Cleaning up message subscription');
      unsubscribe();
    };
  }, [conversationId, currentUserId, isChef, isManager, userInfo]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (content: string, file?: File) => {
    if (!content.trim() && !file && !attachedFacilityDocument) return;

    // Validate currentUserId before sending
    if (!currentUserId || currentUserId === 0) {
      console.error('Cannot send message: currentUserId is not available', { currentUserId, userInfo });
      return;
    }

    setIsSending(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;

      if (file) {
        fileUrl = await uploadChatFile(conversationId, file);
        fileName = file.name;
      } else if (attachedFacilityDocument) {
        // Use the facility document URL directly
        fileUrl = attachedFacilityDocument.url;
        fileName = attachedFacilityDocument.name;
      }

      // Use attached facility document content or provided content
      const messageContent = attachedFacilityDocument && !content.trim()
        ? `Attached facility document: ${attachedFacilityDocument.name}`
        : content;

      console.log('Sending message:', {
        conversationId,
        senderId: currentUserId,
        senderRole: isChef ? 'chef' : 'manager',
        content: messageContent.substring(0, 50) + '...',
        hasFacilityDoc: !!attachedFacilityDocument,
      });

      const messageId = await sendMessage(
        conversationId,
        currentUserId,
        isChef ? 'chef' : 'manager',
        messageContent,
        (file || attachedFacilityDocument) ? 'file' : 'text',
        fileUrl,
        fileName
      );

      console.log('Message sent successfully:', messageId);

      // Clear the attached facility document after sending
      setAttachedFacilityDocument(null);
    } catch (error) {
      console.error('Error sending message:', error);
      // Show error to user
      alert(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachFacilityDocument = (document: { name: string; url: string }) => {
    setAttachedFacilityDocument(document);
  };

  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        <ChatHeader
          locationName={locationName}
          onClose={onClose}
          embedded={embedded}
        />
        <div className="flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              chefName={chefName}
              managerName={managerName}
              messagesEndRef={messagesEndRef}
            />
          )}
        </div>
        {isManager && (
          <div className="border-t bg-gray-50 p-4">
            <FacilityDocumentsPanel
              locationId={locationId}
              onAttachDocument={handleAttachFacilityDocument}
            />
          </div>
        )}
        <ChatInput
          onSend={handleSendMessage}
          isSending={isSending}
          attachedFacilityDocument={attachedFacilityDocument}
          onClearFacilityDocument={() => setAttachedFacilityDocument(null)}
        />
      </div>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto h-[600px] flex flex-col">
      <CardHeader className="flex-shrink-0 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Chat</CardTitle>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <ChatHeader locationName={locationName} embedded={true} />
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden p-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <MessageList messages={messages} currentUserId={currentUserId} messagesEndRef={messagesEndRef} />
          </div>
        )}
        <ChatInput onSend={handleSendMessage} isSending={isSending} />
      </CardContent>
    </Card>
  );
}
