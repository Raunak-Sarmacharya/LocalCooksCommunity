/** Persisted-message producer. Ordinary email belongs exclusively to the
 * existing portal worker; lifecycle action/deadline notices retain their owners. */
import { onDocumentCreatedWithAuthContext } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { Pool } from 'pg';
import { queueChatNotice, type ChatConversation, type PersistedChatMessage, type ChatRelationship } from './chat-notice';
import { wakeStartingChatEmail } from './chat-email-event';

const app = admin.initializeApp();
export function createChatNoticeTrigger(database: '(default)' | 'staging', sqlSecret: 'DATABASE_URL' | 'STAGING_DATABASE_URL', region: string) {
const eventSecret = database === 'staging' ? 'STAGING_INNGEST_EVENT_KEY' : 'INNGEST_EVENT_KEY';
let pool: Pool | null = null;
function getPool() {
  if (!pool) {
    if (!process.env[sqlSecret]) throw Error(`${sqlSecret} not configured`);
    pool = new Pool({ connectionString: process.env[sqlSecret], ssl: { rejectUnauthorized: false },
      max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 3000,
      statement_timeout: 3000, lock_timeout: 1000 });
  }
  return pool;
}

const trigger = onDocumentCreatedWithAuthContext({
  document: 'conversations/{conversationId}/messages/{messageId}', database, region,
  memory: '256MiB', timeoutSeconds: 30, maxInstances: 10, retry: true,
  secrets: [sqlSecret, eventSecret],
  ...(database === 'staging' ? { serviceAccount: 'localcooks-staging-chat@formauth-9e620.iam.gserviceaccount.com' } : {}),
}, async event => {
  if (!event.data) return;
  const { conversationId, messageId } = event.params;
  const message = event.data.data() as PersistedChatMessage;
  if (message.type === 'system' || message.senderRole === 'system') return;
  if (event.authType !== 'service_account') return;
  const firestore = getFirestore(app, database);
  const ref = firestore.collection('conversations').doc(conversationId);
  // Re-read: trigger snapshots may predate a recipient reading the thread.
  const [conversation, currentMessage] = await Promise.all([ref.get(), ref.collection('messages').doc(messageId).get()]);
  if (!conversation.exists || !currentMessage.exists) return;
  const convData = conversation.data() as ChatConversation;
  if (![convData.chefId, convData.locationId].every(id => Number.isSafeInteger(id) && id > 0)) return;

  const mapping = await firestore.collection('chatRelationships').doc(`chef-${convData.chefId}-location-${convData.locationId}`).get();
  if (!mapping.exists) return;

  const persisted = currentMessage.data() as PersistedChatMessage | undefined;
  if (persisted?.senderId !== message.senderId || persisted?.senderRole !== message.senderRole || persisted?.bookingId !== message.bookingId ||
      persisted?.senderFirebaseUid !== message.senderFirebaseUid) return;

  const client = await getPool().connect();
  let starting = false;
  try {
    await client.query('BEGIN');
    const result = await queueChatNotice(client, conversationId, messageId, convData, persisted as PersistedChatMessage, mapping.data() as ChatRelationship);
    starting = 'initialTrackingId' in result && !!result.initialTrackingId;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error; // retry retains both the in-app and digest obligation
  } finally { client.release(); }
  // Queue commits before publishing. A failed publish retries the producer;
  // duplicate starts reuse the same durable intent and event id.
  if (starting) await wakeStartingChatEmail(conversationId, messageId, message.senderId, process.env[eventSecret]);
});
process.on('SIGTERM', async () => { if (pool) await pool.end(); });
return trigger;
}
