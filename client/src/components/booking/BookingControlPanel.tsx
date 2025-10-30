import { useState, useMemo } from "react";
import { Calendar, Clock, MapPin, X, CheckCircle, XCircle, AlertCircle, Building, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
}

interface BookingControlPanelProps {
  bookings: Booking[];
  isLoading: boolean;
  onCancelBooking: (bookingId: number) => void;
  kitchens?: Array<{ id: number; name: string; locationName?: string }>;
}

type FilterType = "all" | "pending" | "confirmed" | "cancelled";
type ViewType = "upcoming" | "past" | "all";

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

  // Separate bookings into past, upcoming, and all
  const now = new Date();
  const { upcomingBookings, pastBookings, allBookings } = useMemo(() => {
    const upcoming: Booking[] = [];
    const past: Booking[] = [];

    bookings.forEach((booking) => {
      const bookingDateTime = new Date(`${booking.bookingDate}T${booking.startTime}`);
      if (bookingDateTime >= now) {
        upcoming.push(booking);
      } else {
        past.push(booking);
      }
    });

    // Sort upcoming by date (ascending) and past by date (descending)
    upcoming.sort((a, b) => {
      const dateA = new Date(`${a.bookingDate}T${a.startTime}`).getTime();
      const dateB = new Date(`${b.bookingDate}T${b.startTime}`).getTime();
      return dateA - dateB;
    });

    past.sort((a, b) => {
      const dateA = new Date(`${a.bookingDate}T${a.startTime}`).getTime();
      const dateB = new Date(`${b.bookingDate}T${b.startTime}`).getTime();
      return dateB - dateA;
    });

    return {
      upcomingBookings: upcoming,
      pastBookings: past,
      allBookings: bookings,
    };
  }, [bookings]);

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
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateStr: string, timeStr: string) => {
    const date = new Date(`${dateStr}T${timeStr}`);
    return date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
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

  const handleCancel = (bookingId: number, bookingDate: string, startTime: string) => {
    const bookingDateTime = new Date(`${bookingDate}T${startTime}`);
    const now = new Date();
    const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilBooking < 24) {
      toast({
        title: "Cancellation Policy",
        description: "Bookings cannot be cancelled within 24 hours of the booking time.",
        variant: "destructive",
      });
      return;
    }

    if (window.confirm("Are you sure you want to cancel this booking? This action cannot be undone.")) {
      onCancelBooking(bookingId);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sticky top-4">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">My Bookings</h2>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-600">{filteredBookings.length}</span>
          </div>
        </div>

        {/* View Type Tabs */}
        <div className="flex gap-2 mb-4 border-b border-gray-200">
          {[
            { key: "upcoming" as ViewType, label: "Upcoming", count: upcomingBookings.length },
            { key: "past" as ViewType, label: "Past", count: pastBookings.length },
            { key: "all" as ViewType, label: "All", count: allBookings.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setViewType(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                viewType === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex gap-2 flex-wrap">
          {(["all", "pending", "confirmed", "cancelled"] as FilterType[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                statusFilter === filter
                  ? "bg-blue-100 text-blue-700 border border-blue-300"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
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
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {filteredBookings.map((booking) => {
            const isExpanded = expandedBookings.has(booking.id);
            const kitchenInfo = getKitchenInfo(booking);
            const bookingDateTime = new Date(`${booking.bookingDate}T${booking.startTime}`);
            const isUpcoming = bookingDateTime >= now;
            const canCancel =
              booking.status !== "cancelled" &&
              isUpcoming &&
              (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60) >= 24;

            return (
              <div
                key={booking.id}
                className="border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
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
                          <span className="text-xs text-blue-600 font-medium">
                            {(() => {
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
                            handleCancel(booking.id, booking.bookingDate, booking.startTime);
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
                          <strong>Note:</strong> Bookings cannot be cancelled within 24 hours of the
                          scheduled time.
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
    </div>
  );
}

