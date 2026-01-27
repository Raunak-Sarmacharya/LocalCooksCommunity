'use client';

import { Inbox } from '@novu/react';
import { useFirebaseAuth } from '@/hooks/use-auth';

interface NotificationInboxProps {
  subscriberId?: string;
}

export function NotificationInbox({ subscriberId }: NotificationInboxProps) {
  const { user } = useFirebaseAuth();
  
  const applicationIdentifier = import.meta.env.VITE_NOVU_APPLICATION_IDENTIFIER;
  const backendUrl = import.meta.env.VITE_NOVU_BACKEND_URL;
  const socketUrl = import.meta.env.VITE_NOVU_SOCKET_URL;

  const effectiveSubscriberId = subscriberId || user?.uid;

  if (!applicationIdentifier) {
    console.warn('Novu application identifier not configured');
    return null;
  }

  if (!effectiveSubscriberId) {
    return null;
  }

  return (
    <Inbox
      applicationIdentifier={applicationIdentifier}
      subscriberId={effectiveSubscriberId}
      {...(backendUrl && { backendUrl })}
      {...(socketUrl && { socketUrl })}
      appearance={{
        variables: {
          colorBackground: 'hsl(0 0% 100%)',
          colorForeground: 'hsl(20 14.3% 4.1%)',
          colorPrimary: 'hsl(347 91% 51%)',
          colorPrimaryForeground: 'hsl(0 0% 100%)',
          colorSecondary: 'hsl(60 4.8% 95.9%)',
          colorSecondaryForeground: 'hsl(25 5.3% 44.7%)',
          colorNeutral: 'hsl(20 5.9% 90%)',
          colorCounter: 'hsl(347 91% 51%)',
          colorCounterForeground: 'hsl(0 0% 100%)',
          fontSize: '14px',
          borderRadius: '0.5rem',
        },
        elements: {
          bellIcon: 'text-gray-600 hover:text-gray-900 transition-colors p-2 rounded-full hover:bg-gray-100',
          popoverContent: 'bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden',
          notificationItem: 'hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors',
          notificationItemBody: 'text-sm text-gray-700',
          notificationItemSubject: 'font-semibold text-gray-900',
          notificationItemTimestamp: 'text-xs text-gray-500',
          notificationItemUnread: 'bg-blue-50',
          notificationItemRead: 'bg-white',
          bellContainer: 'relative',
          bellDot: 'absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-red-500 rounded-full border-2 border-white',
        },
      }}
      placement="bottom-end"
      placementOffset={8}
    />
  );
}

export default NotificationInbox;
