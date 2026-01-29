import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  QuerySnapshot,
  DocumentData
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface ChatMessage {
  id?: string;
  senderId: number;
  senderRole: 'chef' | 'manager' | 'system';
  content: string;
  type: 'text' | 'file' | 'system';
  fileUrl?: string;
  fileName?: string;
  createdAt: Timestamp | Date;
  readAt?: Timestamp | Date;
}

export interface Conversation {
  id: string;
  applicationId: number;
  chefId: number;
  managerId: number;
  locationId: number;
  createdAt: Timestamp | Date;
  lastMessageAt: Timestamp | Date;
  unreadChefCount: number;
  unreadManagerCount: number;
}

/**
 * Create a new conversation for an application
 */
export async function createConversation(
  applicationId: number,
  chefId: number,
  managerId: number,
  locationId: number
): Promise<string> {
  try {
    // First check if a conversation already exists for this application
    const existingConversation = await getConversationForApplication(applicationId);
    if (existingConversation) {
      console.log('Using existing conversation:', existingConversation.id);

      // If the existing conversation is missing IDs (legacy data), update it
      const updates: any = {};
      if (!existingConversation.chefId || existingConversation.chefId !== chefId) {
        updates.chefId = chefId;
      }
      if (!existingConversation.managerId || existingConversation.managerId !== managerId) {
        updates.managerId = managerId;
      }

      if (Object.keys(updates).length > 0) {
        console.log('Healing existing conversation with missing IDs:', updates);
        const conversationRef = doc(db, 'conversations', existingConversation.id);
        await updateDoc(conversationRef, updates);
      }

      return existingConversation.id;
    }

    const conversationRef = await addDoc(collection(db, 'conversations'), {
      applicationId,
      chefId,
      managerId,
      locationId,
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      unreadChefCount: 0,
      unreadManagerCount: 0,
    });

    console.log('Created new conversation:', conversationRef.id);
    return conversationRef.id;
  } catch (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }
}

/**
 * Get a conversation by ID
 */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  try {
    const conversationDoc = await getDoc(doc(db, 'conversations', conversationId));
    if (!conversationDoc.exists()) {
      return null;
    }
    return {
      id: conversationDoc.id,
      ...conversationDoc.data(),
    } as Conversation;
  } catch (error) {
    console.error('Error getting conversation:', error);
    throw error;
  }
}

/**
 * Get conversation for an application
 */
export async function getConversationForApplication(applicationId: number): Promise<Conversation | null> {
  try {
    const q = query(
      collection(db, 'conversations'),
      where('applicationId', '==', applicationId),
      limit(1)
    );
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return null;
    }
    const doc = querySnapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as Conversation;
  } catch (error) {
    console.error('Error getting conversation for application:', error);
    throw error;
  }
}

/**
 * Send a message in a conversation
 */
export async function sendMessage(
  conversationId: string,
  senderId: number,
  senderRole: 'chef' | 'manager',
  content: string,
  type: 'text' | 'file' = 'text',
  fileUrl?: string,
  fileName?: string
): Promise<string> {
  try {
    // Validate inputs
    if (!conversationId) {
      throw new Error('Conversation ID is required');
    }
    if (!senderId || senderId === 0) {
      throw new Error('Sender ID is required');
    }
    if (!content.trim() && !fileUrl) {
      throw new Error('Message content is required');
    }

    // Ensure user is authenticated
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('User must be authenticated to send messages');
    }

    // Verify auth token is valid
    try {
      await currentUser.getIdToken(true); // Force refresh to ensure valid token
    } catch (authError) {
      console.error('Auth token error:', authError);
      throw new Error('Authentication failed. Please refresh the page and try again.');
    }

    console.log('Creating message document...', {
      conversationId,
      senderId,
      senderRole,
      type,
      hasContent: !!content.trim(),
      hasFile: !!fileUrl,
      userId: currentUser.uid,
    });

    // Create the message
    const messageRef = await addDoc(
      collection(db, 'conversations', conversationId, 'messages'),
      {
        senderId,
        senderRole,
        content: content.trim() || '',
        type,
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        createdAt: serverTimestamp(),
        readAt: null,
      }
    );

    console.log('Message document created:', messageRef.id);

    // Update conversation's lastMessageAt and unread counts
    const conversationRef = doc(db, 'conversations', conversationId);

    // Get current conversation to read current unread counts atomically
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      console.warn('Conversation not found, but message was created:', conversationId);
      // Message was created, but conversation update might fail - that's okay
      return messageRef.id;
    }

    const updateData: any = {
      lastMessageAt: serverTimestamp(),
    };

    // Increment unread count for the other party
    if (senderRole === 'chef') {
      updateData.unreadManagerCount = (conversation.unreadManagerCount || 0) + 1;
    } else {
      updateData.unreadChefCount = (conversation.unreadChefCount || 0) + 1;
    }

    // Self-healing: Update managerId or chefId if missing/incorrect on the conversation
    // This fixes legacy conversations where managerId might be 0 or undefined
    if (senderRole === 'manager' && (!conversation.managerId || conversation.managerId !== senderId)) {
      console.log('Self-healing managerId on conversation:', conversationId, 'from', conversation.managerId, 'to', senderId);
      updateData.managerId = senderId;
    }
    if (senderRole === 'chef' && (!conversation.chefId || conversation.chefId !== senderId)) {
      console.log('Self-healing chefId on conversation:', conversationId, 'from', conversation.chefId, 'to', senderId);
      updateData.chefId = senderId;
    }

    console.log('Updating conversation:', updateData);
    await updateDoc(conversationRef, updateData);
    console.log('Conversation updated successfully');

    // Trigger notification for the recipient
    try {
      const { auth } = await import('@/lib/firebase');
      const token = await auth.currentUser?.getIdToken();
      
      if (senderRole === 'manager' && conversation.chefId) {
        // Manager sent message -> notify chef
        await fetch('/api/chef/notifications/message-received', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            chefId: conversation.chefId,
            senderName: 'Kitchen Manager',
            messagePreview: content.substring(0, 100),
            conversationId
          })
        });
      } else if (senderRole === 'chef' && conversation.managerId) {
        // Chef sent message -> notify manager
        await fetch('/api/manager/notifications/message-received', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            managerId: conversation.managerId,
            locationId: conversation.locationId,
            senderName: 'Chef',
            messagePreview: content.substring(0, 100),
            conversationId
          })
        });
      }
    } catch (notifError) {
      // Don't fail the message send if notification fails
      console.warn('Failed to send notification:', notifError);
    }

    return messageRef.id;
  } catch (error) {
    console.error('Error sending message:', error);
    // Log more details about the error
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    throw error;
  }
}

