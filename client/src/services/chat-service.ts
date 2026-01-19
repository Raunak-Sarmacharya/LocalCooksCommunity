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

    console.log('Updating conversation:', updateData);
    await updateDoc(conversationRef, updateData);
    console.log('Conversation updated successfully');

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

    return conversations;
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
