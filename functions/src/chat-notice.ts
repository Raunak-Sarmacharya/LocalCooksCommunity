/** Shared by the persisted-message trigger and legacy server aliases. No SMTP
 * here: one immediate in-app receipt and one durable ordinary unread intent. */
export interface ChatConversation {
  applicationId?: number; chefId: number; managerId: number; locationId: number;
  chefFirebaseUid: string; managerFirebaseUid: string; unavailable?: boolean;
}
export interface PersistedChatMessage {
  senderId: number; senderRole: string; senderFirebaseUid?: string; type: string; content?: string;
  bookingId?: number; createdAt?: { toDate(): Date }; readAt?: unknown;
}
export interface ChatNoticeContext {
  recipientId: number; recipientRole: 'chef' | 'manager'; recipientEmail: string;
  senderName: string; locationName: string; locationId: number; bookingId?: number; path: string;
}
export type ChatSql = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
export type ChatRelationship = { chefId: number; locationId: number; conversationId: string };

export async function resolveChatNoticeContext(db: ChatSql, conversationId: string, conversation: ChatConversation, message: PersistedChatMessage, relationship: ChatRelationship | undefined): Promise<ChatNoticeContext | null> {
  if (!conversationId || conversationId.includes('/') || conversation.unavailable || message.type === 'system' ||
      !['chef', 'manager', 'admin'].includes(message.senderRole) || typeof message.senderFirebaseUid !== 'string' || !message.senderFirebaseUid.trim() ||
      ![conversation.chefId, conversation.locationId, message.senderId].every(id => Number.isSafeInteger(id) && id > 0) ||
      relationship?.conversationId !== conversationId || relationship.chefId !== conversation.chefId || relationship.locationId !== conversation.locationId) return null;
  const query = `
    SELECT l.id AS location_id, l.name AS location_name, l.manager_id, c.id AS chef_id,
      c.firebase_uid AS chef_uid, m.firebase_uid AS manager_uid,
      c.role AS chef_role, m.role AS manager_role, s.firebase_uid AS sender_uid,
      c.username AS chef_email, m.username AS manager_email,
      s.manager_profile_data AS sender_profile, s.role AS sender_role,
      (SELECT full_name FROM chef_kitchen_applications WHERE chef_id = s.id AND location_id = l.id ORDER BY id DESC LIMIT 1) AS sender_application_name,
      (SELECT COUNT(*) FROM (SELECT id FROM chef_kitchen_applications a WHERE a.chef_id = $1 AND a.location_id = $2 AND a.status = 'approved' FOR SHARE) approved) AS apps_count,
      (SELECT json_agg(json_build_object('status', v.status, 'admin_review_decision', v.admin_review_decision, 'outcome_history', v.outcome_history))
       FROM (SELECT status, admin_review_decision, outcome_history FROM kitchen_viewings WHERE chef_id = $1 AND location_id = $2 FOR SHARE) v) AS tours
    FROM locations l
    JOIN users c ON c.id = $1
    JOIN users m ON m.id = l.manager_id
    JOIN users s ON s.id = $3
    WHERE l.id = $2
    FOR SHARE OF l, c, m, s
  `;
  const { rows: [row] } = await db.query(query, [conversation.chefId, conversation.locationId, message.senderId]);

  if (!row || row.chef_role !== 'chef' || row.manager_role !== 'manager' || !row.chef_uid?.trim() || !row.manager_uid?.trim() ||
      ![row.chef_id, row.manager_id].every(id => Number.isSafeInteger(id) && id > 0) ||
      row.sender_role !== message.senderRole || row.sender_uid !== message.senderFirebaseUid) return null;

  if (message.senderRole === 'chef' && message.senderId !== conversation.chefId) return null;
  // C2 authorizes against live SQL ownership. Stored manager metadata can lag reassignment.
  if (message.senderRole === 'manager' && message.senderId !== row.manager_id) return null;

  let hasEligibility = Number(row.apps_count) > 0;
  if (!hasEligibility && row.tours) {
    const tours = typeof row.tours === 'string' ? JSON.parse(row.tours) : row.tours;
    for (const tour of Array.isArray(tours) ? tours : []) {
      if (!tour) continue;
      if (tour.admin_review_decision === 'denied' || tour.status === 'pending_local_cooks') continue;
      const hasConf = tour.status === 'confirmed' || (Array.isArray(tour.outcome_history) && tour.outcome_history.some((e: any) => e?.from === 'confirmed' || e?.to === 'confirmed'));
      if (tour.admin_review_decision === 'approved' || (!tour.admin_review_decision && hasConf)) {
        hasEligibility = true;
        break;
      }
    }
  }

  if (!hasEligibility) return null;
  if (message.bookingId != null) {
    if (!Number(row.apps_count) || !Number.isSafeInteger(message.bookingId) || message.bookingId <= 0) return null;
    const { rows: [booking] } = await db.query(`SELECT b.id FROM kitchen_bookings b JOIN kitchens k ON k.id = b.kitchen_id
      WHERE b.id = $1 AND b.chef_id = $2 AND k.location_id = $3 AND b.status IN ('confirmed', 'cancellation_requested', 'completed') FOR SHARE OF b, k`, [message.bookingId, conversation.chefId, conversation.locationId]);
    if (!booking) return null;
  }
  const chef = message.senderRole !== 'chef';
  const role = chef ? 'chef' : 'manager';
  const names = [row.sender_profile?.displayName, row.sender_profile?.fullName,
    message.senderRole === 'chef' ? row.sender_application_name : null];
  const senderName = names.find(name => typeof name === 'string' && name.trim() && !name.includes('@'))?.trim()
    || (message.senderRole === 'chef' ? 'your chef' : 'your kitchen manager');
  return { recipientId: chef ? row.chef_id : row.manager_id, recipientRole: role,
    recipientEmail: chef ? row.chef_email : row.manager_email, senderName: message.senderRole === 'admin' ? 'Local Cooks' : senderName,
    locationName: row.location_name, locationId: row.location_id, bookingId: message.bookingId,
    path: `${chef ? '' : '/manager'}/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}${message.bookingId ? `&booking=${message.bookingId}` : ''}` };
}

