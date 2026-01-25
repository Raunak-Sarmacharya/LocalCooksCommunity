
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '../firebase-setup';

/**
 * Script to clean up conversations for a specific missing location ID.
 * Usage: npx tsx server/scripts/cleanup-specific-location.ts <locationId>
 */
async function cleanupSpecificLocation(locationId: number) {
    console.log(`Starting cleanup for Location ID: ${locationId}...`);

    // 1. Initialize Firebase Admin
    const app = initializeFirebaseAdmin();
    if (!app) {
        console.error('Failed to initialize Firebase Admin');
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

// Run for Location 8 (orphaned)
cleanupSpecificLocation(8);
