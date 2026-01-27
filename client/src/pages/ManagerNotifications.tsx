import { useState } from "react";
import { useLocation } from "wouter";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { Card, CardContent } from '@/components/ui/card';
import { Bell } from 'lucide-react';
import { NotificationInbox } from '@/components/notifications/NotificationInbox';
import DashboardLayout from '@/layouts/DashboardLayout';

export default function ManagerNotifications() {
  const [, setLocation] = useLocation();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [selectedLocation, setSelectedLocation] = useState<any | null>(null);

  // Auto-select location if only one exists
  if (!isLoadingLocations && locations && locations.length === 1 && !selectedLocation) {
    setSelectedLocation(locations[0]);
  }

  const handleViewChange = (view: string) => {
    if (view === "notifications") return;
    setLocation(`/manager/dashboard?view=${view}`);
  };

  return (
    <DashboardLayout 
      activeView="notifications"
      onViewChange={handleViewChange}
      locations={locations}
      selectedLocation={selectedLocation}
      onLocationChange={setSelectedLocation}
    >
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
          </div>
        </div>

        <div className="flex justify-end mb-4">
          <TestNotificationButton />
        </div>

        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center min-h-[400px]">
            <div className="scale-150 mb-4">
               <NotificationInbox />
            </div>
            <p className="text-gray-500 mt-4 text-center">
              Click the bell icon to view your notifications.<br/>
              (Full page notification view is currently being upgraded)
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';

function TestNotificationButton() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Not authenticated");

        const res = await fetch('/api/suprsend/trigger-test', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();

        if (res.ok) {
            toast({ title: "Test Sent!", description: "Check your bell icon in a few seconds." });
        } else {
            throw new Error(data.error || "Failed to send");
        }
    } catch (e: any) {
        toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
        setLoading(false);
    }
  };

  return (
    <Button onClick={handleTest} disabled={loading} variant="secondary">
      {loading ? "Sending..." : "Send Test Notification"}
    </Button>
  );
}
