import { useState, useMemo, useEffect } from "react";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  X, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Building2, 
  ChevronDown, 
  ChevronUp, 
  Filter, 
  Package, 
  CalendarPlus, 
  Search, 
  ArrowUpDown, 
  Loader2, 
  FileText,
  CalendarDays,
  MoreHorizontal,
  Eye,
  Download,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEFAULT_TIMEZONE, isBookingUpcoming, isBookingPast } from "@/utils/timezone-utils";
import { useQuery } from "@tanstack/react-query";
import { StorageExtensionDialog } from "./StorageExtensionDialog";
import { ExpiringStorageNotification } from "./ExpiringStorageNotification";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { format, differenceInDays, startOfToday, isToday, isTomorrow, isThisWeek, startOfDay, parseISO, startOfWeek, addWeeks } from "date-fns";
import { cn } from "@/lib/utils";

interface Booking {
  id: number;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<string | { startTime: string; endTime: string }>; // Discrete time slots
  status: "pending" | "confirmed" | "cancelled";
  specialNotes?: string;
  createdAt: string;
  updatedAt: string;
  kitchenName?: string;
  locationName?: string;
  locationTimezone?: string;
  location?: {
    id: number;
    name: string;
    cancellationPolicyHours?: number;
    cancellationPolicyMessage?: string;
  };
}

interface ChefBookingsViewProps {
  bookings: Booking[];
  isLoading: boolean;
  onCancelBooking: (bookingId: number) => void;
  kitchens?: Array<{ id: number; name: string; locationName?: string }>;
}

