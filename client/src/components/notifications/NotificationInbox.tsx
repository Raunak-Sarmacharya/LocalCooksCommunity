'use client';

import { Inbox as SuprSendInbox, SuprSendProvider } from '@suprsend/react';
import { useSuprSendVerification } from '../../hooks/use-suprsend';

interface NotificationInboxProps {
  subscriberId?: string;
}

export function NotificationInbox({ subscriberId }: NotificationInboxProps) {
  const { hmac, distinctId } = useSuprSendVerification(subscriberId);
  const workspaceKey = import.meta.env.VITE_SUPRSEND_WORKSPACE_KEY;

  if (!workspaceKey) {
    console.warn('SuprSend workspace key not configured');
    return null;
  }

  // hmac here is actually the userToken (JWT) now
  if (!distinctId || !hmac) {
    console.debug('[SuprSend] Waiting for verification...', { distinctId, hasToken: !!hmac });
    return null; 
  }

  console.log('[SuprSend] Render Inbox:', { 
    workspaceKey, 
    distinctId, 
    hasToken: !!hmac,
    tokenPrefix: hmac?.substring(0, 15) + '...'
  });

  // Basic validation for Workspace Key (usually 20-30 chars, alphanumeric)
  if (workspaceKey && (workspaceKey.length < 10 || workspaceKey.includes('PRIVATE KEY'))) {
      console.error('[SuprSend] Invalid Workspace Key detected. It should be the "Workspace Key" (public), NOT the Secret or Private Key.');
  }

  return (
    <SuprSendProvider
      publicApiKey={workspaceKey}
      distinctId={distinctId}
      userToken={hmac} // We stored userToken in the hmac variable
    >
      <SuprSendInbox 
        theme={{
            bell: { color: 'hsl(347 91% 51%)' },
            badge: { backgroundColor: 'hsl(347 91% 51%)', color: 'white' },
            header: { container: { backgroundColor: 'white' }, headerText: { color: 'hsl(20 14.3% 4.1%)' } }
        }}
      />
    </SuprSendProvider>
  );
}

export default NotificationInbox;
