/**
 * Notifications Settings Component
 * Manages email and phone notification preferences
 */

import { useState, useEffect, useCallback } from 'react';
import { mt } from "@/i18n/manager";
import { Mail, Phone } from 'lucide-react';
import { StatusButton } from '@/components/ui/status-button';
import { useStatusButton } from '@/hooks/use-status-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Location {
  id: number;
  name: string;
  notificationEmail?: string;
  notificationPhone?: string;
}

interface NotificationsSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
}

export default function NotificationsSettings({ location, onSave }: NotificationsSettingsProps) {
  
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || '');
  const [notificationPhone, setNotificationPhone] = useState(location.notificationPhone || '');

  useEffect(() => {
    setNotificationEmail(location.notificationEmail || '');
    setNotificationPhone(location.notificationPhone || '');
  }, [location]);

  const saveAction = useStatusButton(
    useCallback(async () => {
      await onSave({
        locationId: location.id,
        notificationEmail: notificationEmail || undefined,
        notificationPhone: notificationPhone || undefined,
      });
    }, [onSave, location.id, notificationEmail, notificationPhone]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{mt("navNotifications")}</h2>
        <p className="text-muted-foreground">
          Configure where booking notifications will be sent for {location.name}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-purple-600" />
            <div>
              <CardTitle className="text-lg">{mt("notificationSettings")}</CardTitle>
              <CardDescription>{mt("configureWhereBookingNotificationsWillBeSentIfLeftEmptyNotif")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="notification-email">{mt("emailAddress")}</Label>
            <div className="flex items-center gap-2 mt-1.5">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Input
                id="notification-email"
                type="email"
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                placeholder={mt("notificationsLocalcooksCom")}
                className="max-w-md"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{mt("allBookingNotificationsForThisLocationWillBeSentToThisEmailA")}</p>
          </div>

          <div>
            <Label htmlFor="notification-phone">{mt("phoneNumberForSMSNotifications")}</Label>
            <div className="flex items-center gap-2 mt-1.5">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <Input
                id="notification-phone"
                type="tel"
                value={notificationPhone}
                onChange={(e) => setNotificationPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="max-w-md"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{mt("sMSNotificationsForBookingsAndCancellationsWillBeSentToThisP")}</p>
          </div>

          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h4 className="font-medium text-purple-900 mb-2">{mt("notificationTypes")}</h4>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• New booking confirmations</li>
              <li>• Booking cancellations</li>
              <li>• Booking modifications</li>
              <li>• Chef application updates</li>
            </ul>
          </div>

          <StatusButton
            status={saveAction.status}
            onClick={saveAction.execute}
            labels={{ idle: mt("saveNotificationSettings"), loading: mt("savingShort"), success: mt("saved") }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
