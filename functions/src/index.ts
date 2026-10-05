import { createChatNoticeTrigger } from './chat-trigger';

// Retained source for the production trigger; not the deployment entry point.
export const onNewChatMessage = createChatNoticeTrigger('(default)', 'DATABASE_URL', 'us-east1');
