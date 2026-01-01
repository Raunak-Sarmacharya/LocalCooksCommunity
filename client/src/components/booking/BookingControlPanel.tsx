import { useState, useMemo } from "react";
import { Calendar, Clock, MapPin, X, CheckCircle, XCircle, AlertCircle, Building, ChevronDown, ChevronUp, Filter, Package, CalendarPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_TIMEZONE, isBookingUpcoming, isBookingPast } from "@/utils/timezone-utils";
import { useQuery } from "@tanstack/react-query";
import { StorageExtensionDialog } from "./StorageExtensionDialog";
import { format, differenceInDays, startOfToday } from "date-fns";

interface Booking {
  id: number;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
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

interface BookingControlPanelProps {
  bookings: Booking[];
  isLoading: boolean;
  onCancelBooking: (bookingId: number) => void;
  kitchens?: Array<{ id: number; name: string; locationName?: string }>;
}

type FilterType = "all" | "pending" | "confirmed" | "cancelled";
type ViewType = "upcoming" | "past" | "all";

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
}

export default function BookingControlPanel({
  bookings,
  isLoading,
  onCancelBooking,
  kitchens = [],
}: BookingControlPanelProps) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<FilterType>("all");
  const [viewType, setViewType] = useState<ViewType>("upcoming");
  const [expandedBookings, setExpandedBookings] = useState<Set<number>>(new Set());
  const [expandedStorageBookings, setExpandedStorageBookings] = useState<Set<number>>(new Set());
  const [extendDialogOpen, setExtendDialogOpen] = useState<number | null>(null);

  // Fetch storage bookings
  const { data: storageBookings = [], isLoading: isLoadingStorage } = useQuery({
    queryKey: ['/api/chef/storage-bookings'],
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

  // Separate bookings into past, upcoming, and all using timezone-aware categorization
  // Timeline is PRIMARY - status does NOT override timeline
  const { upcomingBookings, pastBookings, allBookings } = useMemo(() => {
    const upcoming: Booking[] = [];
    const past: Booking[] = [];

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return {
        upcomingBookings: [],
        pastBookings: [],
        allBookings: [],
      };
    }

    bookings.forEach((booking) => {
      if (!booking || !booking.bookingDate || !booking.startTime || !booking.endTime) return;
      
      // Cancelled bookings always go to past
      if (booking.status === 'cancelled') {
        past.push(booking);
        return;
      }
      
      try {
        // Get timezone from booking or use default
        const timezone = booking.locationTimezone || DEFAULT_TIMEZONE;
        const bookingDateStr = booking.bookingDate.split('T')[0];
        
        // Timeline is PRIMARY factor - check if booking end time has passed
        if (isBookingPast(bookingDateStr, booking.endTime, timezone)) {
          past.push(booking);
        } 
        // Check if booking start time is in the future
        else if (isBookingUpcoming(bookingDateStr, booking.startTime, timezone)) {
          upcoming.push(booking);
        } 
        // Booking is currently happening or very recently ended
        else {
          // If end time hasn't passed but start time has, it's currently happening - treat as upcoming
          upcoming.push(booking);
        }
      } catch (error) {
        // If timezone check fails, fall back to simple date comparison using end time
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

    // Sort upcoming by date (ascending) and past by date (descending)
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

    console.log('📅 BookingControlPanel: Categorized bookings', {
      upcoming: upcoming.length,
      past: past.length,
      all: bookings.length
    });

    return {
      upcomingBookings: upcoming,
      pastBookings: past,
      allBookings: bookings,
    };
  }, [bookings]);

  // Memoize current time for use in render - recalculate periodically but stable within render
  const now = useMemo(() => new Date(), []);

  // Apply filters
  const filteredBookings = useMemo(() => {
    let filtered: Booking[];

    // First filter by view type
    if (viewType === "upcoming") {
      filtered = upcomingBookings;
    } else if (viewType === "past") {
      filtered = pastBookings;
    } else {
      filtered = allBookings;
    }

    // Then filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((b) => b.status === statusFilter);
    }

    return filtered;
  }, [viewType, statusFilter, upcomingBookings, pastBookings, allBookings]);

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

  const formatDate = (dateStr: string) => {
    try {
      // Handle ISO timestamp format from database (e.g., "2025-10-31T02:30:00.000Z")
      // Extract just the date part (YYYY-MM-DD)
      const dateOnly = dateStr.split('T')[0];
      const date = new Date(dateOnly);
      
      if (isNaN(date.getTime())) {
        console.warn('Invalid date string:', dateStr);
        return 'Invalid Date';
      }
      
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      console.error('Error formatting date:', dateStr, error);
      return 'Invalid Date';
    }
  };

  const formatDateTime = (dateStr: string, timeStr: string) => {
    try {
      // Handle ISO timestamp format from database
      // Extract just the date part and combine with time
      const dateOnly = dateStr.split('T')[0];
      const date = new Date(`${dateOnly}T${timeStr}`);
      
      if (isNaN(date.getTime())) {
        console.warn('Invalid date/time combination:', dateStr, timeStr);
        return 'Invalid Date';
      }
      
      return date.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (error) {
      console.error('Error formatting date/time:', dateStr, timeStr, error);
      return 'Invalid Date';
    }
  };

  const getStatusBadge = (status: string) => {
    const config = {
      pending: {
        bg: "bg-yellow-100",
        text: "text-yellow-800",
        border: "border-yellow-300",
        icon: <Clock className="h-3 w-3" />,
        label: "Pending",
      },
      confirmed: {
        bg: "bg-green-100",
        text: "text-green-800",
        border: "border-green-300",
        icon: <CheckCircle className="h-3 w-3" />,
        label: "Confirmed",
      },
      cancelled: {
        bg: "bg-red-100",
        text: "text-red-800",
        border: "border-red-300",
        icon: <XCircle className="h-3 w-3" />,
        label: "Cancelled",
      },
    };

    const statusConfig = config[status as keyof typeof config] || config.pending;

    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
      >
        {statusConfig.icon}
        <span>{statusConfig.label}</span>
      </div>
    );
  };

  const getKitchenInfo = (booking: Booking) => {
    const kitchen = kitchens.find((k) => k.id === booking.kitchenId);
    return {
      name: kitchen?.name || booking.kitchenName || `Kitchen #${booking.kitchenId}`,
      location: kitchen?.locationName || booking.locationName || "Unknown Location",
    };
  };

  const handleCancel = (bookingId: number, bookingDate: string, startTime: string, booking: Booking) => {
    try {
      const dateStr = bookingDate.split('T')[0]; // Extract date part if ISO
      const bookingDateTime = new Date(`${dateStr}T${startTime}`);
      
      if (isNaN(bookingDateTime.getTime())) {
        toast({
          title: "Error",
          description: "Invalid booking date format.",
          variant: "destructive",
        });
        return;
      }
      
      // Get cancellation policy from location (default to 24 hours)
      const cancellationHours = booking.location?.cancellationPolicyHours ?? 24;
      const policyMessage = booking.location?.cancellationPolicyMessage 
        ?.replace('{hours}', cancellationHours.toString()) 
        ?? `Bookings cannot be cancelled within ${cancellationHours} hours of the scheduled time.`;
      
      const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Only apply cancellation policy to future bookings
      // Past bookings (hoursUntilBooking < 0) should always be allowed to be cancelled
      if (hoursUntilBooking >= 0 && hoursUntilBooking < cancellationHours) {
        toast({
          title: "Cancellation Policy",
          description: policyMessage,
          variant: "destructive",
        });
        return;
      }

      if (window.confirm("Are you sure you want to cancel this booking? This action cannot be undone.")) {
        onCancelBooking(bookingId);
      }
    } catch (error) {
      console.error('Error in handleCancel:', error);
      toast({
        title: "Error",
        description: "Failed to process cancellation. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 sticky top-4 h-fit max-h-[calc(100vh-2rem)] flex flex-col">
      {/* Header */}
      <div className="mb-6 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">My Bookings</h2>
          <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded-full">
            <Filter className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-blue-700">{filteredBookings.length}</span>
          </div>
        </div>

        {/* View Type Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-50 p-1 rounded-lg">
          {[
            { key: "upcoming" as ViewType, label: "Upcoming", count: upcomingBookings.length },
            { key: "past" as ViewType, label: "Past", count: pastBookings.length },
            { key: "all" as ViewType, label: "All", count: allBookings.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setViewType(tab.key)}
              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-md transition-all ${
                viewType === tab.key
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
              }`}
            >
              <span className="block">{tab.label}</span>
              {tab.count > 0 && (
                <span className={`text-xs font-medium ${
                  viewType === tab.key ? "text-blue-500" : "text-gray-500"
                }`}>
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex gap-2 flex-wrap">
          {(["all", "pending", "confirmed", "cancelled"] as FilterType[]).map((filter) => {
            const isActive = statusFilter === filter;
            const filterConfig = {
              all: { bg: "bg-gray-100", activeBg: "bg-gray-200", text: "text-gray-700", border: "border-gray-300" },
              pending: { bg: "bg-yellow-100", activeBg: "bg-yellow-200", text: "text-yellow-700", border: "border-yellow-300" },
              confirmed: { bg: "bg-green-100", activeBg: "bg-green-200", text: "text-green-700", border: "border-green-300" },
              cancelled: { bg: "bg-red-100", activeBg: "bg-red-200", text: "text-red-700", border: "border-red-300" },
            }[filter];
            
            return (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border ${
                  isActive
                    ? `${filterConfig.activeBg} ${filterConfig.text} ${filterConfig.border} shadow-sm`
                    : `${filterConfig.bg} ${filterConfig.text} hover:${filterConfig.activeBg} ${filterConfig.border}`
                }`}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-500 mt-3 text-sm">Loading bookings...</p>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium mb-1">
            {viewType === "upcoming"
              ? "No upcoming bookings"
              : viewType === "past"
              ? "No past bookings"
              : "No bookings found"}
          </p>
          <p className="text-sm text-gray-400">
            {statusFilter !== "all" && `No ${statusFilter} bookings`}
          </p>
        </div>
      ) : (
        <div className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0">
          {filteredBookings.map((booking) => {
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
                // Use cancellation policy from location (default to 24 hours)
                const cancellationHours = booking.location?.cancellationPolicyHours ?? 24;
                // Allow cancellation if:
                // 1. Booking is not already cancelled
                // 2. Either the booking is in the past (hoursUntilBooking < 0) OR
                //    the booking is upcoming and outside the cancellation window
                canCancel =
                  booking.status !== "cancelled" &&
                  (hoursUntilBooking < 0 || (isUpcoming && hoursUntilBooking >= cancellationHours));
              }
            } catch (error) {
              console.error('Error processing booking date:', booking, error);
              bookingDateTime = new Date();
            }

            return (
              <div
                key={booking.id}
                className="border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all bg-white"
              >
                {/* Booking Header */}
                <div
                  className="p-4 cursor-pointer"
                  onClick={() => toggleExpanded(booking.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusBadge(booking.status)}
                        {isUpcoming && (
                          <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded">
                            {(() => {
                              try {
                                const hoursUntil = Math.floor(
                                  (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
                                );
                                const daysUntil = Math.floor(hoursUntil / 24);
                                if (daysUntil > 0) {
                                  return `${daysUntil} day${daysUntil > 1 ? "s" : ""} away`;
                                } else if (hoursUntil > 0) {
                                  return `${hoursUntil} hour${hoursUntil > 1 ? "s" : ""} away`;
                                } else {
                                  return "Starting soon";
                                }
                              } catch {
                                return "Upcoming";
                              }
                            })()}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mb-1.5">
                        <Building className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {kitchenInfo.name}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(booking.bookingDate)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>
                            {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canCancel && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel(booking.id, booking.bookingDate, booking.startTime, booking);
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          aria-label="Cancel booking"
                          title="Cancel booking"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-3">
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 mb-0.5">Location</p>
                          <p className="text-gray-900">{kitchenInfo.location}</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <Clock className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 mb-0.5">Scheduled Time</p>
                          <p className="text-gray-900">
                            {formatDateTime(booking.bookingDate, booking.startTime)} -{" "}
                            {formatTime(booking.endTime)}
                          </p>
                        </div>
                      </div>

                      {booking.specialNotes && (
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">Special Notes</p>
                            <p className="text-gray-900">{booking.specialNotes}</p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-start gap-2">
                        <Calendar className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 mb-0.5">Created</p>
                          <p className="text-gray-900">
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
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <p className="text-xs text-yellow-800">
                          <strong>Note:</strong> {booking.location?.cancellationPolicyMessage 
                            ?.replace('{hours}', (booking.location.cancellationPolicyHours ?? 24).toString())
                            ?? `Bookings cannot be cancelled within ${booking.location?.cancellationPolicyHours ?? 24} hours of the scheduled time.`}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Storage Bookings Section */}
      {!isLoadingStorage && storageBookings.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-600" />
              Storage Bookings
            </h3>
            <span className="text-sm text-gray-500">{storageBookings.length} active</span>
          </div>

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
                  <div
                    key={storageBooking.id}
                    className={`border rounded-lg transition-all ${
                      isExpiringSoon
                        ? 'border-amber-300 bg-amber-50/50'
                        : isExpired
                        ? 'border-red-300 bg-red-50/50'
                        : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-md'
                    }`}
                  >
                    <div
                      className="p-4 cursor-pointer"
                      onClick={() => {
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {getStatusBadge(storageBooking.status)}
                            {isExpiringSoon && (
                              <span className="text-xs text-amber-700 font-medium bg-amber-100 px-2 py-0.5 rounded">
                                Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
                              </span>
                            )}
                            {isExpired && (
                              <span className="text-xs text-red-700 font-medium bg-red-100 px-2 py-0.5 rounded">
                                Expired {Math.abs(daysUntilExpiry)} day{Math.abs(daysUntilExpiry) !== 1 ? 's' : ''} ago
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mb-1.5">
                            <Package className="h-4 w-4 text-purple-600 flex-shrink-0" />
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {storageBooking.storageName}
                            </p>
                          </div>

                          <div className="flex items-center gap-4 text-xs text-gray-600">
                            <div className="flex items-center gap-1">
                              <Building className="h-3 w-3" />
                              <span>{storageBooking.kitchenName}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
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
                              onClick={(e) => {
                                e.stopPropagation();
                                setExtendDialogOpen(storageBooking.id);
                              }}
                            >
                              <CalendarPlus className="h-3 w-3 mr-1" />
                              Extend
                            </Button>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-3">
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          <div className="flex items-start gap-2">
                            <Package className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Storage Type</p>
                              <p className="text-gray-900 capitalize">{storageBooking.storageType}</p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <Calendar className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Period</p>
                              <p className="text-gray-900">
                                {format(new Date(storageBooking.startDate), "PPP")} - {format(endDate, "PPP")}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <Building className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Kitchen</p>
                              <p className="text-gray-900">{storageBooking.kitchenName}</p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Total Cost</p>
                              <p className="text-gray-900">
                                ${storageBooking.totalPrice.toFixed(2)} CAD
                                {storageBooking.serviceFee > 0 && (
                                  <span className="text-xs text-gray-500 ml-1">
                                    (includes ${storageBooking.serviceFee.toFixed(2)} service fee)
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>

                        {isExpiringSoon && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <p className="text-xs text-amber-800">
                              <strong>⚠️ Expiring Soon:</strong> Your storage expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}. 
                              Extend now to avoid interruption.
                            </p>
                          </div>
                        )}

                        {isExpired && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-xs text-red-800">
                              <strong>⚠️ Expired:</strong> Your storage expired {Math.abs(daysUntilExpiry)} day{Math.abs(daysUntilExpiry) !== 1 ? 's' : ''} ago. 
                              Please extend immediately or contact support.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Extension Dialog */}
      {extendDialogOpen && (
        <StorageExtensionDialog
          booking={storageBookings.find((sb: any) => sb.id === extendDialogOpen)}
          open={extendDialogOpen !== null}
          onOpenChange={(open) => !open && setExtendDialogOpen(null)}
          onSuccess={() => {
            setExtendDialogOpen(null);
          }}
        />
      )}
    </div>
  );
}