/**
 * Send a system message (automated notifications)
 */
export async function sendSystemMessage(
  conversationId: string,
  content: string
): Promise<string> {
  try {
    const messageRef = await addDoc(
      collection(db, 'conversations', conversationId, 'messages'),
      {
        senderId: 0, // System user
        senderRole: 'system',
        content,
        type: 'system',
        createdAt: serverTimestamp(),
        readAt: null,
      }
    );

    // Update conversation's lastMessageAt
    await updateDoc(doc(db, 'conversations', conversationId), {
      lastMessageAt: serverTimestamp(),
    });

    return messageRef.id;
  } catch (error) {
    console.error('Error sending system message:', error);
    throw error;
  }
}

/**
 * Get messages for a conversation (with pagination)
 */
export async function getMessages(
  conversationId: string,
  limitCount: number = 50
): Promise<ChatMessage[]> {
  try {
    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as ChatMessage))
      .reverse(); // Reverse to show oldest first
  } catch (error) {
    console.error('Error getting messages:', error);
    throw error;
  }
}

/**
 * Subscribe to real-time messages for a conversation
 */
export function subscribeToMessages(
  conversationId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void,
  limitCount: number = 50
): () => void {
  console.log('Setting up Firestore subscription for conversation:', conversationId);

  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot: QuerySnapshot<DocumentData>) => {
      console.log('Snapshot received:', {
        conversationId,
        messageCount: snapshot.docs.length,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        fromCache: snapshot.metadata.fromCache,
      });

      const messages = snapshot.docs
        .map(doc => {
          const data = doc.data();
          console.log('Message data:', {
            id: doc.id,
            senderId: data.senderId,
            senderRole: data.senderRole,
            hasContent: !!data.content,
            createdAt: data.createdAt,
          });
          return {
            id: doc.id,
            ...data,
          } as ChatMessage;
        })
        .reverse(); // Reverse to show oldest first

      console.log('Calling callback with', messages.length, 'messages');
      callback(messages);
    },
    (error) => {
      console.error('Error subscribing to messages:', error);
      if (onError) {
        onError(error);
      }
    }
  );

  return unsubscribe;
}

/**
 * Mark messages as read
 */
export async function markAsRead(
  conversationId: string,
  userId: number,
  role: 'chef' | 'manager'
): Promise<void> {
  try {
    // Mark all unread messages as read
    const messagesSnapshot = await getDocs(
      collection(db, 'conversations', conversationId, 'messages')
    );

    const batch = messagesSnapshot.docs
      .filter(doc => {
        const data = doc.data();
        // Only mark messages from the other party as read
        return (
          (role === 'chef' && data.senderRole === 'manager') ||
          (role === 'manager' && data.senderRole === 'chef')
        ) && !data.readAt;
      })
      .map(doc => updateDoc(doc.ref, { readAt: serverTimestamp() }));

    await Promise.all(batch);

    // Reset unread count
    const conversationRef = doc(db, 'conversations', conversationId);
    const updateData: any = {};
    if (role === 'chef') {
      updateData.unreadChefCount = 0;
    } else {
      updateData.unreadManagerCount = 0;
    }
    await updateDoc(conversationRef, updateData);
  } catch (error) {
    console.error('Error marking messages as read:', error);
    throw error;
  }
}

