import { logger } from '@/lib/logger';
import type { Timestamp } from 'firebase/firestore';
/**
 * Who wrote a message.
 *
 * `admin` is the Local Cooks team. It is a distinct role, not an alias for
 * `manager`: an admin moderating a conversation is a different participant from
 * the kitchen's manager, and collapsing the two would let an admin message show
 * up as if the manager had sent it. It is displayed as "Local Cooks" everywhere
 * so the name never leaks the internal role.
 */
export type ChatSenderRole = 'chef' | 'manager' | 'admin' | 'system';

export interface ChatMessage {
  id?: string;
  senderId: number;
  senderRole: ChatSenderRole;
  content: string;
  type: 'text' | 'file' | 'system';
  fileUrl?: string;
  fileName?: string;
  createdAt: Timestamp | Date;
  readAt?: Timestamp | Date;
}

export interface Conversation {
  id: string;
  applicationId?: number;
  linkedApplicationIds?: number[];
  eligibleViewingIds?: number[];
  locationName?: string;
  chefName?: string;
  managerName?: string;
  chefId: number;
  managerId: number;
  locationId: number;
  createdAt: Timestamp | Date;
  lastMessageAt: Timestamp | Date;
  /** Preview text for inbox list (like iMessage / WhatsApp). */
  lastMessageText?: string;
  unreadChefCount: number;
  unreadManagerCount: number;
  /**
   * Set when one of the two participants has had their account deleted.
   *
   * The conversation is kept so the surviving party retains the history, but no
   * further messages can be exchanged — see `unavailableRole` for which side is
   * gone, so the UI can say the right thing.
   */
  unavailable?: boolean;
  unavailableReason?: 'account_deleted';
  unavailableRole?: 'chef' | 'manager' | 'admin' | 'user';
  unavailableAt?: Timestamp | Date;
  archivedChefAt?: Timestamp | Date;
  archivedManagerAt?: Timestamp | Date;
}


