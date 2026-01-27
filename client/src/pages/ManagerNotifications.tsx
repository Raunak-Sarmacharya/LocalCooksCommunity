import { Inbox } from '@novu/react';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bell, Calendar, DollarSign, Users, Settings, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function ManagerNotifications() {
  const { user } = useFirebaseAuth();
  
  const applicationIdentifier = import.meta.env.VITE_NOVU_APPLICATION_IDENTIFIER;
  const backendUrl = import.meta.env.VITE_NOVU_BACKEND_URL;
  const socketUrl = import.meta.env.VITE_NOVU_SOCKET_URL;

  const subscriberId = user?.uid;

  if (!applicationIdentifier || !subscriberId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Notifications Not Available</h3>
            <p className="text-gray-600">
              {!applicationIdentifier 
                ? 'Notification service is not configured. Please contact support.'
                : 'Please sign in to view your notifications.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const notificationTabs = [
    { label: 'All', filter: { tags: [] }, icon: Bell },
    { label: 'Bookings', filter: { tags: ['booking'] }, icon: Calendar },
    { label: 'Payments', filter: { tags: ['payment'] }, icon: DollarSign },
    { label: 'Chefs', filter: { tags: ['chef', 'application'] }, icon: Users },
  ];

  const inboxAppearance = {
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
      root: 'w-full',
      bellIcon: 'hidden',
      popoverContent: 'static shadow-none border-0 w-full max-w-none',
      popoverTrigger: 'hidden',
      notificationItem: 'hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors p-4',
      notificationItemBody: 'text-sm text-gray-700',
      notificationItemSubject: 'font-semibold text-gray-900 text-base',
      notificationItemTimestamp: 'text-xs text-gray-500',
      notificationItemUnread: 'bg-blue-50/50 border-l-4 border-l-primary',
      notificationItemRead: 'bg-white',
      notificationsList: 'divide-y divide-gray-100',
      emptyState: 'py-12 text-center',
    },
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Bell className="h-8 w-8 text-primary" />
              Notifications
            </h1>
            <p className="text-gray-600 mt-2">
              Stay updated on bookings, payments, and chef applications
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            <Settings className="h-4 w-4" />
            Preferences
          </Button>
        </div>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          {notificationTabs.map((tab) => (
            <TabsTrigger 
              key={tab.label.toLowerCase()} 
              value={tab.label.toLowerCase()}
              className="flex items-center gap-2"
            >
              <tab.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {notificationTabs.map((tab) => (
          <TabsContent key={tab.label.toLowerCase()} value={tab.label.toLowerCase()}>
            <Card>
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <tab.icon className="h-5 w-5 text-primary" />
                      {tab.label} Notifications
                    </CardTitle>
                    <CardDescription>
                      {tab.label === 'All' && 'All your notifications in one place'}
                      {tab.label === 'Bookings' && 'New bookings, cancellations, and updates'}
                      {tab.label === 'Payments' && 'Payment confirmations and revenue updates'}
                      {tab.label === 'Chefs' && 'Chef applications and profile updates'}
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" className="text-primary gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Mark all read
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Inbox
                  applicationIdentifier={applicationIdentifier}
                  subscriberId={subscriberId}
                  {...(backendUrl && { backendUrl })}
                  {...(socketUrl && { socketUrl })}
                  tabs={[{ label: tab.label, filter: tab.filter }]}
                  appearance={inboxAppearance}
                  renderNotification={(notification) => (
                    <div 
                      className={`p-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors cursor-pointer ${
                        !notification.isRead ? 'bg-blue-50/50 border-l-4 border-l-primary' : ''
                      }`}
                      onClick={() => notification.read()}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-full ${
                          !notification.isRead ? 'bg-primary/10' : 'bg-gray-100'
                        }`}>
                          {tab.label === 'Bookings' && <Calendar className="h-4 w-4 text-primary" />}
                          {tab.label === 'Payments' && <DollarSign className="h-4 w-4 text-green-600" />}
                          {tab.label === 'Chefs' && <Users className="h-4 w-4 text-blue-600" />}
                          {tab.label === 'All' && <Bell className="h-4 w-4 text-gray-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-gray-900 text-sm truncate">
                              {notification.subject}
                            </h4>
                            {!notification.isRead && (
                              <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                                New
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {notification.body}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