/**
 * Upload a file for chat (returns file URL)
 * Note: This should use your existing R2 upload infrastructure
 */
export async function uploadChatFile(
  conversationId: string,
  file: File
): Promise<string> {
  try {
    // Use existing upload endpoint
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to upload file');
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Error uploading chat file:', error);
    throw error;
  }
}

/**
 * Get all conversations for a user (manager or chef)
 */
export async function getAllConversations(
  userId: number,
  role: 'chef' | 'manager'
): Promise<Conversation[]> {
  try {
    // Ensure Firebase is initialized
    if (!db) {
      throw new Error('Firebase is not initialized. Please check your configuration.');
    }

    // Ensure user is authenticated before querying
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('User must be authenticated to load conversations');
    }

    // Verify auth token is valid
    try {
      await currentUser.getIdToken(true); // Force refresh to ensure valid token
    } catch (authError) {
      console.error('Auth token error:', authError);
      throw new Error('Authentication failed. Please refresh the page and try again.');
    }

    if (!userId || userId === 0) {
      throw new Error(`Invalid ${role} ID: ${userId}`);
    }

    const field = role === 'chef' ? 'chefId' : 'managerId';

    console.log('Fetching conversations:', { userId, role, field, firebaseUid: currentUser.uid });

    // First, get all conversations for this user
    // Note: Ensure userId matches the data type stored in Firestore (should be number)
    const q = query(
      collection(db, 'conversations'),
      where(field, '==', userId)
    );

    console.log('Executing Firestore query...');
    const querySnapshot = await getDocs(q);

    console.log('Found conversations:', querySnapshot.docs.length);

    const conversations: Conversation[] = [];
    querySnapshot.docs.forEach(doc => {
      const data = doc.data();
      conversations.push({
        id: doc.id,
        applicationId: data.applicationId,
        chefId: data.chefId,
        managerId: data.managerId,
        locationId: data.locationId,
        createdAt: data.createdAt?.toDate() || new Date(),
        lastMessageAt: data.lastMessageAt?.toDate() || new Date(),
        unreadChefCount: data.unreadChefCount || 0,
        unreadManagerCount: data.unreadManagerCount || 0,
      });
    });

    // Sort by lastMessageAt descending (client-side to avoid index requirement)
    conversations.sort((a, b) => {
      const dateA = a.lastMessageAt instanceof Date
        ? a.lastMessageAt
        : (a.lastMessageAt as Timestamp).toDate();
      const dateB = b.lastMessageAt instanceof Date
        ? b.lastMessageAt
        : (b.lastMessageAt as Timestamp).toDate();
      return dateB.getTime() - dateA.getTime();
    });

    // Deduplicate conversations by applicationId, keeping the most recent one
    const uniqueConversationsMap = new Map<number, Conversation>();

    conversations.forEach(conv => {
      const existing = uniqueConversationsMap.get(conv.applicationId);
      if (!existing || conv.lastMessageAt > existing.lastMessageAt) {
        uniqueConversationsMap.set(conv.applicationId, conv);
      }
    });

    // Convert back to array
    const uniqueConversations = Array.from(uniqueConversationsMap.values());

    return uniqueConversations;
  } catch (error) {
    console.error('Error getting conversations:', error);
    // Log more details about the error
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        userId,
        role,
      });
    }
    throw error;
  }
}

/**
 * Get unread message count for a user
 */
export async function getUnreadCount(
  userId: number,
  role: 'chef' | 'manager'
): Promise<number> {
  try {
    const field = role === 'chef' ? 'chefId' : 'managerId';
    const unreadField = role === 'chef' ? 'unreadChefCount' : 'unreadManagerCount';

    const q = query(
      collection(db, 'conversations'),
      where(field, '==', userId)
    );
    const querySnapshot = await getDocs(q);

    let totalUnread = 0;
    querySnapshot.docs.forEach(doc => {
      const data = doc.data();
      totalUnread += data[unreadField] || 0;
    });

    return totalUnread;
  } catch (error) {
    console.error('Error getting unread count:', error);
    return 0;
  }
}

/**
 * Ensure conversation has the correct managerId (Self-healing for legacy chats)
 */
export async function ensureConversationManagerId(
  conversationId: string,
  managerId: number
): Promise<void> {
  try {
    if (!conversationId || !managerId) return;

    const conversationRef = doc(db, 'conversations', conversationId);
    const conversationSnap = await getDoc(conversationRef);

    if (conversationSnap.exists()) {
      const data = conversationSnap.data();
      // If managerId is missing or 0 or incorrect, update it
      if (!data.managerId || data.managerId !== managerId) {
        console.log(`[ChatService] Healing conversation ${conversationId}: Updating managerId from ${data.managerId} to ${managerId}`);
        await updateDoc(conversationRef, { managerId });
      }
    }
  } catch (error) {
    console.error('[ChatService] Error verifying conversation managerId:', error);
    // Don't throw, just log - this is a background repair operation
  }
}
