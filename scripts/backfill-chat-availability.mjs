#!/usr/bin/env node
/**
 * Backfill `unavailable` onto Firestore conversations whose participant account
 * no longer exists in Postgres.
 *
 * WHY
 * ---
 * Conversations live in Firestore and accounts in Postgres, with no foreign key
 * between them. When an account is deleted through the admin routes the
 * conversation is now stamped `unavailable: true`. But every account deleted
 * before that stamp existed left a conversation still looking live — so managers
 * could open and reply to threads whose chef was long gone.
 *
 * The client also reconciles liveness on read (POST /api/firebase/chat/
 * participant-status), so this script is not required for correctness. It exists
 * to make the stored state honest, which keeps the delete path cheap and means a
 * conversation is correctly marked even if the client check is skipped.
 *
 * Idempotent: only touches conversations that are not already stamped, and only
 * ever sets the flag (never clears it), so re-running is safe.
 *
 * Usage:
 *   node scripts/backfill-chat-availability.mjs --dry-run
 *   node scripts/backfill-chat-availability.mjs
 */
import 'dotenv/config';
import pg from 'pg';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry-run');

const { Client } = pg;

function initFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
  }

  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');

  const firestore = initFirestore();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const snap = await firestore.collection('conversations').get();
    console.log(`Scanned ${snap.size} conversation(s)${DRY_RUN ? ' (dry run)' : ''}\n`);

    // Collect every participant id up front so liveness costs one query.
    const participantIds = new Set();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (Number.isInteger(d.chefId) && d.chefId > 0) participantIds.add(d.chefId);
      if (Number.isInteger(d.managerId) && d.managerId > 0) participantIds.add(d.managerId);
    }
    if (participantIds.size === 0) {
      console.log('No participants referenced. Nothing to do.');
      return;
    }

    const { rows } = await client.query(
      'SELECT id FROM users WHERE id = ANY($1::int[])',
      [[...participantIds]],
    );
    const alive = new Set(rows.map((r) => r.id));

    let toStamp = 0;
    let alreadyStamp = 0;
    const batch = firestore.batch();

    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.unavailable === true) {
        alreadyStamp += 1;
        continue;
      }

      const chefDead = Number.isInteger(d.chefId) && d.chefId > 0 && !alive.has(d.chefId);
      const managerDead = Number.isInteger(d.managerId) && d.managerId > 0 && !alive.has(d.managerId);
      if (!chefDead && !managerDead) continue;

      const role = chefDead ? 'chef' : 'manager';
      console.log(`  ${doc.id}  chef=${d.chefId} manager=${d.managerId} -> unavailable (${role} deleted)`);
      toStamp += 1;

      if (!DRY_RUN) {
        batch.set(
          doc.ref,
          {
            unavailable: true,
            unavailableReason: 'account_deleted',
            unavailableRole: role,
            unavailableAt: new Date(),
          },
          { merge: true },
        );
      }
    }

    if (toStamp > 0 && !DRY_RUN) {
      await batch.commit();
    }

    console.log(
      `\n${DRY_RUN ? 'Would stamp' : 'Stamped'} ${toStamp} conversation(s); ` +
        `${alreadyStamp} already marked; ${snap.size - toStamp - alreadyStamp} healthy.`,
    );
    if (DRY_RUN && toStamp > 0) console.log('Re-run without --dry-run to apply.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
