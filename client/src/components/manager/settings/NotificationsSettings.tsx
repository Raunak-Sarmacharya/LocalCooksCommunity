/**
 * Notifications Settings Component
 * Manages email notification preferences
 */

import { useState, useEffect, useCallback } from "react";
import { mt } from "@/i18n/manager";
import { Mail } from "@/components/ui/manager-icons";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Location {
  id: number;
  name: string;
  notificationEmail?: string;
}

interface NotificationsSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
  embedded?: boolean;
}

export default function NotificationsSettings({ location, onSave, embedded = false }: NotificationsSettingsProps) {
  
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || '');
  const isDirty = notificationEmail !== (location.notificationEmail || '');

  useEffect(() => {
    setNotificationEmail(location.notificationEmail || '');
  }, [location]);

  const saveAction = useStatusButton(
    useCallback(async () => {
      await onSave({
        locationId: location.id,
        notificationEmail: notificationEmail.trim(),
      });
    }, [onSave, location.id, notificationEmail]),
  );

  return (
    <div className="space-y-4">
      {!embedded && <div>
        <h2 className="text-xl font-semibold tracking-tight">{mt("navNotifications")}</h2>
        <p className="text-muted-foreground">
          {mt("configureNotificationsForLocation", { name: location.name })}
        </p>
      </div>}

      <Card>
        <CardHeader className="p-4 pb-3">
          <div>
            <div>
              <CardTitle className="text-lg">{mt("notificationSettings")}</CardTitle>
              <CardDescription>{mt("configureWhereBookingNotificationsWillBeSentIfLeftEmptyNotif")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
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

          <div className="rounded-lg border bg-muted/40 p-4">
            <h4 className="mb-2 font-medium text-foreground">{mt("notificationTypes")}</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• {mt("notifTypeNewBookingConfirmations")}</li>
              <li>• {mt("notifTypeBookingCancellations")}</li>
              <li>• {mt("notifTypeBookingModifications")}</li>
              <li>• {mt("notifTypeChefApplicationUpdates")}</li>
            </ul>
          </div>

          <div className="flex justify-end pt-2">
            <StatusButton
              status={saveAction.status}
              onClick={saveAction.execute}
              disabled={!isDirty}
              labels={{ idle: mt("saveNotificationSettings"), loading: mt("savingShort"), success: mt("saved") }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
