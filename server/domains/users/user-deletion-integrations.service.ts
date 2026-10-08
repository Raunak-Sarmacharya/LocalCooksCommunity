import { sql } from 'drizzle-orm';
import { getAuth } from 'firebase-admin/auth';
import { db } from '../../db';
import { getAdminDb } from '../../chat-service';
import { initializeFirebaseAdmin } from '../../firebase-setup';
import { userService } from './user.service';

export type PendingUserDeletion = {
  id: number; username: string; role: string | null; firebaseUid: string | null;
  locationIds: number[]; cleanupPending: true;
};

export async function pendingUserDeletions(id?: number): Promise<PendingUserDeletion[]> {
  const result = await db.execute(sql`SELECT user_id AS id, username, role, firebase_uid AS "firebaseUid",
    location_ids AS "locationIds", true AS "cleanupPending" FROM user_deletion_jobs
    ${id === undefined ? sql`` : sql`WHERE user_id = ${id}`} ORDER BY created_at`);
  return result.rows as PendingUserDeletion[];
}

/** Idempotent external cleanup shared by both admin deletion endpoints. */
export async function completeUserDeletion(id: number, expectedRole?: 'manager'): Promise<void> {
  const user = await userService.getUser(id);
  const pending = user ? null : (await pendingUserDeletions(id))[0];
  if (!user && !pending) throw Object.assign(new Error('User not found'), { status: 404 });
  if (expectedRole && (user ?? pending)!.role !== expectedRole)
    throw Object.assign(new Error('User is not a manager'), { status: 400 });
  if (user) await userService.deleteUser(id, { enforceObligations: false });
  const [job] = await pendingUserDeletions(id);
  // Another successful retry may already have finished this job.
  if (!job) return;
  try {
    if (job.firebaseUid) {
      const app = initializeFirebaseAdmin();
      if (!app) throw new Error('Firebase Admin is unavailable');
      try { await getAuth(app).deleteUser(job.firebaseUid); }
      catch (error: any) { if (error.code !== 'auth/user-not-found') throw error; }
    }
    const firestore = await getAdminDb();
    const conversations = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const [field, value] of [['chefId', id], ['managerId', id],
      ...job.locationIds.map(locationId => ['locationId', locationId])] as Array<[string, number]>) {
      const snapshot = await firestore.collection('conversations').where(field, '==', value).get();
      snapshot.docs.forEach(doc => conversations.set(doc.id, doc.ref));
    }
    // Query relationships separately: legacy/missing conversation docs may still
    // have a mapping, and a previous retry may have removed the conversation.
    const relationships = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const [field, value] of [['chefId', id], ...job.locationIds.map(locationId => ['locationId', locationId])] as Array<[string, number]>) {
      const snapshot = await firestore.collection('chatRelationships').where(field, '==', value).get();
      for (const doc of snapshot.docs) {
        const conversationId = doc.data().conversationId;
        if (typeof conversationId === 'string')
          conversations.set(conversationId, firestore.collection('conversations').doc(conversationId));
        relationships.set(doc.id, doc.ref);
      }
    }
    for (const conversation of Array.from(conversations.values())) {
      const attachments = await firestore.collection('chatAttachments').where('conversationId', '==', conversation.id).get();
      for (const doc of attachments.docs) await firestore.recursiveDelete(doc.ref);
      await firestore.recursiveDelete(conversation);
    }
    for (const relationship of Array.from(relationships.values())) await firestore.recursiveDelete(relationship);
    const ownAttachments = await firestore.collection('chatAttachments').where('uploaderId', '==', id).get();
    for (const doc of ownAttachments.docs) await firestore.recursiveDelete(doc.ref);
    if (job.firebaseUid) await firestore.recursiveDelete(firestore.collection('users').doc(job.firebaseUid));
    await db.execute(sql`DELETE FROM user_deletion_jobs WHERE user_id = ${id}`);
  } catch (error: any) {
    throw new Error(`Database records deleted; external cleanup is pending. Retry Complete Delete to finish. ${error.message}`);
  }
}
