import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { getMessages, sendMessage, subscribeToMessages, markAsRead, uploadChatFile, type ChatMessage } from "@/services/chat-service";

interface UseChatOptions {
  conversationId: string;
  chefId: number;
  managerId: number;
  onUnreadCountUpdate?: () => void;
  /**
   * Explicit override of the viewer's role.
   *
   * Needed for admins. The default inference below is "am I the chef or the
   * manager on this conversation?", which an admin is neither — so both flags
   * came back false, `markAsRead` never fired, and typing produced no message
   * because the send path had no role to attribute it to. Passing 'admin'
   * makes the viewer a recognized third participant.
   */
  viewerRole?: 'admin';
}

export function useChat({ conversationId, chefId, managerId, onUnreadCountUpdate, viewerRole }: UseChatOptions) {
  const { user } = useFirebaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

  // Use ref for callback to avoid re-subscribing when it changes
  const onUnreadCountUpdateRef = useRef(onUnreadCountUpdate);

  useEffect(() => {
    onUnreadCountUpdateRef.current = onUnreadCountUpdate;
  }, [onUnreadCountUpdate]);

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
  const isAdmin = viewerRole === 'admin';
  const isChef = !isAdmin && currentUserId === chefId;
  const isManager = !isAdmin && currentUserId === managerId;

  /**
   * The role to attribute this viewer's own actions to, or null when we cannot
   * tell (e.g. the user info has not loaded yet). An admin is resolved first
   * because they match neither id.
   */
  const role: 'chef' | 'manager' | 'admin' | null = isAdmin
    ? 'admin'
    : isChef
      ? 'chef'
      : isManager
        ? 'manager'
        : null;

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

        if (role) {
          await markAsRead(conversationId, currentUserId, role);
          queryClient.invalidateQueries({ queryKey: ['unread-counts'] });
          if (onUnreadCountUpdateRef.current) onUnreadCountUpdateRef.current();
        }
      } catch (error) {
        logger.error('Error loading messages:', error);
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
  }, [conversationId, currentUserId, isChef, isManager, queryClient]);

  // Subscribe to new messages
  useEffect(() => {
    if (!conversationId) return;

    const unsubscribe = subscribeToMessages(
      conversationId,
      (newMessages) => {
        setMessages(newMessages);
        // If we receive new messages and we are viewing the chat, mark as read
        if (currentUserId && role) {
          markAsRead(conversationId, currentUserId, role)
            .then(() => {
              if (onUnreadCountUpdateRef.current) onUnreadCountUpdateRef.current();
            })
            .catch((err) => logger.error('Failed to mark as read', err));
        }
      },
      (error) => logger.error('Subscription error:', error)
    );

    return () => unsubscribe();
  }, [conversationId, currentUserId, role]);

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
        role ?? 'chef',
        messageContent,
        file ? 'file' : 'text',
        fileUrl,
        fileName
      );

      // No need to setMessages manually as subscription will catch it
      // But we could optimistically update here if desired
    } catch (error) {
      logger.error('Error sending message:', error);
      throw error;
    } finally {
      setIsSending(false);
    }
  }, [conversationId, currentUserId, role]);

  return {
    messages,
    isLoading,
    isSending,
    currentUserId,
    handleSendMessage,
    isChef,
    isManager,
    isAdmin,
    role,
    error
  };
}
