
import { db } from '../db';
import { locations } from '@shared/schema';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '../firebase-setup';
import { inArray } from 'drizzle-orm';

/**
 * Script to clean up orphaned conversations in Firestore
 * where the associated location no longer exists in Postgres.
 */
async function cleanupOrphanedConversations() {
    console.log('Starting cleanup of orphaned conversations...');

    // 1. Initialize Firebase Admin
    const app = initializeFirebaseAdmin();
    if (!app) {
        console.error('Failed to initialize Firebase Admin');
        process.exit(1);
    }
    const adminDb = getFirestore(app);

    try {
        // 2. Fetch all conversations from Firestore
        // Note: If you have thousands, you might want to paginate, but for cleanup this is fine.
        const conversationsSnapshot = await adminDb.collection('conversations').get();
        console.log(`Found ${conversationsSnapshot.size} conversations in Firestore.`);

        if (conversationsSnapshot.empty) {
            console.log('No conversations found.');
            return;
        }

        // 3. Collect unique Location IDs
        const locationIds = new Set<number>();
        const conversationMap = new Map<string, number>(); // convId -> locationId

        conversationsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.locationId) {
                locationIds.add(data.locationId);
                conversationMap.set(doc.id, data.locationId);
            }
        });

        const uniqueLocationIds = Array.from(locationIds);
        console.log(`Found ${uniqueLocationIds.length} unique location IDs referenced.`);

        // 4. Check which locations exist in Postgres
        // We process in batches of 100 to check existence
        const validLocationIds = new Set<number>();

        // Batch processing helper
        const batchSize = 100;
        for (let i = 0; i < uniqueLocationIds.length; i += batchSize) {
            const batchIds = uniqueLocationIds.slice(i, i + batchSize);

            const foundLocations = await db
                .select({ id: locations.id })
                .from(locations)
                .where(inArray(locations.id, batchIds));

            foundLocations.forEach(loc => validLocationIds.add(loc.id));
        }

        console.log(`Found ${validLocationIds.size} valid locations in Postgres.`);

        // 5. Identify orphaned conversations
        const orphanedConversations: string[] = [];
        conversationMap.forEach((locId, convId) => {
            if (!validLocationIds.has(locId)) {
                console.log(`Orphaned Conversation: ${convId} (Location ID: ${locId})`);
                orphanedConversations.push(convId);
            }
        });

        console.log(`Found ${orphanedConversations.length} orphaned conversations to delete.`);

        if (orphanedConversations.length === 0) {
            console.log('No orphaned conversations found. Exiting.');
            return;
        }

        // 6. Delete orphaned conversations
        // We can use the existing deleteConversation logic or simple delete here
        // Let's do a simple batch delete of the conversation document and its subcollection 'messages'

        let deletedCount = 0;

        for (const convId of orphanedConversations) {
            console.log(`Deleting conversation ${convId}...`);

            // Delete messages subcollection
            const messagesRef = adminDb.collection('conversations').doc(convId).collection('messages');
            const messagesSnapshot = await messagesRef.get();

            if (!messagesSnapshot.empty) {
                const batch = adminDb.batch();
                messagesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                console.log(`  Deleted ${messagesSnapshot.size} messages.`);
            }

            // Delete conversation doc
            await adminDb.collection('conversations').doc(convId).delete();
            deletedCount++;
        }

        console.log(`Successfully deleted ${deletedCount} orphaned conversations.`);

    } catch (error) {
        console.error('Error during cleanup:', error);
    } finally {
        process.exit(0);
    }
}

// Run the script
cleanupOrphanedConversations();
