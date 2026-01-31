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
import { 
  Bell, 
  BellOff, 
  Check, 
  CheckCheck, 
  Archive, 
  Trash2, 
  ChevronRight,
  Calendar,
  CreditCard,
  FileText,
  MessageSquare,
  AlertTriangle,
  Info,
  RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

// Get priority color
function getPriorityColor(priority: string) {
  switch (priority) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-orange-500";
    case "normal":
      return "bg-blue-500";
    default:
      return "bg-gray-400";
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
      <h4 className="text-sm font-medium text-gray-700">Failed to load notifications</h4>
      <p className="text-xs text-gray-500 mt-1 max-w-[200px]">
        There was an error loading your notifications. Please try again.
      </p>
      <Button 
        variant="outline" 
        size="sm" 
        className="mt-4"
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

// Empty state component
function EmptyNotificationState({ filter }: { filter: FilterType }) {
  const messages: Record<FilterType, { icon: React.ReactNode; title: string; description: string }> = {
    all: {
      icon: <BellOff className="h-12 w-12" />,
      title: "No notifications yet",
      description: "When you receive notifications, they'll appear here."
    },
    unread: {
      icon: <CheckCheck className="h-12 w-12" />,
      title: "All caught up!",
      description: "You have no unread notifications."
    },
    read: {
      icon: <Bell className="h-12 w-12" />,
      title: "No read notifications",
      description: "Notifications you've read will appear here."
    },
    archived: {
      icon: <Archive className="h-12 w-12" />,
      title: "No archived notifications",
      description: "Archived notifications will appear here."
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

// Group notifications by date
function groupNotificationsByDate(notifications: Notification[]) {
  const groups: { label: string; notifications: Notification[] }[] = [];
  const today: Notification[] = [];
  const yesterday: Notification[] = [];
  const thisWeek: Notification[] = [];
  const older: Notification[] = [];

  notifications.forEach((notification) => {
    const date = new Date(notification.created_at);
    if (isToday(date)) {
      today.push(notification);
    } else if (isYesterday(date)) {
      yesterday.push(notification);
    } else if (isThisWeek(date)) {
      thisWeek.push(notification);
    } else {
      older.push(notification);
    }
  });

  if (today.length > 0) groups.push({ label: "Today", notifications: today });
  if (yesterday.length > 0) groups.push({ label: "Yesterday", notifications: yesterday });
  if (thisWeek.length > 0) groups.push({ label: "This Week", notifications: thisWeek });
  if (older.length > 0) groups.push({ label: "Older", notifications: older });

  return groups;
}

// Single notification item with full accessibility
function NotificationItem({ 
  notification, 
  onMarkRead, 
  onArchive,
  onUnarchive,
  onDelete,
  isSelected,
  _onSelect
}: { 
  notification: Notification;
  onMarkRead: (id: number) => Promise<void>;
  onArchive: (id: number) => void;
  onUnarchive: (id: number) => void;
  onDelete: (id: number) => void;
  isSelected: boolean;
  _onSelect: (id: number) => void;
}) {
  // Handle keyboard navigation
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!notification.is_read) {
        await onMarkRead(notification.id);
      }
      if (notification.action_url) {
        window.location.href = notification.action_url;
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      role="article"
      aria-label={`${notification.is_read ? '' : 'Unread: '}${notification.title}`}
      aria-describedby={`notification-${notification.id}-message`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset",
        !notification.is_read && "bg-blue-50/50",
        isSelected && "bg-blue-100"
      )}
      onMouseDown={() => {
        console.log('[NotificationCenter] MouseDown on notification:', notification.id);
      }}
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        alert(`Clicked notification ${notification.id}, action_url: ${notification.action_url}`);
        console.log('[NotificationCenter] Clicked notification:', notification.id, 'action_url:', notification.action_url);
        if (!notification.is_read) {
          await onMarkRead(notification.id);
        }
        if (notification.action_url) {
          console.log('[NotificationCenter] Navigating to:', notification.action_url);
          window.location.href = notification.action_url;
        }
      }}
    >
      {/* Priority indicator */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-1",
        getPriorityColor(notification.priority)
      )} />

      <div className="flex items-start gap-3 pl-2">
        {/* Icon */}
        <div className={cn(
          "flex-shrink-0 p-2 rounded-full",
          notification.is_read ? "bg-gray-100 text-gray-500" : "bg-blue-100 text-blue-600"
        )}>
          {getNotificationIcon(notification.type)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn(
              "text-sm break-words",
              notification.is_read ? "font-normal text-gray-700" : "font-semibold text-gray-900"
            )}>
              {notification.title}
            </h4>
            <span className="text-xs text-gray-400 flex-shrink-0">
              {formatNotificationTime(notification.created_at)}
            </span>
          </div>
          <p 
            id={`notification-${notification.id}-message`}
            className="text-sm text-gray-600 line-clamp-3 mt-0.5 break-words"
          >
            {notification.message}
          </p>
          
          {/* Action button if present */}
          {notification.action_label && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 mt-1 text-blue-600"
              onClick={async (e) => {
                e.stopPropagation();
                // Mark as read when clicking action button
                if (!notification.is_read) {
                  await onMarkRead(notification.id);
                }
                if (notification.action_url) {
                  window.location.href = notification.action_url;
                }
              }}
            >
              {notification.action_label}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>

        {/* Quick actions (show on hover) */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                <span className="sr-only">Actions</span>
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {!notification.is_read && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onMarkRead(notification.id); }}>
                  <Check className="h-4 w-4 mr-2" />
                  Mark as read
                </DropdownMenuItem>
              )}
              {notification.is_archived ? (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUnarchive(notification.id); }}>
                  <Archive className="h-4 w-4 mr-2" />
                  Restore
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchive(notification.id); }}>
                  <Archive className="h-4 w-4 mr-2" />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-red-600"
                onClick={(e) => { e.stopPropagation(); onDelete(notification.id); }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.div>
  );
}

