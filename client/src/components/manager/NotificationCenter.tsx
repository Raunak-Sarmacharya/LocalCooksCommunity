import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { resolveNotificationHref } from "@shared/notification-deep-links";
import { navigateNotificationHref } from "@/lib/navigate-notification-href";
/**
 * Enterprise-Grade Notification Center Component
 * 
 * A popout notification panel for the manager portal featuring:
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellOff, Check, CheckCheck, Archive, Trash2, ChevronRight, Calendar, CreditCard, FileText, MessageSquare, AlertTriangle, Info, RefreshCw } from "@/components/ui/manager-icons";
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
import { formatDistanceToNow, format, isToday, isYesterday, isThisWeek } from "date-fns";

// Types
interface Notification {
  id: number;
  manager_id: number;
  location_id: number | null;
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
    case "booking_new":
    case "booking_confirmed":
    case "booking_cancelled":
      return <Calendar className="h-4 w-4" />;
    case "payment_received":
    case "payment_failed":
      return <CreditCard className="h-4 w-4" />;
    case "application_new":
    case "application_approved":
    case "application_rejected":
      return <FileText className="h-4 w-4" />;
    case "message_received":
      return <MessageSquare className="h-4 w-4" />;
    case "license_expiring":
    case "storage_expiring":
    case "storage_expired":
      return <AlertTriangle className="h-4 w-4" />;
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
    default:
      return "default";
  }
}

// Format notification time
function formatNotificationTime(dateStr: string) {
  const date = new Date(dateStr);
  if (isToday(date)) {
    return formatDistanceToNow(date, { addSuffix: true });
  }
  if (isYesterday(date)) {
    return `Yesterday at ${format(date, "h:mm a")}`;
  }
  if (isThisWeek(date)) {
    return format(date, "EEEE 'at' h:mm a");
  }
  return format(date, "MMM d 'at' h:mm a");
}

// Skeleton loading component for notifications
function NotificationItemSkeleton() {
  return (
    <div className="p-3 border-b border-gray-100">
      <div className="flex items-start gap-3 pl-2">
        <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: 5 }).map((_, i) => (
        <NotificationItemSkeleton key={i} />
      ))}
    </div>
  );
}

// Error state component
function ErrorNotificationState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-60 px-6 text-center">
      <div className="text-red-300 mb-4">
        <AlertTriangle className="h-12 w-12" />
      </div>
      <h4 className="text-sm font-medium text-gray-700">{mt("failedToLoadNotifications")}</h4>
      <p className="text-xs text-gray-500 mt-1 max-w-[200px]">{mt("thereWasAnErrorLoadingYourNotificationsPleaseTryAgain")}</p>
      <Button 
        variant="outline" 
        size="sm" 
        className="mt-4"
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4 mr-2" />{mt("tryAgain")}</Button>
    </div>
  );
}

// Empty state component
function EmptyNotificationState({ filter }: { filter: FilterType }) {
  const messages: Record<FilterType, { icon: React.ReactNode; title: string; description: string }> = {
    all: {
      icon: <BellOff className="h-12 w-12" />,
      title: mt("noNotificationsYet"),
      description: mt("noNotificationsYetDesc")
    },
    unread: {
      icon: <CheckCheck className="h-12 w-12" />,
      title: mt("allCaughtUp"),
      description: mt("allCaughtUpNoUnread")
    },
    read: {
      icon: <Bell className="h-12 w-12" />,
      title: mt("noReadNotifications"),
      description: mt("noReadNotificationsDesc")
    },
    archived: {
      icon: <Archive className="h-12 w-12" />,
      title: mt("noArchivedNotifications"),
      description: mt("noArchivedNotificationsDesc")
    }
  };

  const { icon, title, description } = messages[filter];

  return (
    <div className="flex flex-col items-center justify-center h-60 px-6 text-center">
      <div className="text-gray-300 mb-4">{icon}</div>
      <h4 className="text-sm font-medium text-gray-700">{title}</h4>
      <p className="text-xs text-gray-500 mt-1 max-w-[200px]">{description}</p>
    </div>
  );
}

// Group notifications by status
function groupNotificationsByStatus(notifications: Notification[]) {
  const groups: { label: string; notifications: Notification[] }[] = [];
  const unread: Notification[] = [];
  const earlier: Notification[] = [];

  notifications.forEach((notification) => {
    if (!notification.is_read) {
      unread.push(notification);
    } else {
      earlier.push(notification);
    }
  });

  if (unread.length > 0) groups.push({ label: mt("groupUnread"), notifications: unread });
  if (earlier.length > 0) groups.push({ label: mt("groupEarlier"), notifications: earlier });

  return groups;
}

// Single notification item with full accessibility
function NotificationItem({ 
  notification, 
  onMarkRead, 
  onArchive,
  onUnarchive,
  onDelete,
  onActivate,
  isSelected,
  _onSelect
}: { 
  notification: Notification;
  onMarkRead: (id: number) => Promise<void>;
  onArchive: (id: number) => void;
  onUnarchive: (id: number) => void;
  onDelete: (id: number) => void;
  onActivate?: () => void;
  isSelected: boolean;
  _onSelect: (id: number) => void;
}) {
  const href = resolveNotificationHref({
    role: "manager",
    type: notification.type,
    actionUrl: notification.action_url,
    metadata: notification.metadata,
  });

  const openNotification = async () => {
    // Close before the async read mutation/navigation so the old overlay never
    // survives into the destination view.
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
          "border-none bg-transparent shadow-none hover:bg-muted/50 transition-colors cursor-pointer relative rounded-none p-2 gap-y-0 items-center",
          "grid-cols-[24px_1fr_24px] has-[>svg]:grid-cols-[24px_1fr_24px]",
          !notification.is_read && "bg-muted/20",
          isSelected && "bg-blue-50"
        )}
        onClick={(e) => {
          e.stopPropagation();
          void openNotification();
        }}
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

// Main NotificationCenter component
type NotificationCenterProps = {
  locationId?: number;
  variant?: "popover" | "page";
  onViewAll?: () => void;
};

export default function NotificationCenter({
  locationId,
  variant = "popover",
  onViewAll,
}: NotificationCenterProps) {
  
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Fetch unread count - poll more frequently when popover is open
  const { data: unreadData, isError: unreadError } = useQuery({
    queryKey: ["/api/manager/notifications/unread-count", locationId],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const url = locationId 
        ? `/api/manager/notifications/unread-count?locationId=${locationId}`
        : "/api/manager/notifications/unread-count";
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch unread count: ${res.status}`);
      }
      return res.json();
    },
    refetchInterval: isOpen ? 10000 : 30000, // Poll every 10s when open, 30s when closed
    retry: 2,
    staleTime: 5000, // Consider data fresh for 5 seconds
  });

  // Fetch notifications
  const { data: notificationsData, isLoading, isError: notificationsError, refetch } = useQuery<NotificationResponse>({
    queryKey: ["/api/manager/notifications", filter, locationId],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ filter });
      if (locationId) params.append("locationId", String(locationId));
      const url = `/api/manager/notifications?${params}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch notifications: ${res.status}`);
      }
      const data = await res.json();
      return data;
    },
    enabled: isOpen || variant === "page",
    retry: false,
  });

  // Mark as read mutation with optimistic updates
  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/manager/notifications/mark-read", {
        method: "POST",
        headers,
        body: JSON.stringify({ notificationIds: ids }),
      });
      if (!res.ok) throw new Error(tt("failedToMarkAsRead"));
      return res.json();
    },
    // Optimistic update: immediately mark as read in the UI
    onMutate: async (ids: number[]) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications", filter, locationId] });
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications/unread-count", locationId] });

      // Snapshot the previous values
      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId]);

      // Optimistically update notifications
      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.map(n =>
            ids.includes(n.id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
          ),
        });
      }

      // Optimistically update unread count
      if (previousUnreadCount) {
        const newCount = Math.max(0, previousUnreadCount.count - ids.length);
        queryClient.setQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId], { count: newCount });
      }

      return { previousNotifications, previousUnreadCount };
    },
    // Rollback on error
    onError: (err, ids, context) => {
      logger.error("[NotificationCenter] Failed to mark as read:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error(tt("failedToMarkAsRead"));
    },
    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications/unread-count"] });
    },
  });

  // Mark all as read mutation with optimistic updates
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/manager/notifications/mark-all-read", {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId }),
      });
      if (!res.ok) throw new Error(mt("failedToMarkAllAsRead"));
      return res.json();
    },
    // Optimistic update: immediately mark all as read
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications", filter, locationId] });
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications/unread-count", locationId] });

      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId]);

      // Optimistically mark all as read
      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
        });
      }

      // Set unread count to 0
      queryClient.setQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId], { count: 0 });

      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, _, context) => {
      logger.error("[NotificationCenter] Failed to mark all as read:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error(tt("failedToMarkAllAsRead"));
    },
    onSuccess: () => {
      toast.success(tt("allNotificationsMarkedAsRead"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications/unread-count"] });
    },
  });

  // Archive mutation with optimistic updates
  const archiveMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/manager/notifications/archive", {
        method: "POST",
        headers,
        body: JSON.stringify({ notificationIds: ids }),
      });
      if (!res.ok) throw new Error(mt("failedToArchive"));
      return res.json();
    },
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications", filter, locationId] });
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications/unread-count", locationId] });
      
      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId]);
      
      // Count how many unread notifications are being archived
      const unreadBeingArchived = previousNotifications?.notifications.filter(
        n => ids.includes(n.id) && !n.is_read
      ).length || 0;
      
      // Optimistically remove archived notifications from the list
      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.filter(n => !ids.includes(n.id)),
        });
      }
      
      // Update unread count if any unread notifications were archived
      if (previousUnreadCount && unreadBeingArchived > 0) {
        queryClient.setQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId], {
          count: Math.max(0, previousUnreadCount.count - unreadBeingArchived)
        });
      }
      
      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, ids, context) => {
      logger.error("[NotificationCenter] Failed to archive:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error(tt("failedToArchiveNotification"));
    },
    onSuccess: () => {
      toast.success(tt("notificationArchived"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications/unread-count"] });
    },
  });

  // Unarchive mutation with optimistic updates
  const unarchiveMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/manager/notifications/unarchive", {
        method: "POST",
        headers,
        body: JSON.stringify({ notificationIds: ids }),
      });
      if (!res.ok) throw new Error(mt("failedToUnarchive"));
      return res.json();
    },
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications", filter, locationId] });
      
      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId]);
      
      // Optimistically remove unarchived notifications from the archived list
      if (previousNotifications && filter === "archived") {
        queryClient.setQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.filter(n => !ids.includes(n.id)),
        });
      }
      
      return { previousNotifications };
    },
    onError: (err, ids, context) => {
      logger.error("[NotificationCenter] Failed to unarchive:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      toast.error(tt("failedToUnarchiveNotification"));
    },
    onSuccess: () => {
      toast.success(tt("notificationRestored"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications/unread-count"] });
    },
  });

  // Delete mutation with optimistic updates
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/manager/notifications/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(mt("failedToDeleteNotification"));
      return res.json();
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications", filter, locationId] });
      await queryClient.cancelQueries({ queryKey: ["/api/manager/notifications/unread-count", locationId] });
      
      const previousNotifications = queryClient.getQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId]);
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId]);
      
      // Find the notification to check if it was unread
      const deletedNotification = previousNotifications?.notifications.find(n => n.id === id);
      
      // Optimistically remove deleted notification from the list
      if (previousNotifications) {
        queryClient.setQueryData<NotificationResponse>(["/api/manager/notifications", filter, locationId], {
          ...previousNotifications,
          notifications: previousNotifications.notifications.filter(n => n.id !== id),
        });
      }
      
      // Update unread count if the deleted notification was unread
      if (previousUnreadCount && deletedNotification && !deletedNotification.is_read) {
        queryClient.setQueryData<{ count: number }>(["/api/manager/notifications/unread-count", locationId], {
          count: Math.max(0, previousUnreadCount.count - 1)
        });
      }
      
      return { previousNotifications, previousUnreadCount };
    },
    onError: (err, id, context) => {
      logger.error("[NotificationCenter] Failed to delete:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error(tt("failedToDeleteNotification"));
    },
    onSuccess: () => {
      toast.success(tt("notificationDeleted"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/notifications/unread-count"] });
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

  const handleUnarchive = useCallback((id: number) => {
    unarchiveMutation.mutate([id]);
  }, [unarchiveMutation]);

  const handleDelete = useCallback((id: number) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const unreadCount = unreadData?.count || 0;
  const notifications = notificationsData?.notifications || [];
  const groupedNotifications = groupNotificationsByStatus(notifications);

  // Keyboard shortcut to open notifications (Ctrl/Cmd + Shift + N to avoid browser conflicts)
  useEffect(() => {
    if (variant === "page") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + N to toggle notifications
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          setIsOpen(prev => !prev);
        }
      }
      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, variant]);

  if (variant === "page") {
    return (
      <div className="overflow-hidden rounded-[1.35rem] border bg-card shadow-sm">
        <div className="border-b bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),transparent_55%)] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Bell className="size-5" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight">{mt("navNotifications")}</h1>
                {unreadCount > 0 && <Badge variant="secondary">{unreadCount} {mt("unread").toLowerCase()}</Badge>}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {mt("notificationCenterDescription")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={cn("mr-1 size-4", isLoading && "animate-spin")} aria-hidden="true" />
                {tt("refreshNotifications")}
              </Button>
              {unreadCount > 0 && (
                <Button size="sm" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
                  <CheckCheck className="mr-1 size-4" aria-hidden="true" />
                  {mt("markAllRead")}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="border-b bg-muted/50 px-4 py-2" role="navigation" aria-label={mt("notificationFilters")}>
          <Tabs value={filter} onValueChange={(value) => setFilter(value as FilterType)}>
            <TabsList className="w-full gap-1 sm:w-auto">
              <TabsTrigger value="all" className="flex-1 sm:flex-none">{mt("filterAll")}</TabsTrigger>
              <TabsTrigger value="unread" className="flex-1 sm:flex-none">{mt("unread")}</TabsTrigger>
              <TabsTrigger value="read" className="flex-1 sm:flex-none">{mt("read")}</TabsTrigger>
              <TabsTrigger value="archived" className="flex-1 sm:flex-none">{mt("archived")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="min-h-[28rem]" role="feed" aria-label={mt("notificationsList")} aria-busy={isLoading}>
          {isLoading ? (
            <NotificationListSkeleton />
          ) : notificationsError || unreadError ? (
            <ErrorNotificationState onRetry={() => refetch()} />
          ) : notifications.length === 0 ? (
            <EmptyNotificationState filter={filter} />
          ) : (
            <AnimatePresence mode="popLayout">
              {groupedNotifications.map((group) => (
                <section key={group.label} aria-labelledby={`page-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <h2 id={`page-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`} className="sticky top-0 z-10 bg-muted px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </h2>
                  <div className="flex flex-col">
                    {group.notifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onMarkRead={handleMarkRead}
                        onArchive={handleArchive}
                        onUnarchive={handleUnarchive}
                        onDelete={handleDelete}
                        isSelected={selectedIds.has(notification.id)}
                        _onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative group"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          title={mt("notificationsCtrlShiftN")}
        >
          <Bell className={cn(
            "h-5 w-5 transition-transform",
            unreadCount > 0 && "group-hover:animate-[wiggle_0.3s_ease-in-out]"
          )} />
          {unreadCount > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs bg-red-500 hover:bg-red-500 animate-in fade-in zoom-in duration-200 rounded-full"
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
        aria-label={mt("notificationsPanel")}
        aria-describedby="notifications-description"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div>
            <h2 id="notifications-heading" className="font-semibold text-lg">{mt("navNotifications")}</h2>
            <p id="notifications-description" className="sr-only">
              {unreadCount > 0 
                ? mt("unreadNotificationsCount", { count: unreadCount })
                : mt("noUnreadNotifications")}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label={isLoading ? tt("refreshingNotifications") : tt("refreshNotifications")}
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs rounded-full"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                aria-label={`Mark all ${unreadCount} notifications as read`}
              >
                <CheckCheck className="h-4 w-4 mr-1" aria-hidden="true" />{mt("markAllRead")}</Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-4 py-2 border-b bg-gray-50" role="navigation" aria-label={mt("notificationFilters")}>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <TabsList className="w-full gap-1" aria-label={mt("filterNotificationsByStatus")}>
              <TabsTrigger value="all" className="flex-1 text-xs px-2 py-1.5">{mt("filterAll")}</TabsTrigger>
              <TabsTrigger value="unread" className="flex-1 text-xs px-2 py-1.5">{mt("unread")}</TabsTrigger>
              <TabsTrigger value="read" className="flex-1 text-xs px-2 py-1.5">{mt("read")}</TabsTrigger>
              <TabsTrigger value="archived" className="flex-1 text-xs px-2 py-1.5">
                <span className="hidden sm:inline">{mt("archived")}</span>
                <span className="sm:hidden">{mt("arch")}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Notification list */}
        <ScrollArea className="h-[400px]" role="feed" aria-label={mt("notificationsList")} aria-busy={isLoading}>
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
                    className="sticky top-0 z-10 bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider"
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
                        onUnarchive={handleUnarchive}
                        onDelete={handleDelete}
                        onActivate={() => setIsOpen(false)}
                        isSelected={selectedIds.has(notification.id)}
                        _onSelect={handleSelect}
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
          <div className="p-3 border-t bg-gray-50 text-center">
            <Button 
              variant="link" 
              size="sm" 
              className="text-xs text-gray-600"
              onClick={() => {
                setIsOpen(false);
                onViewAll?.();
              }}
            >
              {mt("navNotifications")}{notificationsData?.pagination?.total ? ` (${notificationsData.pagination.total})` : ""}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { NotificationCenter };
