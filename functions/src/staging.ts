import { createChatNoticeTrigger } from './chat-trigger';

// Only this staging export is exposed by the deployment entry point.
export const onNewStagingChatMessage = createChatNoticeTrigger('staging', 'STAGING_DATABASE_URL', 'us-central1', [
  // Server credential identity, verified against IAM. These are public account
  // identifiers, not credentials. Rotation to another writer requires review.
  'firebase-adminsdk-fbsvc@formauth-9e620.iam.gserviceaccount.com',
  '104768754596329400480',
]);