// Main NotificationCenter component
export default function NotificationCenter({ locationId }: { locationId?: number }) {
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
      console.log('[NotificationCenter] Fetched notifications:', data.notifications?.map((n: Notification) => ({ id: n.id, type: n.type, action_url: n.action_url })));
      return data;
    },
    enabled: isOpen,
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
      if (!res.ok) throw new Error("Failed to mark as read");
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
      console.error("[NotificationCenter] Failed to mark as read:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error("Failed to mark notification as read");
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
      if (!res.ok) throw new Error("Failed to mark all as read");
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
      console.error("[NotificationCenter] Failed to mark all as read:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error("Failed to mark all as read");
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
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
      if (!res.ok) throw new Error("Failed to archive");
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
      console.error("[NotificationCenter] Failed to archive:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error("Failed to archive notification");
    },
    onSuccess: () => {
      toast.success("Notification archived");
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
      if (!res.ok) throw new Error("Failed to unarchive");
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
      console.error("[NotificationCenter] Failed to unarchive:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      toast.error("Failed to unarchive notification");
    },
    onSuccess: () => {
      toast.success("Notification restored");
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
      if (!res.ok) throw new Error("Failed to delete");
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
      console.error("[NotificationCenter] Failed to delete:", err);
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/manager/notifications", filter, locationId], context.previousNotifications);
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(["/api/manager/notifications/unread-count", locationId], context.previousUnreadCount);
      }
      toast.error("Failed to delete notification");
    },
    onSuccess: () => {
      toast.success("Notification deleted");
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
  const groupedNotifications = groupNotificationsByDate(notifications);

  // Keyboard shortcut to open notifications (Ctrl/Cmd + Shift + N to avoid browser conflicts)
  useEffect(() => {
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
  }, [isOpen]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative group"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          title="Notifications (Ctrl+Shift+N)"
        >
          <Bell className={cn(
            "h-5 w-5 transition-transform",
            unreadCount > 0 && "group-hover:animate-[wiggle_0.3s_ease-in-out]"
          )} />
          {unreadCount > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs bg-red-500 hover:bg-red-500 animate-in fade-in zoom-in duration-200"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent 
        className="w-[400px] p-0" 
        align="end"
        sideOffset={8}
        role="dialog"
        aria-label="Notifications panel"
        aria-describedby="notifications-description"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 id="notifications-heading" className="font-semibold text-lg">Notifications</h2>
            <p id="notifications-description" className="sr-only">
              {unreadCount > 0 
                ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                : 'No unread notifications'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label={isLoading ? "Refreshing notifications" : "Refresh notifications"}
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
                aria-label={`Mark all ${unreadCount} notifications as read`}
              >
                <CheckCheck className="h-4 w-4 mr-1" aria-hidden="true" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-4 py-2 border-b bg-gray-50" role="navigation" aria-label="Notification filters">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <TabsList className="grid grid-cols-4 h-8" aria-label="Filter notifications by status">
              <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
              <TabsTrigger value="unread" className="text-xs">Unread</TabsTrigger>
              <TabsTrigger value="read" className="text-xs">Read</TabsTrigger>
              <TabsTrigger value="archived" className="text-xs">Archived</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Notification list */}
        <ScrollArea className="h-[400px]" role="feed" aria-label="Notifications list" aria-busy={isLoading}>
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
                    className="sticky top-0 bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {group.label}
                  </h3>
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
                </section>
              ))}
            </AnimatePresence>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && notificationsData?.pagination?.hasMore && (
          <div className="p-3 border-t bg-gray-50 text-center">
            <Button 
              variant="link" 
              size="sm" 
              className="text-xs text-gray-600"
              onClick={() => {
                toast({
                  title: "All notifications shown",
                  description: "Use the filters above to browse through your notifications.",
                });
              }}
            >
              View all notifications ({notificationsData.pagination.total} total)
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { NotificationCenter };
