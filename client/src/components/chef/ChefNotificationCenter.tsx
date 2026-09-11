import { logger } from "@/lib/logger";
/**
 * Enterprise-Grade Chef Notification Center Component
 * 
 * A popout notification panel for the chef portal featuring:
 * - Real-time unread count badge with polling
 * - Grouped notifications by priority and time
 * - Mark as read / archive / delete functionality
 * - Filtering by type and status
 * - Optimistic updates with rollback on error
 * - Full WCAG 2.1 AA accessibility compliance
 * - Keyboard navigation support
 * - Loading, error, and empty states
 * 
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/menu/
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellOff, Check, CheckCheck, Archive, Trash2, ChevronRight, Calendar, CreditCard, FileText, MessageSquare, AlertTriangle, Info, RefreshCw, GraduationCap, Package, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/reui/alert";
import { Frame, FramePanel } from "@/components/reui/frame";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { formatDistanceToNow, isToday, isYesterday, isThisWeek } from "date-fns";
import { tt } from "@/i18n/common-ns";
import { ct } from "@/i18n/chef-ns";
import { resolveNotificationHref } from "@shared/notification-deep-links";
import { navigateNotificationHref } from "@/lib/navigate-notification-href";
import { Icon } from "@iconify/react";
import { InfoChip } from "@/components/chef/info-chip";

// Types
interface Notification {
  id: number;
  chef_id: number;
  type: string;
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  is_archived: boolean;
  archived_at: string | null;
  action_url: string | null;
  action_label: string | null;
  created_at: string;
  expires_at: string | null;
}

interface NotificationResponse {
  notifications: Notification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

type FilterType = "all" | "unread" | "read" | "archived";

// Helper to get auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return { "Content-Type": "application/json" };
}

// Get icon for notification type
function getNotificationIcon(type: string) {
  switch (type) {
    case "booking_confirmed":
    case "booking_cancelled":
    case "booking_reminder":
      return <Calendar className="h-4 w-4" />;
    case "payment_received":
    case "payment_failed":
    case "payment_refunded":
      return <CreditCard className="h-4 w-4" />;
    case "application_approved":
    case "application_rejected":
    case "application_pending":
      return <FileText className="h-4 w-4" />;
    case "message_received":
      return <MessageSquare className="h-4 w-4" />;
    case "storage_expiring":
    case "storage_expired":
    case "storage_extension_approved":
    case "storage_extension_rejected":
      return <Package className="h-4 w-4" />;
    case "license_expiring":
    case "license_approved":
    case "license_rejected":
      return <AlertTriangle className="h-4 w-4" />;
    case "training_reminder":
      return <GraduationCap className="h-4 w-4" />;
    case "welcome":
      return <PartyPopper className="h-4 w-4" />;
    case "system_announcement":
    default:
      return <Info className="h-4 w-4" />;
  }
}

// Get priority variant for Alert
function getAlertVariant(priority: string) {
  switch (priority) {
    case "urgent":
      return "destructive";
    case "high":
      return "warning";
    case "normal":
      return "info";
    case "low":
    default:
      return "default";
  }
}

// Format notification time
function formatNotificationTime(dateString: string) {
  const date = new Date(dateString);
  return formatDistanceToNow(date, { addSuffix: true });
}

// Skeleton components
function NotificationItemSkeleton() {
  return (
    <div className="p-3 border-b border-border">
      <div className="flex items-start gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <NotificationItemSkeleton key={i} />
      ))}
    </div>
  );
}

// Error state component
function ErrorNotificationState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("chef");
  return (
    <div className="flex flex-col items-center justify-center h-60 px-6 text-center">
      <div className="text-muted-foreground mb-4">
        <AlertTriangle className="h-12 w-12" />
      </div>
      <h4 className="text-sm font-medium text-foreground">{t("notifErrorTitle", "Failed to load notifications")}</h4>
      <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
        {t("notifErrorDescription", "There was an error loading your notifications. Please try again.")}
      </p>
      <Button 
        variant="outline" 
        size="sm" 
        className="mt-4"
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        {t("notifTryAgain", "Try Again")}
      </Button>
    </div>
  );
}

// Empty state component
function EmptyNotificationState({ filter }: { filter: FilterType }) {
  const { t } = useTranslation("chef");
  const messages: Record<FilterType, { icon: React.ReactNode; title: string; description: string }> = {
    all: {
      icon: <BellOff className="h-12 w-12" />,
      title: t("notifEmptyAllTitle", "No notifications yet"),
      description: t("notifEmptyAllDescription", "When you receive notifications, they'll appear here.")
    },
    unread: {
      icon: <CheckCheck className="h-12 w-12" />,
      title: t("notifEmptyUnreadTitle", "All caught up!"),
      description: t("notifEmptyUnreadDescription", "You have no unread notifications.")
    },
    read: {
      icon: <Check className="h-12 w-12" />,
      title: t("notifEmptyReadTitle", "No read notifications"),
      description: t("notifEmptyReadDescription", "Notifications you've read will appear here.")
    },
    archived: {
      icon: <Archive className="h-12 w-12" />,
      title: t("notifEmptyArchivedTitle", "No archived notifications"),
      description: t("notifEmptyArchivedDescription", "Archived notifications will appear here.")
    }
  };

  const { icon, title, description } = messages[filter];

  return (
    <div className="flex flex-col items-center justify-center h-60 px-6 text-center">
      <div className="text-muted-foreground/40 mb-4">{icon}</div>
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">{description}</p>
    </div>
  );
}

// Group notifications by date
function groupNotificationsByDate(notifications: Notification[], t: TFunction<"chef">) {
  const groups: { label: string; notifications: Notification[] }[] = [];
  const today: Notification[] = [];
  const yesterday: Notification[] = [];
  const thisWeek: Notification[] = [];
  const older: Notification[] = [];

  notifications.forEach(n => {
    const date = new Date(n.created_at);
    if (isToday(date)) {
      today.push(n);
    } else if (isYesterday(date)) {
      yesterday.push(n);
    } else if (isThisWeek(date)) {
      thisWeek.push(n);
    } else {
      older.push(n);
    }
  });

  if (today.length > 0) groups.push({ label: t("notifGroupToday", "Today"), notifications: today });
  if (yesterday.length > 0) groups.push({ label: t("notifGroupYesterday", "Yesterday"), notifications: yesterday });
  if (thisWeek.length > 0) groups.push({ label: t("notifGroupThisWeek", "This Week"), notifications: thisWeek });
  if (older.length > 0) groups.push({ label: t("notifGroupOlder", "Older"), notifications: older });

  return groups;
}

// Single notification item with full accessibility
function NotificationItem({ 
  notification, 
  onMarkRead, 
  onArchive,
  onDelete,
  onActivate,
}: { 
  notification: Notification;
  onMarkRead: (id: number) => Promise<void>;
  onArchive: (id: number) => void;
  onDelete: (id: number) => void;
  onActivate?: () => void;
}) {
  const { t } = useTranslation("chef");
  const href = resolveNotificationHref({
    role: "chef",
    type: notification.type,
    actionUrl: notification.action_url,
    metadata: notification.metadata,
  });

  const openNotification = async () => {
    // Selection should dismiss the transient surface immediately. Do not make
    // closing the popover wait for the mark-as-read network request.
    onActivate?.();
    if (!notification.is_read) {
      await onMarkRead(notification.id);
    }
    if (href) navigateNotificationHref(href);
  };

  // Handle keyboard navigation
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      await openNotification();
    }
  };

  return (
    <div className="overflow-hidden relative group">
      <Alert
        variant={getAlertVariant(notification.priority)}
        className={cn(
          "border-none bg-transparent shadow-none hover:bg-muted/50 transition-colors cursor-pointer relative rounded-none p-3 gap-y-0 items-center",
          "grid-cols-[24px_1fr_24px] has-[>svg]:grid-cols-[24px_1fr_24px]",
          !notification.is_read && "bg-muted/20"
        )}
        onClick={() => { void openNotification(); }}
      >
        <div className={cn(
          "shrink-0",
          notification.is_read ? "text-muted-foreground" : "text-foreground"
        )}>
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex flex-col min-w-0 pr-2">
          <AlertTitle className="flex justify-between items-center gap-2 min-w-0 h-auto">
            <span className={cn("text-sm truncate flex-1 min-w-0", notification.is_read ? "font-normal text-foreground" : "font-semibold text-foreground")}>
              {notification.title}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap font-normal shrink-0">
              {formatNotificationTime(notification.created_at)}
            </span>
          </AlertTitle>
          
          <AlertDescription className="mt-0 min-w-0 block w-full">
            <p className="text-xs text-foreground/80 truncate w-full">
              {notification.message}
            </p>
          </AlertDescription>
        </div>
        <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-all transform translate-x-1 group-hover:translate-x-0">
          <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
        </div>
      </Alert>
    </div>
  );
}

// Main ChefNotificationCenter component
type ChefNotificationCenterProps = {
  variant?: "popover" | "page";
  onViewAll?: () => void;
};

export default function ChefNotificationCenter({
  variant = "popover",
  onViewAll,
}: ChefNotificationCenterProps) {
  const { t } = useTranslation("chef");
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const { user, loading: isAuthLoading } = useFirebaseAuth();
  
  // Only fetch when auth is ready and user is authenticated
  const isAuthReady = !isAuthLoading && !!user;

  // Fetch unread count - poll more frequently when popover is open
  const { data: unreadData, isError: unreadError } = useQuery({
    queryKey: ["/api/chef/notifications/unread-count"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/notifications/unread-count", { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch unread count: ${res.status}`);
      }
      return res.json();
    },
    enabled: isAuthReady,
    refetchInterval: isAuthReady ? (isOpen ? 10000 : 30000) : false,
    retry: 2,
    staleTime: 5000,
  });

  // Fetch notifications
  const { data: notificationsData, isLoading, isError: notificationsError, refetch } = useQuery<NotificationResponse>({
    queryKey: ["/api/chef/notifications", filter],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ filter });
      const url = `/api/chef/notifications?${params}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch notifications: ${res.status}`);
      }
      return res.json();
    },
    enabled: (isOpen || variant === "page") && isAuthReady,
    retry: false,
  });

  // Mark as read mutation with optimistic updates
  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/notifications/mark-read", {
        method: "POST",
        headers,
        body: JSON.stringify({ notificationIds: ids }),
      });
      if (!res.ok) throw new Error(tt("failedToMarkAsRead"));
      return res.json();
    },
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications", filter] });
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications/unread-count"] });

      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/chef/notifications", filter]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/chef/notifications/unread-count"]);

      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/chef/notifications", filter], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.map(n =>
            ids.includes(n.id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
          ),
        });
      }

      if (previousUnreadCount) {
        const newCount = Math.max(0, previousUnreadCount.count - ids.length);
        queryClient.setQueryData<{ count: number }>(["/api/chef/notifications/unread-count"], { count: newCount });
      }

      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, _ids, context) => {
      logger.error("[ChefNotificationCenter] Failed to mark as read:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/chef/notifications", filter], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/chef/notifications/unread-count"], context.previousUnreadCount);
      }
      toast.error(t("notifToastMarkReadError", "Failed to mark notification as read"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications/unread-count"] });
    },
  });

  // Mark all as read mutation with optimistic updates
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/notifications/mark-all-read", {
        method: "POST",
        headers,
      });
      if (!res.ok) throw new Error(ct("failedToMarkAllAsRead"));
      return res.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications", filter] });
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications/unread-count"] });

      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/chef/notifications", filter]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/chef/notifications/unread-count"]);

      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/chef/notifications", filter], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
        });
      }

      queryClient.setQueryData<{ count: number }>(["/api/chef/notifications/unread-count"], { count: 0 });

      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, _, context) => {
      logger.error("[ChefNotificationCenter] Failed to mark all as read:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/chef/notifications", filter], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/chef/notifications/unread-count"], context.previousUnreadCount);
      }
      toast.error(t("notifToastMarkAllReadError", "Failed to mark all as read"));
    },
    onSuccess: () => {
      toast.success(t("notifToastMarkAllReadSuccess", "All notifications marked as read"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications/unread-count"] });
    },
  });

  // Archive mutation with optimistic updates
  const archiveMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/notifications/archive", {
        method: "POST",
        headers,
        body: JSON.stringify({ notificationIds: ids }),
      });
      if (!res.ok) throw new Error(ct("failedToArchive"));
      return res.json();
    },
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications", filter] });
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications/unread-count"] });
      
      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/chef/notifications", filter]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/chef/notifications/unread-count"]);
      
      const unreadBeingArchived = previousNotifications?.notifications.filter(
        n => ids.includes(n.id) && !n.is_read
      ).length || 0;
      
      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/chef/notifications", filter], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.filter(n => !ids.includes(n.id)),
        });
      }
      
      if (previousUnreadCount && unreadBeingArchived > 0) {
        queryClient.setQueryData<{ count: number }>(["/api/chef/notifications/unread-count"], {
          count: Math.max(0, previousUnreadCount.count - unreadBeingArchived)
        });
      }
      
      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, _ids, context) => {
      logger.error("[ChefNotificationCenter] Failed to archive:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/chef/notifications", filter], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/chef/notifications/unread-count"], context.previousUnreadCount);
      }
      toast.error(t("notifToastArchiveError", "Failed to archive notification"));
    },
    onSuccess: () => {
      toast.success(t("notifToastArchiveSuccess", "Notification archived"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications/unread-count"] });
    },
  });

  // Delete mutation with optimistic updates
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/chef/notifications/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(ct("failedToDeleteNotification"));
      return res.json();
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications", filter] });
      await queryClient.cancelQueries({ queryKey: ["/api/chef/notifications/unread-count"] });
      
      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/chef/notifications", filter]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/chef/notifications/unread-count"]);
      
      const deletedNotification = previousNotifications?.notifications.find(n => n.id === id);
      
      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/chef/notifications", filter], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.filter(n => n.id !== id),
        });
      }
      
      if (previousUnreadCount && deletedNotification && !deletedNotification.is_read) {
        queryClient.setQueryData<{ count: number }>(["/api/chef/notifications/unread-count"], {
          count: Math.max(0, previousUnreadCount.count - 1)
        });
      }
      
      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, _id, context) => {
      logger.error("[ChefNotificationCenter] Failed to delete:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/chef/notifications", filter], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/chef/notifications/unread-count"], context.previousUnreadCount);
      }
      toast.error(t("notifToastDeleteError", "Failed to delete notification"));
    },
    onSuccess: () => {
      toast.success(t("notifToastDeleteSuccess", "Notification deleted"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/notifications/unread-count"] });
    },
  });

  const handleMarkRead = useCallback((id: number): Promise<void> => {
    return new Promise((resolve) => {
      markReadMutation.mutate([id], {
        onSettled: () => resolve(),
      });
    });
  }, [markReadMutation]);

  const handleArchive = useCallback((id: number) => {
    archiveMutation.mutate([id]);
  }, [archiveMutation]);

  const handleDelete = useCallback((id: number) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const unreadCount = unreadData?.count || 0;
  const notifications = notificationsData?.notifications || [];
  const groupedNotifications = groupNotificationsByDate(notifications, t);

  // Keyboard shortcut to open notifications (Ctrl/Cmd + Shift + N)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          setIsOpen(prev => !prev);
        }
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const notificationPanel = (
    <div className={cn(variant === "page" && "overflow-hidden rounded-[1.35rem] border bg-card shadow-sm")}>
      {variant === "page" && (
        <div className="border-b bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),transparent_55%)] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon icon="mdi:bell-outline" className="size-5" aria-hidden />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight">{t("notifPanelHeading", "Notifications")}</h1>
                {unreadCount > 0 && <InfoChip variant="count" icon={<Icon icon="mdi:email-alert-outline" />}>{unreadCount} {t("notifFilterUnread", "Unread").toLowerCase()}</InfoChip>}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {t("notifCenterDescription", "Review updates, messages, bookings, and account activity in one place.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <Icon icon="mdi:refresh" className={cn("size-4", isLoading && "animate-spin")} aria-hidden />
                {t("notifRefreshLabel", "Refresh notifications")}
              </Button>
              {unreadCount > 0 && (
                <Button size="sm" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
                  <Icon icon="mdi:check-all" className="size-4" aria-hidden />
                  {t("notifMarkAllReadButton", "Mark all read")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {variant === "page" && (
        <div className="min-h-[28rem]" role="feed" aria-label={t("notifListAriaLabel", "Notifications list")} aria-busy={isLoading}>
          {isLoading ? <NotificationListSkeleton /> : notificationsError || unreadError ? <ErrorNotificationState onRetry={() => refetch()} /> : notifications.length === 0 ? <EmptyNotificationState filter={filter} /> : (
            <AnimatePresence mode="popLayout">
              {groupedNotifications.map((group) => (
                <section key={group.label} aria-labelledby={`page-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <h3 id={`group-${group.label.toLowerCase().replace(/\s+/g, '-')}`} className="sticky top-0 bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {group.label}
                  </h3>
                  <div className="flex flex-col">
                    {group.notifications.map((notification) => <NotificationItem key={notification.id} notification={notification} onMarkRead={handleMarkRead} onArchive={handleArchive} onDelete={handleDelete} />)}
                  </div>
                </section>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}
    </div>
  );

  if (variant === "page") return notificationPanel;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative group"
          aria-label={unreadCount > 0 
            ? t("notifBellAriaLabelUnread", { count: unreadCount, defaultValue: "Notifications ({count} unread)" })
            : t("notifBellAriaLabel", "Notifications")}
          title={t("notifBellTitle", "Notifications (Ctrl+Shift+N)")}
        >
          <Bell className={cn(
            "h-5 w-5 transition-transform",
            unreadCount > 0 && "group-hover:animate-[wiggle_0.3s_ease-in-out]"
          )} />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs animate-in fade-in zoom-in duration-200"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent 
        className="w-[calc(100vw-2rem)] sm:w-[400px] p-0 rounded-[1.35rem] overflow-hidden" 
        align="end"
        sideOffset={8}
        role="dialog"
        aria-label={t("notifPanelAriaLabel", "Notifications panel")}
        aria-describedby="notifications-description"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 id="notifications-heading" className="font-semibold text-lg">{t("notifPanelHeading", "Notifications")}</h2>
            <p id="notifications-description" className="sr-only">
              {unreadCount > 0 
                ? t("notifSrDescriptionCount", { count: unreadCount, defaultValue: "{count, plural, one {You have # unread notification} other {You have # unread notifications}}" })
                : t("notifSrDescriptionEmpty", "No unread notifications")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label={isLoading ? t("notifRefreshingLabel", "Refreshing notifications") : t("notifRefreshLabel", "Refresh notifications")}
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                aria-label={t("notifMarkAllAriaLabel", { count: unreadCount, defaultValue: "{count, plural, one {Mark all # notification as read} other {Mark all # notifications as read}}" })}
              >
                <CheckCheck className="h-4 w-4 mr-1" aria-hidden="true" />
                {t("notifMarkAllReadButton", "Mark all read")}
              </Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-4 py-2 border-b bg-muted/50" role="navigation" aria-label={t("notifFiltersAriaLabel", "Notification filters")}>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <TabsList className="w-full gap-1" aria-label={t("notifFilterTabsAriaLabel", "Filter notifications by status")}>
              <TabsTrigger value="all" className="flex-1 text-xs px-2 py-1.5">{t("notifFilterAll", "All")}</TabsTrigger>
              <TabsTrigger value="unread" className="flex-1 text-xs px-2 py-1.5">{t("notifFilterUnread", "Unread")}</TabsTrigger>
              <TabsTrigger value="read" className="flex-1 text-xs px-2 py-1.5">{t("notifFilterRead", "Read")}</TabsTrigger>
              <TabsTrigger value="archived" className="flex-1 text-xs px-2 py-1.5">
                <span className="hidden sm:inline">{t("notifFilterArchived", "Archived")}</span>
                <span className="sm:hidden">{t("notifFilterArchivedShort", "Arch")}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Notification list */}
        <ScrollArea className="h-[400px]" role="feed" aria-label={t("notifListAriaLabel", "Notifications list")} aria-busy={isLoading}>
          {isLoading ? (
            <NotificationListSkeleton />
          ) : notificationsError || unreadError ? (
            <ErrorNotificationState onRetry={() => refetch()} />
          ) : notifications.length === 0 ? (
            <EmptyNotificationState filter={filter} />
          ) : (
            <AnimatePresence mode="popLayout">
              {groupedNotifications.map((group) => (
                <section key={group.label} aria-labelledby={`group-${group.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <h3 
                    id={`group-${group.label.toLowerCase().replace(/\s+/g, '-')}`}
                    className="sticky top-0 z-10 bg-muted px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    {group.label}
                  </h3>
                  <div className="flex flex-col">
                    {group.notifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onMarkRead={handleMarkRead}
                        onArchive={handleArchive}
                        onDelete={handleDelete}
                        onActivate={() => setIsOpen(false)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </AnimatePresence>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="p-3 border-t bg-muted/50 text-center">
            <Button variant="link" size="sm" className="text-xs text-muted-foreground" onClick={() => { setIsOpen(false); onViewAll?.(); }}>
              <Icon icon="mdi:bell-badge-outline" className="mr-1 size-4" aria-hidden />
              {t("notifViewAllButton", "View all notifications")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { ChefNotificationCenter };
