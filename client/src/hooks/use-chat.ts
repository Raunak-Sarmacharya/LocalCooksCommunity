import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFirebaseAuth } from '@/hooks/use-auth';
import {
  getMessages,
  sendMessage,
  subscribeToMessages,
  markAsRead,
  uploadChatFile,
  type ChatMessage,
} from '@/services/chat-service';

interface UseChatOptions {
  conversationId: string;
  chefId: number;
  managerId: number;
  onUnreadCountUpdate?: () => void;
}

export function useChat({ conversationId, chefId, managerId, onUnreadCountUpdate }: UseChatOptions) {
  const { user } = useFirebaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

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
    staleTime: 1000 * 60 * 5, // Cache user info for 5 minutes
  });

  const currentUserId = userInfo?.id || 0;
  const isChef = currentUserId === chefId;
  const isManager = currentUserId === managerId;

  // Load initial messages
  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    let mounted = true;

    const loadMessages = async () => {
      try {
        setError(null);
        const initialMessages = await getMessages(conversationId);
        if (mounted) {
          setMessages(initialMessages);
          setIsLoading(false);
        }

        if (isChef || isManager) {
          await markAsRead(conversationId, currentUserId, isChef ? 'chef' : 'manager');
          queryClient.invalidateQueries({ queryKey: ['unread-counts'] });
          if (onUnreadCountUpdate) onUnreadCountUpdate();
        }
      } catch (error) {
        console.error('Error loading messages:', error);
        if (mounted) {
          setError(error as Error);
          setIsLoading(false);
        }
      }
    };

    loadMessages();

    return () => {
      mounted = false;
    };
  }, [conversationId, currentUserId, isChef, isManager, queryClient, onUnreadCountUpdate]);

  // Subscribe to new messages
  useEffect(() => {
    if (!conversationId) return;

    const unsubscribe = subscribeToMessages(
      conversationId,
      (newMessages) => {
        setMessages(newMessages);
        // If we receive new messages and we are viewing the chat, mark as read
        if (currentUserId && (isChef || isManager)) {
          markAsRead(conversationId, currentUserId, isChef ? 'chef' : 'manager')
            .then(() => {
              if (onUnreadCountUpdate) onUnreadCountUpdate();
            })
            .catch(console.error);
        }
      },
      (error) => console.error('Subscription error:', error)
    );

    return () => unsubscribe();
  }, [conversationId, currentUserId, isChef, isManager, onUnreadCountUpdate]);

  const handleSendMessage = useCallback(async (content: string, file?: File | { name: string; url: string }) => {
    if (!content.trim() && !file) return;
    if (!currentUserId) throw new Error('User not authenticated');

    setIsSending(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;

      if (file) {
        if (file instanceof File) {
          fileUrl = await uploadChatFile(conversationId, file);
          fileName = file.name;
        } else {
          // It's a pre-uploaded file object (e.g. facility document)
          fileUrl = file.url;
          fileName = file.name;
        }
      }

      const messageContent = !content.trim() && file 
        ? `Attached file: ${fileName}`
        : content;

      await sendMessage(
        conversationId,
        currentUserId,
        isChef ? 'chef' : 'manager',
        messageContent,
        file ? 'file' : 'text',
        fileUrl,
        fileName
      );
      
      // No need to setMessages manually as subscription will catch it
      // But we could optimistically update here if desired
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      setIsSending(false);
    }
  }, [conversationId, currentUserId, isChef]);

  return {
    messages,
    isLoading,
    isSending,
    currentUserId,
    handleSendMessage,
    isChef,
    isManager,
    error
  };
}