type FilterType = "all" | "pending" | "confirmed" | "cancelled";
type ViewType = "upcoming" | "past" | "all";
type SortType = "date" | "kitchen" | "status";
type GroupType = "date" | "kitchen" | "none";

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error('Error getting Firebase token:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

export default function ChefBookingsView({
  bookings,
  isLoading,
  onCancelBooking,
  kitchens = [],
}: ChefBookingsViewProps) {
  const [statusFilter, setStatusFilter] = useState<FilterType>("all");
  const [viewType, setViewType] = useState<ViewType>("upcoming");
  const [expandedBookings, setExpandedBookings] = useState<Set<number>>(new Set());
  const [expandedStorageBookings, setExpandedStorageBookings] = useState<Set<number>>(new Set());
  const [extendDialogOpen, setExtendDialogOpen] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortType>("date");
  const [groupBy, setGroupBy] = useState<GroupType>("date");
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null);
  
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasAuthUser, setHasAuthUser] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthReady(true);
      setHasAuthUser(!!user);
    });
    return () => unsubscribe();
  }, []);

  const { data: storageBookings = [], isLoading: isLoadingStorage } = useQuery({
    queryKey: ['/api/chef/storage-bookings'],
    enabled: isAuthReady && hasAuthUser,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/storage-bookings', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch storage bookings');
      return response.json();
    },
  });

  const { upcomingBookings, pastBookings, allBookings } = useMemo(() => {
    const upcoming: Booking[] = [];
    const past: Booking[] = [];

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return { upcomingBookings: [], pastBookings: [], allBookings: [] };
    }

    bookings.forEach((booking) => {
      if (!booking || !booking.bookingDate || !booking.startTime || !booking.endTime) return;
      
      if (booking.status === 'cancelled') {
        past.push(booking);
        return;
      }
      
      try {
        const timezone = booking.locationTimezone || DEFAULT_TIMEZONE;
        const bookingDateStr = booking.bookingDate.split('T')[0];
        
        if (isBookingPast(bookingDateStr, booking.endTime, timezone)) {
          past.push(booking);
        } else if (isBookingUpcoming(bookingDateStr, booking.startTime, timezone)) {
          upcoming.push(booking);
        } else {
          upcoming.push(booking);
        }
      } catch (error) {
        try {
          const dateStr = booking.bookingDate.split('T')[0];
          const bookingEndDateTime = new Date(`${dateStr}T${booking.endTime}`);
          if (bookingEndDateTime < new Date()) {
            past.push(booking);
          } else {
            upcoming.push(booking);
          }
        } catch (fallbackError) {
          console.error('Error processing booking:', booking, error);
        }
      }
    });

    upcoming.sort((a, b) => {
      try {
        const dateStrA = a.bookingDate?.split('T')[0] || a.bookingDate;
        const dateStrB = b.bookingDate?.split('T')[0] || b.bookingDate;
        const dateA = new Date(`${dateStrA}T${a.startTime}`).getTime();
        const dateB = new Date(`${dateStrB}T${b.startTime}`).getTime();
        return dateA - dateB;
      } catch {
        return 0;
      }
    });

    past.sort((a, b) => {
      try {
        const dateStrA = a.bookingDate?.split('T')[0] || a.bookingDate;
        const dateStrB = b.bookingDate?.split('T')[0] || b.bookingDate;
        const dateA = new Date(`${dateStrA}T${a.startTime}`).getTime();
        const dateB = new Date(`${dateStrB}T${b.startTime}`).getTime();
        return dateB - dateA;
      } catch {
        return 0;
      }
    });

    return { upcomingBookings: upcoming, pastBookings: past, allBookings: bookings };
  }, [bookings]);

  const now = useMemo(() => new Date(), []);

  const filteredBookings = useMemo(() => {
    let filtered: Booking[];

    if (viewType === "upcoming") {
      filtered = upcomingBookings;
    } else if (viewType === "past") {
      filtered = pastBookings;
    } else {
      filtered = allBookings;
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((b) => b.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((b) => {
        const kitchenName = kitchens.find((k) => k.id === b.kitchenId)?.name || b.kitchenName || `Kitchen #${b.kitchenId}`;
        const locationName = kitchens.find((k) => k.id === b.kitchenId)?.locationName || b.locationName || "Unknown Location";
        const searchableText = [
          kitchenName,
          locationName,
          formatDate(b.bookingDate),
          formatTime(b.startTime),
          formatTime(b.endTime),
          b.specialNotes || '',
        ].join(' ').toLowerCase();
        return searchableText.includes(query);
      });
    }

    filtered = [...filtered].sort((a, b) => {
      if (sortBy === "date") {
        try {
          const dateStrA = a.bookingDate?.split('T')[0] || a.bookingDate;
          const dateStrB = b.bookingDate?.split('T')[0] || b.bookingDate;
          const dateA = new Date(`${dateStrA}T${a.startTime}`).getTime();
          const dateB = new Date(`${dateStrB}T${b.startTime}`).getTime();
          return viewType === "past" ? dateB - dateA : dateA - dateB;
        } catch {
          return 0;
        }
      } else if (sortBy === "kitchen") {
        const kitchenA = getKitchenInfo(a).name.toLowerCase();
        const kitchenB = getKitchenInfo(b).name.toLowerCase();
        return kitchenA.localeCompare(kitchenB);
      } else if (sortBy === "status") {
        const statusOrder = { confirmed: 0, pending: 1, cancelled: 2 };
        return (statusOrder[a.status as keyof typeof statusOrder] ?? 3) - 
               (statusOrder[b.status as keyof typeof statusOrder] ?? 3);
      }
      return 0;
    });

    return filtered;
  }, [viewType, statusFilter, upcomingBookings, pastBookings, allBookings, searchQuery, sortBy, kitchens]);

  const groupedBookings = useMemo(() => {
    if (groupBy === "none") {
      return { "All Bookings": filteredBookings };
    }

    if (groupBy === "kitchen") {
      const groups: Record<string, Booking[]> = {};
      filteredBookings.forEach((booking) => {
        const kitchen = kitchens.find((k) => k.id === booking.kitchenId);
        const kitchenName = kitchen?.name || booking.kitchenName || `Kitchen #${booking.kitchenId}`;
        const locationName = kitchen?.locationName || booking.locationName || "Unknown Location";
        const key = `${kitchenName} - ${locationName}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(booking);
      });
      return groups;
    }

    const groups: Record<string, Booking[]> = {};
    const today = startOfToday();

    filteredBookings.forEach((booking) => {
      try {
        const dateStr = booking.bookingDate?.split('T')[0] || booking.bookingDate;
        const bookingDate = startOfDay(parseISO(dateStr));
        
        let groupKey: string;
        if (isToday(bookingDate)) {
          groupKey = "Today";
        } else if (isTomorrow(bookingDate)) {
          groupKey = "Tomorrow";
        } else if (isThisWeek(bookingDate)) {
          groupKey = "This Week";
        } else {
          const nextWeekStart = startOfWeek(addWeeks(today, 1));
          const nextWeekEnd = startOfWeek(addWeeks(today, 2));
          if (bookingDate >= nextWeekStart && bookingDate < nextWeekEnd) {
            groupKey = "Next Week";
          } else if (bookingDate > today) {
            groupKey = format(bookingDate, "MMMM yyyy");
          } else {
            groupKey = "Past";
          }
        }

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(booking);
      } catch (error) {
        if (!groups["Other"]) groups["Other"] = [];
        groups["Other"].push(booking);
      }
    });

    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const order = ["Today", "Tomorrow", "This Week", "Next Week", "Past", "Other"];
      const indexA = order.indexOf(a);
      const indexB = order.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });

    const sortedGroups: Record<string, Booking[]> = {};
    sortedKeys.forEach((key) => {
      sortedGroups[key] = groups[key];
    });

    return sortedGroups;
  }, [filteredBookings, groupBy, kitchens]);

  const toggleExpanded = (bookingId: number) => {
    setExpandedBookings((prev) => {
      const next = new Set(prev);
      if (next.has(bookingId)) {
        next.delete(bookingId);
      } else {
        next.add(bookingId);
      }
      return next;
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Helper to format discrete time slots for display
  const formatBookingTimeSlots = (booking: Booking): string => {
    const rawSlots = booking.selectedSlots;
    
    // If no slots or empty, fall back to startTime - endTime
    if (!rawSlots || rawSlots.length === 0) {
      return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`;
    }
    
    // Normalize slots to {startTime, endTime} format
    const normalizeSlot = (slot: string | { startTime: string; endTime: string }) => {
      if (typeof slot === 'string') {
        const [h, m] = slot.split(':').map(Number);
        const endMins = h * 60 + m + 60;
        const endH = Math.floor(endMins / 60);
        const endM = endMins % 60;
        return { startTime: slot, endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}` };
      }
      return slot;
    };
    
    const normalized = rawSlots.map(normalizeSlot).filter(s => s.startTime && s.endTime);
    const sorted = [...normalized].sort((a, b) => a.startTime.localeCompare(b.startTime));
    
    // Check if contiguous
    let isContiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].endTime !== sorted[i].startTime) {
        isContiguous = false;
        break;
      }
    }
    
    if (isContiguous) {
      return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`;
    }
    
    // Non-contiguous: show each slot
    return sorted.map(s => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`).join(', ');
  };

  const formatDate = (dateStr: string) => {
    try {
      const dateOnly = dateStr.split('T')[0];
      const date = new Date(dateOnly);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const formatDateTime = (dateStr: string, timeStr: string) => {
    try {
      const dateOnly = dateStr.split('T')[0];
      const date = new Date(`${dateOnly}T${timeStr}`);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const getStatusBadge = (status: string) => {
    const config = {
      pending: { 
        className: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700", 
        icon: Clock, 
        label: "Pending" 
      },
      confirmed: { 
        className: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700", 
        icon: CheckCircle, 
        label: "Confirmed" 
      },
      cancelled: { 
        className: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700", 
        icon: XCircle, 
        label: "Cancelled" 
      },
    };
    const statusConfig = config[status as keyof typeof config] || config.pending;
    const Icon = statusConfig.icon;

    return (
      <Badge variant="outline" className={cn("gap-1.5", statusConfig.className)}>
        <Icon className="h-3 w-3" />
        {statusConfig.label}
      </Badge>
    );
  };

  const getKitchenInfo = (booking: Booking) => {
    const kitchen = kitchens.find((k) => k.id === booking.kitchenId);
    return {
      name: kitchen?.name || booking.kitchenName || `Kitchen #${booking.kitchenId}`,
      location: kitchen?.locationName || booking.locationName || "Unknown Location",
    };
  };

  const handleDownloadInvoice = async (bookingId: number, bookingDate: string) => {
    setDownloadingInvoiceId(bookingId);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        toast.error("Please log in to download invoice");
        setDownloadingInvoiceId(null);
        return;
      }

      const token = await currentUser.getIdToken();
      if (!token) {
        toast.error("Failed to get authentication token");
        setDownloadingInvoiceId(null);
        return;
      }

      const response = await fetch(`/api/bookings/${bookingId}/invoice`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        let errorMessage = 'Failed to generate invoice';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          }
        } catch (parseError) {
          errorMessage = `Server returned ${response.status}`;
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      const dateStr = bookingDate ? new Date(bookingDate).toISOString().split('T')[0] : 'unknown';
      a.download = `LocalCooks-Invoice-${bookingId}-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Invoice downloaded successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to download invoice");
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const handleCancel = (bookingId: number, bookingDate: string, startTime: string, booking: Booking) => {
    try {
      const dateStr = bookingDate.split('T')[0];
      const bookingDateTime = new Date(`${dateStr}T${startTime}`);
      
      if (isNaN(bookingDateTime.getTime())) {
        toast.error("Invalid booking date format");
        return;
      }
      
      const cancellationHours = booking.location?.cancellationPolicyHours ?? 24;
      const policyMessage = booking.location?.cancellationPolicyMessage 
        ?.replace('{hours}', cancellationHours.toString()) 
        ?? `Bookings cannot be cancelled within ${cancellationHours} hours of the scheduled time.`;
      
      const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilBooking < 0) {
        toast.error("This booking has already started or passed");
        return;
      }

      if (hoursUntilBooking >= 0 && hoursUntilBooking < cancellationHours) {
        toast.error(policyMessage);
        return;
      }

      if (window.confirm("Are you sure you want to cancel this booking? This action cannot be undone.")) {
        onCancelBooking(bookingId);
      }
    } catch (error) {
      toast.error("Failed to process cancellation");
    }
  };

  const getTimeUntilBooking = (bookingDateTime: Date) => {
    const hoursUntil = Math.floor((bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60));
    const daysUntil = Math.floor(hoursUntil / 24);
    if (daysUntil > 0) return `${daysUntil}d`;
    if (hoursUntil > 0) return `${hoursUntil}h`;
    return "Soon";
  };

  const statusCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, confirmed: 0, cancelled: 0 };
    const currentViewBookings = viewType === "upcoming" ? upcomingBookings : viewType === "past" ? pastBookings : allBookings;
    counts.all = currentViewBookings.length;
    currentViewBookings.forEach((b) => {
      if (b.status in counts) counts[b.status as keyof typeof counts]++;
    });
    return counts;
  }, [viewType, upcomingBookings, pastBookings, allBookings]);

  return (
    <div className="space-y-6">
      {/* Expiring Storage Notifications */}
      <ExpiringStorageNotification />

      {/* Main Bookings Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold">My Bookings</CardTitle>
              <CardDescription>
                {filteredBookings.length} booking{filteredBookings.length !== 1 ? 's' : ''} found
              </CardDescription>
            </div>
            
            {/* Search */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by kitchen, location, date..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Controls Row */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            {/* Sort & Group */}
            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortType)}>
                <SelectTrigger className="w-[140px] h-9">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Sort by Date</SelectItem>
                  <SelectItem value="kitchen">Sort by Kitchen</SelectItem>
                  <SelectItem value="status">Sort by Status</SelectItem>
                </SelectContent>
              </Select>

              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupType)}>
                <SelectTrigger className="w-[150px] h-9">
                  <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Group by Date</SelectItem>
                  <SelectItem value="kitchen">Group by Kitchen</SelectItem>
                  <SelectItem value="none">No Grouping</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "pending", "confirmed", "cancelled"] as FilterType[]).map((filter) => (
                <Button
                  key={filter}
                  variant={statusFilter === filter ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(filter)}
                  className={cn(
                    "h-8 text-xs font-medium",
                    statusFilter === filter && filter === "pending" && "bg-yellow-500 hover:bg-yellow-600",
                    statusFilter === filter && filter === "confirmed" && "bg-green-600 hover:bg-green-700",
                    statusFilter === filter && filter === "cancelled" && "bg-red-500 hover:bg-red-600",
                  )}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  <span className="ml-1.5 opacity-70">({statusCounts[filter]})</span>
                </Button>
              ))}
            </div>
          </div>

          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as ViewType)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upcoming" className="gap-2">
                <CalendarDays className="h-4 w-4" />
                Upcoming
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{upcomingBookings.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="past" className="gap-2">
                Past
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{pastBookings.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="all" className="gap-2">
                All
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{allBookings.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Separator />

          {/* Loading State */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">Loading bookings...</p>
            </div>
          ) : filteredBookings.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Calendar className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-lg mb-1">No bookings found</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {viewType === "upcoming"
                  ? "You don't have any upcoming bookings. Discover kitchens to book your next session."
                  : viewType === "past"
                  ? "No past bookings to display."
                  : "No bookings match your current filters."}
              </p>
            </div>
          ) : (
            /* Bookings List */
            <div className="space-y-6">
              {Object.entries(groupedBookings).map(([groupKey, groupBookings]) => {
                if (groupBookings.length === 0) return null;
                
                return (
                  <div key={groupKey} className="space-y-3">
                    {/* Group Header */}
                    {groupBy !== "none" && (
                      <div className="flex items-center gap-2 py-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2">
                          {groupKey} ({groupBookings.length})
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    
                    {/* Booking Cards */}
                    <div className="grid gap-3">
                      {groupBookings.map((booking) => {
                        if (!booking || !booking.id) return null;
                        
                        const isExpanded = expandedBookings.has(booking.id);
                        const kitchenInfo = getKitchenInfo(booking);
                        
                        let bookingDateTime: Date;
                        let isUpcoming = false;
                        let canCancel = false;
                        
                        try {
                          const dateStr = booking.bookingDate?.split('T')[0] || booking.bookingDate;
                          bookingDateTime = new Date(`${dateStr}T${booking.startTime}`);
                          
                          if (!isNaN(bookingDateTime.getTime())) {
                            isUpcoming = bookingDateTime >= now;
                            const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
                            const cancellationHours = booking.location?.cancellationPolicyHours ?? 24;
                            canCancel = booking.status !== "cancelled" && isUpcoming && hoursUntilBooking >= cancellationHours;
                          }
                        } catch (error) {
                          bookingDateTime = new Date();
                        }

                        return (
                          <Collapsible
                            key={booking.id}
                            open={isExpanded}
                            onOpenChange={() => toggleExpanded(booking.id)}
                          >
                            <div className={cn(
                              "border rounded-lg transition-all hover:shadow-md",
                              isExpanded && "ring-1 ring-primary/20",
                              booking.status === "cancelled" && "opacity-60"
                            )}>
                              {/* Booking Header */}
                              <CollapsibleTrigger asChild>
                                <div className="p-4 cursor-pointer">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0 space-y-2">
                                      {/* Status & Time Badge Row */}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {getStatusBadge(booking.status)}
                                        {isUpcoming && booking.status !== "cancelled" && (
                                          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                                            {getTimeUntilBooking(bookingDateTime)} away
                                          </Badge>
                                        )}
                                      </div>

                                      {/* Kitchen Name */}
                                      <div className="flex items-center gap-2">
                                        <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        <span className="font-medium truncate">{kitchenInfo.name}</span>
                                      </div>

                                      {/* Date & Time */}
                                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        <div className="flex items-center gap-1.5">
                                          <Calendar className="h-3.5 w-3.5" />
                                          <span>{formatDate(booking.bookingDate)}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <Clock className="h-3.5 w-3.5" />
                                          <span>{formatBookingTimeSlots(booking)}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <MoreHorizontal className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => toggleExpanded(booking.id)}>
                                            <Eye className="h-4 w-4 mr-2" />
                                            {isExpanded ? "Hide Details" : "View Details"}
                                          </DropdownMenuItem>
                                          {booking.status !== "cancelled" && (
                                            <DropdownMenuItem 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDownloadInvoice(booking.id, booking.bookingDate);
                                              }}
                                              disabled={downloadingInvoiceId === booking.id}
                                            >
                                              {downloadingInvoiceId === booking.id ? (
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                              ) : (
                                                <Download className="h-4 w-4 mr-2" />
                                              )}
                                              Download Invoice
                                            </DropdownMenuItem>
                                          )}
                                          {canCancel && (
                                            <>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuItem 
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleCancel(booking.id, booking.bookingDate, booking.startTime, booking);
                                                }}
                                                className="text-destructive focus:text-destructive"
                                              >
                                                <Ban className="h-4 w-4 mr-2" />
                                                Cancel Booking
                                              </DropdownMenuItem>
                                            </>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                      
                                      {isExpanded ? (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </CollapsibleTrigger>

                              {/* Expanded Details */}
                              <CollapsibleContent>
                                <div className="px-4 pb-4 border-t pt-4 space-y-4">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                    <div className="flex items-start gap-3">
                                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                                      <div>
                                        <p className="text-xs text-muted-foreground mb-0.5">Location</p>
                                        <p className="font-medium">{kitchenInfo.location}</p>
                                      </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                                      <div>
                                        <p className="text-xs text-muted-foreground mb-0.5">Scheduled Time</p>
                                        <p className="font-medium">
                                          {formatDate(booking.bookingDate)}, {formatBookingTimeSlots(booking)}
                                        </p>
                                      </div>
                                    </div>

                                    {booking.specialNotes && (
                                      <div className="flex items-start gap-3 sm:col-span-2">
                                        <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
                                        <div>
                                          <p className="text-xs text-muted-foreground mb-0.5">Special Notes</p>
                                          <p className="font-medium">{booking.specialNotes}</p>
                                        </div>
                                      </div>
                                    )}

                                    <div className="flex items-start gap-3">
                                      <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                                      <div>
                                        <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                                        <p className="font-medium">
                                          {new Date(booking.createdAt).toLocaleString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit",
                                          })}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {!canCancel && booking.status !== "cancelled" && isUpcoming && (
                                    <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                      <p className="text-xs text-yellow-800 dark:text-yellow-200">
                                        <strong>Note:</strong> {booking.location?.cancellationPolicyMessage 
                                          ?.replace('{hours}', (booking.location.cancellationPolicyHours ?? 24).toString())
                                          ?? `Bookings cannot be cancelled within ${booking.location?.cancellationPolicyHours ?? 24} hours of the scheduled time.`}
                                      </p>
                                    </div>
                                  )}

                                  {booking.status === "confirmed" && (
                                    <Button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadInvoice(booking.id, booking.bookingDate);
                                      }}
                                      disabled={downloadingInvoiceId === booking.id}
                                      variant="outline"
                                      className="w-full"
                                      size="sm"
                                    >
                                      {downloadingInvoiceId === booking.id ? (
                                        <>
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                          Generating Invoice...
                                        </>
                                      ) : (
                                        <>
                                          <FileText className="mr-2 h-4 w-4" />
                                          Download Invoice
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Storage Bookings Section */}
      {!isLoadingStorage && storageBookings.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-purple-600" />
                <CardTitle className="text-lg">Storage Bookings</CardTitle>
              </div>
              <Badge variant="secondary">{storageBookings.length} active</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {storageBookings
                .filter((sb: any) => sb.status !== 'cancelled')
                .map((storageBooking: any) => {
                  const endDate = new Date(storageBooking.endDate);
                  const daysUntilExpiry = differenceInDays(endDate, startOfToday());
                  const isExpiringSoon = daysUntilExpiry <= 2 && daysUntilExpiry >= 0;
                  const isExpired = daysUntilExpiry < 0;
                  const isExpanded = expandedStorageBookings.has(storageBooking.id);

                  return (
                    <Collapsible
                      key={storageBooking.id}
                      open={isExpanded}
                      onOpenChange={() => {
                        setExpandedStorageBookings((prev) => {
                          const next = new Set(prev);
                          if (next.has(storageBooking.id)) {
                            next.delete(storageBooking.id);
                          } else {
                            next.add(storageBooking.id);
                          }
                          return next;
                        });
                      }}
                    >
                      <div className={cn(
                        "border rounded-lg transition-all",
                        isExpiringSoon && "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20",
                        isExpired && "border-red-300 bg-red-50/50 dark:bg-red-950/20",
                        !isExpiringSoon && !isExpired && "hover:shadow-md"
                      )}>
                        <CollapsibleTrigger asChild>
                          <div className="p-4 cursor-pointer">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {getStatusBadge(storageBooking.status)}
                                  {isExpiringSoon && (
                                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400">
                                      Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
                                    </Badge>
                                  )}
                                  {isExpired && (
                                    <Badge variant="destructive">
                                      Expired {Math.abs(daysUntilExpiry)} day{Math.abs(daysUntilExpiry) !== 1 ? 's' : ''} ago
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <Package className="h-4 w-4 text-purple-600 flex-shrink-0" />
                                  <span className="font-medium truncate">{storageBooking.storageName}</span>
                                </div>

                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-1.5">
                                    <Building2 className="h-3.5 w-3.5" />
                                    <span>{storageBooking.kitchenName}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" />
                                    <span>
                                      {format(new Date(storageBooking.startDate), "MMM d")} - {format(endDate, "MMM d, yyyy")}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!isExpired && storageBooking.status !== 'cancelled' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-purple-600 border-purple-300 hover:bg-purple-50"
                                    onClick={(e: React.MouseEvent) => {
                                      e.stopPropagation();
                                      setExtendDialogOpen(storageBooking.id);
                                    }}
                                  >
                                    <CalendarPlus className="h-3 w-3 mr-1" />
                                    Extend
                                  </Button>
                                )}
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="px-4 pb-4 border-t pt-4 space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                              <div className="flex items-start gap-3">
                                <Package className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Storage Type</p>
                                  <p className="font-medium capitalize">{storageBooking.storageType}</p>
                                </div>
                              </div>

                              <div className="flex items-start gap-3">
                                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Period</p>
                                  <p className="font-medium">
                                    {format(new Date(storageBooking.startDate), "PPP")} - {format(endDate, "PPP")}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-start gap-3">
                                <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Kitchen</p>
                                  <p className="font-medium">{storageBooking.kitchenName}</p>
                                </div>
                              </div>

                              <div className="flex items-start gap-3">
                                <CheckCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <div>
                                  <p className="text-xs text-muted-foreground mb-0.5">Total Cost</p>
                                  <p className="font-medium">
                                    ${(storageBooking.totalPrice || 0).toFixed(2)} CAD
                                    {storageBooking.serviceFee > 0 && (
                                      <span className="text-xs text-muted-foreground ml-1">
                                        (includes ${(storageBooking.serviceFee || 0).toFixed(2)} service fee)
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {isExpiringSoon && (
                              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <p className="text-xs text-amber-800 dark:text-amber-200">
                                  <strong>⚠️ Expiring Soon:</strong> Your storage expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}. 
                                  Extend now to avoid interruption.
                                </p>
                              </div>
                            )}

                            {isExpired && (
                              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                                <p className="text-xs text-red-800 dark:text-red-200">
                                  <strong>⚠️ Expired:</strong> Your storage expired {Math.abs(daysUntilExpiry)} day{Math.abs(daysUntilExpiry) !== 1 ? 's' : ''} ago. 
                                  Please extend immediately or contact support.
                                </p>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extension Dialog */}
      {extendDialogOpen && (
        <StorageExtensionDialog
          booking={storageBookings.find((sb: any) => sb.id === extendDialogOpen)}
          open={extendDialogOpen !== null}
          onOpenChange={(open) => !open && setExtendDialogOpen(null)}
          onSuccess={() => setExtendDialogOpen(null)}
        />
      )}
    </div>
  );
}