export async function chatRequest(path: string, init?: RequestInit) {
  const { auth } = await import('@/lib/firebase');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw Error('Not authenticated');
  const response = await fetch('/api/firebase/' + path, { ...init, credentials: 'include', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(data?.error || 'Messaging is unavailable. Please retry.');
  return data;
}
function dates<T>(value: T): T {
  const result = { ...value } as any;
  for (const key of ['createdAt','lastMessageAt','readAt','unavailableAt','archivedChefAt','archivedManagerAt']) {
    const time = result[key];
    if (time) result[key] = typeof time === 'string' ? new Date(time)
      : time._seconds != null ? new Date(time._seconds * 1000 + (time._nanoseconds || 0) / 1e6) : time;
  }
  return result;
}
const threadPath = (id: string) => 'chat/conversations/' + encodeURIComponent(id);
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export async function setConversationArchived(id: string, _role: 'chef' | 'manager', archived: boolean) {
  await chatRequest(threadPath(id) + '/archive', post({ archived }));
}
export async function getConversation(id: string): Promise<Conversation | null> {
  return dates(await chatRequest(threadPath(id)));
}
export async function getConversationForApplication(id: number): Promise<Conversation | null> {
  const data = await chatRequest('chat/applications/' + id + '/conversation');
  return data ? dates(data) : null;
}
export async function createConversation(id: number, _chef: number, _manager: number, _location: number) {
  const conversation = await getConversationForApplication(id);
  if (!conversation) throw Error('Chat opens after the request to apply is approved');
  return conversation.id;
}
export async function resolveTourConversation(id: number) {
  return chatRequest('chat/viewings/' + id + '/conversation');
}
export async function sendMessage(id: string, _senderId: number, _role: 'chef' | 'manager' | 'admin',
  content: string, type: 'text' | 'file' = 'text', fileUrl?: string, fileName?: string, bookingId?: number): Promise<string> {
  const result = await chatRequest(threadPath(id) + '/messages', post({ content, type, fileUrl, fileName, bookingId }));
  return result.id;
}
export async function sendSystemMessage(_id: string, _content: string): Promise<string> {
  throw Error('System messages are server-owned');
}
export async function getMessages(id: string, _limit = 50): Promise<ChatMessage[]> {
  return (await chatRequest(threadPath(id) + '/messages')).map(dates);
}
export function subscribeToMessages(id: string, callback: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void, _limit = 50): () => void {
  let active = true, busy = false;
  const refresh = async () => {
    if (busy || !active) return;
    busy = true;
    try { const messages = await getMessages(id); if (active) callback(messages); }
    catch (error) { if (active) onError?.(error as Error); }
    finally { busy = false; }
  };
  void refresh();
  const timer = window.setInterval(refresh, 3000);
  return () => { active = false; window.clearInterval(timer); };
}
export async function markAsRead(id: string, _userId: number, role: 'chef' | 'manager' | 'admin', messages: ChatMessage[]) {
  if (role === 'admin') return;
  const messageIds = Array.from(new Set(messages.filter(m => m.id && !m.readAt &&
    (role === 'chef' ? ['manager', 'admin'].includes(m.senderRole) : m.senderRole === 'chef')).map(m => m.id!)));
  if (messageIds.length) await chatRequest(threadPath(id) + '/read', post({ messageIds }));
}
export async function uploadChatFile(id: string, file: File): Promise<string> {
  const { auth } = await import('@/lib/firebase');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw Error('Not authenticated');
  const body = new FormData(); body.append('file', file);
  const response = await fetch('/api/files/chat/' + encodeURIComponent(id) + '/upload', {
    method: 'POST', body, credentials: 'include', headers: { Authorization: 'Bearer ' + token } });
  const data = await response.json();
  if (!response.ok || !data.url) throw Error(data.error || 'Could not upload attachment');
  return data.url;
}
export async function getAdminConversationForApplication(id: number): Promise<Conversation> {
  return dates(await chatRequest('admin/chat/applications/' + id + '/conversation'));
}
export async function getAdminChatMessages(id: string): Promise<ChatMessage[]> {
  return (await chatRequest('admin/chat/conversations/' + encodeURIComponent(id) + '/messages')).map(dates);
}
export async function sendAdminChatMessage(id: string, content: string, fileUrl?: string, fileName?: string) {
  return chatRequest('admin/chat/conversations/' + encodeURIComponent(id) + '/messages', post({ content, fileUrl, fileName }));
}
export async function getAllConversations(_userId: number, _role: 'chef' | 'manager'): Promise<Conversation[]> {
  const { conversations } = await chatRequest('chat/conversations');
  return conversations.map((row: any) => dates({ ...row.conversation, id: row.conversationId,
    chefId: row.chefId, managerId: row.managerId, locationId: row.locationId,
    applicationId: row.linkedApplicationIds[0], linkedApplicationIds: row.linkedApplicationIds,
    eligibleViewingIds: row.eligibleViewingIds, locationName: row.locationName, chefName: row.chefName, managerName: row.managerName }))
    .sort((a: Conversation, b: Conversation) => Number(b.lastMessageAt) - Number(a.lastMessageAt));
}
export async function getUnreadCount(id: number, role: 'chef' | 'manager'): Promise<number> {
  return (await getAllConversations(id, role)).reduce((total, row) => total +
    (role === 'chef' ? row.unreadChefCount : row.unreadManagerCount), 0);
}
export async function getLiveChatParticipants(userIds: number[]): Promise<Set<number> | null> {
  const unique = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (unique.length === 0) return new Set();

  try {
    const { auth } = await import('@/lib/firebase');
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;

    const response = await fetch('/api/firebase/chat/participant-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ userIds: unique }),
    });

    if (!response.ok) {
      logger.error('Failed to resolve chat participant status:', response.status);
      return null;
    }

    const data = await response.json();
    const existing = Array.isArray(data?.existing) ? data.existing : [];
    return new Set<number>(existing.map((id: unknown) => Number(id)));
  } catch (error) {
    logger.error('Error resolving chat participant status:', error);
    return null;
  }
}
