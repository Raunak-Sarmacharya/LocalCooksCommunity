import { createChatNoticeTrigger } from './chat-trigger';

// Only this staging export is exposed by the deployment entry point.
export const onNewStagingChatMessage = createChatNoticeTrigger('staging', 'STAGING_DATABASE_URL', 'us-central1');
