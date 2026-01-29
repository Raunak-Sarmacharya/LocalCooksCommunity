
import dotenv from 'dotenv';
import path from 'path';

// Explicitly load .env file from root
dotenv.config({ path: path.join(process.cwd(), '.env') });

console.log('Environment loaded.');

import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, cert } from 'firebase-admin/app';

/**
 * Script to clean up conversations for a specific missing location ID.
 * Usage: npx tsx server/scripts/cleanup-standalone.ts
 */
async function cleanupStandalone(locationId: number) {
    console.log(`Starting standalone cleanup for Location ID: ${locationId}...`);

    // Initialize Firebase Admin manually
    let app;
    try {
        const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;

        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            console.log('Using service account credentials...');
            app = initializeApp({
                credential: cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
                projectId: process.env.FIREBASE_PROJECT_ID,
            }, 'cleanup-app');
        } else {
            console.log(`Using default credentials (project ID: ${projectId})...`);
            // Note: This might fail effectively if no default creds are present on the machine,
            // but we fallback to it if env vars are missing.
            app = initializeApp({
                projectId: projectId,
            }, 'cleanup-app');
        }
    } catch (err: any) {
        console.error('Failed to init app:', err);
        process.exit(1);
    }

    const adminDb = getFirestore(app);

    try {
        // 2. Query conversations for this location
        const conversationsSnapshot = await adminDb
            .collection('conversations')
            .where('locationId', '==', locationId)
            .get();

        console.log(`Found ${conversationsSnapshot.size} conversations for Location ${locationId}.`);

        if (conversationsSnapshot.empty) {
            console.log('No conversations found to clean up.');
            return;
        }

        // 3. Delete them
        let deletedCount = 0;

        for (const doc of conversationsSnapshot.docs) {
            const convId = doc.id;
            console.log(`Deleting conversation ${convId}...`);

            // Delete messages subcollection
            const messagesRef = adminDb.collection('conversations').doc(convId).collection('messages');
            const messagesSnapshot = await messagesRef.get();

            if (!messagesSnapshot.empty) {
                const batch = adminDb.batch();
                messagesSnapshot.docs.forEach(msgDoc => batch.delete(msgDoc.ref));
                await batch.commit();
                console.log(`  Deleted ${messagesSnapshot.size} messages.`);
            }

            // Delete conversation doc
            await adminDb.collection('conversations').doc(convId).delete();
            deletedCount++;
        }

        console.log(`Successfully deleted ${deletedCount} conversations.`);

    } catch (error) {
        console.error('Error during cleanup:', error);
    } finally {
        process.exit(0);
    }
}

// Run for Location 8
cleanupStandalone(8);
