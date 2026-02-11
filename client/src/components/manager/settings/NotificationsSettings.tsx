/**
 * Notifications Settings Component
 * Manages email and phone notification preferences
 */

import { useState, useEffect, useCallback } from 'react';
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
        <h2 className="text-2xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground">
          Configure where booking notifications will be sent for {location.name}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-purple-600" />
            <div>
              <CardTitle className="text-lg">Notification Settings</CardTitle>
              <CardDescription>
                Configure where booking notifications will be sent. If left empty, notifications will go to the manager's account email.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="notification-email">Email Address</Label>
            <div className="flex items-center gap-2 mt-1.5">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Input
                id="notification-email"
                type="email"
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                placeholder="notifications@localcooks.com"
                className="max-w-md"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              All booking notifications for this location will be sent to this email address
            </p>
          </div>

          <div>
            <Label htmlFor="notification-phone">Phone Number (for SMS notifications)</Label>
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
            <p className="text-xs text-muted-foreground mt-1.5">
              SMS notifications for bookings and cancellations will be sent to this phone number. If left empty, SMS will not be sent.
            </p>
          </div>

          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h4 className="font-medium text-purple-900 mb-2">Notification Types</h4>
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
            labels={{ idle: "Save Notification Settings", loading: "Saving", success: "Saved" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