/** Caller owns BEGIN/COMMIT. The lock serializes duplicate producers without
 * requiring a live schema migration or a check-then-insert race. */
export async function queueChatNotice(db: ChatSql, conversationId: string, messageId: string, conversation: ChatConversation, message: PersistedChatMessage, relationship: ChatRelationship | undefined) {
  if (!messageId || messageId.includes('/')) return { skipped: true };
  const context = await resolveChatNoticeContext(db, conversationId, conversation, message, relationship);
  if (!context) return { skipped: true };
  const createdAt = message.createdAt?.toDate();
  if (!createdAt || !Number.isFinite(createdAt.getTime())) return { skipped: true };
  const key = `chat-message:${conversationId}:${messageId}:${context.recipientId}`;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  const { rows } = await db.query('SELECT id FROM email_logs WHERE tracking_id = $1 LIMIT 1', [key]);
  if (rows.length) return { duplicate: true };
  const preview = (message.content || 'Sent an attachment').slice(0, 100);
  const title = `New message from ${context.senderName}`;
  const metadata = JSON.stringify({ conversationId, messageId, applicationId: conversation.applicationId, bookingId: context.bookingId, senderId: message.senderId });
  const targetTable = context.recipientRole === 'manager' ? 'manager_notifications' : 'chef_notifications';
  const targetField = context.recipientRole === 'manager' ? 'manager_id' : 'chef_id';
  // Preserve notices created by the previous trigger during rollout/recovery.
  const prior = await db.query(`SELECT id FROM ${targetTable} WHERE ${targetField} = $1 AND type = 'message_received'
    AND metadata->>'conversationId' = $2 AND metadata->>'messageId' = $3 LIMIT 1`, [context.recipientId, conversationId, messageId]);
  if (!message.readAt && !prior.rows.length && context.recipientRole === 'manager') {
    await db.query(`INSERT INTO manager_notifications (manager_id, location_id, type, title, message, priority, action_url, metadata)
      VALUES ($1, $2, 'message_received', $3, $4, 'normal', $5, $6)`, [context.recipientId, context.locationId, title, preview, context.path, metadata]);
  } else if (!message.readAt && !prior.rows.length) {
    await db.query(`INSERT INTO chef_notifications (chef_id, type, title, message, priority, action_url, metadata)
      VALUES ($1, 'message_received', $2, $3, 'normal', $4, $5)`, [context.recipientId, title, preview, context.path, metadata]);
  }
  const saved = JSON.stringify({ conversationId, messageId, applicationId: conversation.applicationId, bookingId: context.bookingId,
    senderId: message.senderId, senderRole: message.senderRole,
    dueAt: new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString(), path: context.path });
  await db.query(`INSERT INTO email_logs (recipient_email, recipient_user_id, recipient_role, subject, preview_text, category, status, tracking_id, text_body)
    VALUES ($1, $2, $3, $4, $5, 'chat_digest', $6, $7, $8)`,
  [context.recipientEmail, context.recipientId, context.recipientRole, 'Unread kitchen messages', 'Open your conversation to read and reply.', message.readAt ? 'suppressed' : 'scheduled', key, saved]);
  return { queued: true };
}

// The portal loads this TypeScript through tsx, while Functions compiles it to
// CommonJS. An explicit default object works with both module-loading paths.
export default { queueChatNotice, resolveChatNoticeContext };
