import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { auth } from "@/lib/firebase";
import { navigateNotificationHref } from "@/lib/navigate-notification-href";

type AdminNotification = {
  id: number;
  title: string;
  message: string;
  is_read: boolean;
  action_url: string | null;
  action_label: string | null;
  created_at: string;
};

async function adminNotificationsFetch(path: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(`/api/admin/notifications${path}`, {
    ...init,
    credentials: "include",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error("Could not load notifications");
  return response.json();
}

export function AdminNotificationCenter() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["admin-notifications-count"],
    queryFn: () => adminNotificationsFetch("/unread-count"),
    refetchInterval: 30_000,
  });
  const { data, isLoading, isError } = useQuery<{ notifications: AdminNotification[] }>({
    queryKey: ["admin-notifications"],
    queryFn: () => adminNotificationsFetch("/?limit=30"),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  async function openNotification(notification: AdminNotification) {
    if (!notification.is_read) {
      try {
        await adminNotificationsFetch("/mark-read", { method: "POST", body: JSON.stringify({ notificationIds: [notification.id] }) });
        void queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-notifications-count"] });
      } catch { /* Reading the detail still works when the read marker fails. */ }
    }
    setOpen(false);
    if (notification.action_url?.startsWith("/admin")) navigateNotificationHref(notification.action_url);
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={`Notifications${unread?.count ? `, ${unread.count} unread` : ""}`} className="relative h-8 w-8">
        <Bell className="h-4 w-4" />
        {!!unread?.count && <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">{unread.count > 99 ? "99+" : unread.count}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
      <div className="border-b px-4 py-3 font-semibold">Notifications</div>
      <div className="max-h-96 overflow-y-auto">
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading notifications…</p>}
        {isError && <p className="p-4 text-sm text-destructive">Could not load notifications.</p>}
        {!isLoading && !isError && !data?.notifications.length && <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>}
        {data?.notifications.map((notification) => <button key={notification.id} type="button" onClick={() => void openNotification(notification)} className={`block w-full border-b px-4 py-3 text-left hover:bg-muted ${notification.is_read ? "" : "bg-primary/5"}`}>
          <span className="block text-sm font-medium">{notification.title}</span>
          <span className="block text-xs text-muted-foreground">{notification.message}</span>
          <span className="mt-1 block text-xs text-primary">{notification.action_label || "View details"}</span>
        </button>)}
      </div>
    </PopoverContent>
  </Popover>;
}
