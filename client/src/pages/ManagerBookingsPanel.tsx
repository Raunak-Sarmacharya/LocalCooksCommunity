import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Calendar, User, MapPin, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import { StorageExtensionApprovals } from "@/components/manager/StorageExtensionApprovals";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DEFAULT_TIMEZONE, isBookingUpcoming, isBookingPast, createBookingDateTime, getNowInTimezone } from "@/utils/timezone-utils";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { DataTable } from "@/components/ui/data-table";
import { getBookingColumns } from "@/components/manager/bookings/columns";
import { auth } from "@/lib/firebase";

interface Booking {
  id: number;
  kitchenId: number;
  chefId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<{ startTime: string; endTime: string }>; // Array of discrete 1-hour time slots
  status: string;
  specialNotes?: string;
  createdAt: string;
  kitchenName?: string;
  chefName?: string;
  locationName?: string;
  locationTimezone?: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  // Use Firebase auth to get fresh token (same as KitchenDashboardOverview)
  const currentFirebaseUser = auth.currentUser;
  if (currentFirebaseUser) {
    try {
      const token = await currentFirebaseUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    } catch (error) {
      console.error('Error getting Firebase token:', error);
    }
  }
  // Fallback to localStorage token if Firebase auth is not available
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

interface ManagerBookingsPanelProps {
  embedded?: boolean;
}

export default function ManagerBookingsPanel({ embedded = false }: ManagerBookingsPanelProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations } = useManagerDashboard();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);

  // Check if any location has approved license
  const hasApprovedLicense = locations.some((loc: any) => loc.kitchenLicenseStatus === 'approved');

  // Fetch all bookings for this manager with real-time polling
  const { data: bookings = [], isLoading, error: bookingsError } = useQuery({
    queryKey: ['managerBookings'],
    queryFn: async () => {
      try {
        const headers = await getAuthHeaders();
        const headersObj = headers as Record<string, string>;
        console.log('📋 ManagerBookingsPanel: Fetching bookings', {
          hasAuth: !!headersObj.Authorization
        });

        const response = await fetch('/api/manager/bookings', {
          headers,
          credentials: "include",
        });

        console.log('📋 ManagerBookingsPanel: Response status:', response.status);

        if (!response.ok) {
          let errorMessage = 'Failed to fetch bookings';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
            console.error('❌ ManagerBookingsPanel: Error response:', errorData);
          } catch (jsonError) {
            try {
              const text = await response.text();
              errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
              console.error('❌ ManagerBookingsPanel: Error text:', text);
            } catch (textError) {
              errorMessage = `Server returned ${response.status} ${response.statusText}`;
            }
          }
          throw new Error(errorMessage);
        }

        const contentType = response.headers.get('content-type');
        let data;
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          data = text ? JSON.parse(text) : [];
        }

        console.log(`✅ ManagerBookingsPanel: Received ${Array.isArray(data) ? data.length : 0} bookings`);
        if (Array.isArray(data) && data.length > 0) {
          console.log('📋 ManagerBookingsPanel: Sample booking:', data[0]);
        }

        return data;
      } catch (error) {
        console.error('❌ ManagerBookingsPanel: Fetch error:', error);
        throw error;
      }
    },
    // Real-time polling - check frequently for new bookings or changes
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return 10000; // 10 seconds if no data

      // Check if there are pending bookings (need manager attention)
      const hasPendingBookings = data.some((b: Booking) => b.status === "pending");

      // Check if there are upcoming bookings (chefs might cancel)
      const hasUpcomingBookings = data.some((b: Booking) => {
        const bookingDate = new Date(b.bookingDate);
        return bookingDate >= new Date();
      });

      if (hasPendingBookings) {
        // Very frequent updates when bookings need review
        return 5000; // 5 seconds
      } else if (hasUpcomingBookings) {
        // Moderate frequency for upcoming bookings
        return 15000; // 15 seconds
      } else {
        // Less frequent when no active bookings
        return 30000; // 30 seconds
      }
    },
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 10000,
  });

  // Update booking status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: number; status: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${bookingId}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        let errorMessage = 'Failed to update booking status';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (jsonError) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (textError) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      toast({
        title: "Success",
        description: status === 'confirmed' ? "Booking confirmed!" : "Booking cancelled",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleConfirm = (bookingId: number) => {
    if (window.confirm('Confirm this booking?')) {
      updateStatusMutation.mutate({ bookingId, status: 'confirmed' });
    }
  };

  const handleCancelClick = (booking: Booking) => {
    setBookingToCancel(booking);
    setCancelDialogOpen(true);
  };

  const handleCancelConfirm = () => {
    if (bookingToCancel) {
      updateStatusMutation.mutate({ bookingId: bookingToCancel.id, status: 'cancelled' });
      setCancelDialogOpen(false);
      setBookingToCancel(null);
    }
  };

  const handleCancelDialogClose = () => {
    setCancelDialogOpen(false);
    setBookingToCancel(null);
  };

  // Categorize bookings by timezone-aware timeline (Upcoming, Past)
  // Confirmed bookings go into Upcoming category
  const { upcomingBookings, pastBookings } = useMemo(() => {
    const upcoming: Booking[] = [];
    const past: Booking[] = [];

    bookings.forEach((booking: Booking) => {
      if (!booking.bookingDate || !booking.startTime || !booking.endTime) return;
      if (booking.status === 'cancelled') {
        past.push(booking); // Cancelled bookings go to past
        return;
      }

      const timezone = booking.locationTimezone || DEFAULT_TIMEZONE;
      const bookingDateStr = booking.bookingDate.split('T')[0];

      try {
        // Timeline is the PRIMARY factor - status does NOT override timeline
        // Check if booking end time has passed - if yes, it's past (regardless of status)
        if (isBookingPast(bookingDateStr, booking.endTime, timezone)) {
          past.push(booking);
        }
        // Check if booking start time is in the future - if yes, it's upcoming
        else if (isBookingUpcoming(bookingDateStr, booking.startTime, timezone)) {
          upcoming.push(booking);
        }
        // If booking is currently happening (between start and end), check more carefully
        else {
          // Booking start time has passed but end time hasn't - check if it's very recent
          const bookingEndDateTime = createBookingDateTime(bookingDateStr, booking.endTime, timezone);
          const now = getNowInTimezone(timezone);

          // If end time is very close (within 1 hour), it might have just ended - use end time to decide
          const hoursSinceEnd = (now.getTime() - bookingEndDateTime.getTime()) / (1000 * 60 * 60);

          // If end time passed more than 1 hour ago, it's definitely past
          if (hoursSinceEnd > 1) {
            past.push(booking);
          } else {
            // Very recent or currently happening - treat as upcoming
            upcoming.push(booking);
          }
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
          // Last resort: use booking date only
          const bookingDate = new Date(booking.bookingDate);
          if (bookingDate < new Date()) {
            past.push(booking);
          } else {
            upcoming.push(booking);
          }
        }
      }
    });

    // Sort upcoming by start time (ascending)
    upcoming.sort((a, b) => {
      const dateA = new Date(`${a.bookingDate.split('T')[0]}T${a.startTime}`);
      const dateB = new Date(`${b.bookingDate.split('T')[0]}T${b.startTime}`);
      return dateA.getTime() - dateB.getTime();
    });

    // Sort past by start time (descending - most recent first)
    past.sort((a, b) => {
      const dateA = new Date(`${a.bookingDate.split('T')[0]}T${a.startTime}`);
      const dateB = new Date(`${b.bookingDate.split('T')[0]}T${b.startTime}`);
      return dateB.getTime() - dateA.getTime();
    });

    return { upcomingBookings: upcoming, pastBookings: past };
  }, [bookings]);

  // Filter bookings based on status filter, location filter and time category
  const filteredBookings = useMemo(() => {
    let filtered: Booking[] = [];

    if (statusFilter === 'all') {
      // Show all bookings in timeline order: Upcoming, Past
      filtered = [...upcomingBookings, ...pastBookings];
    } else if (statusFilter === 'upcoming') {
      // Show only upcoming bookings (includes confirmed bookings)
      filtered = upcomingBookings;
    } else if (statusFilter === 'past') {
      // Show only past bookings
      filtered = pastBookings;
    } else {
      // Filter by status (pending, cancelled)
      filtered = bookings.filter((booking: Booking) => booking.status === statusFilter);
    }

    // Apply location filter if not 'all'
    if (locationFilter !== 'all') {
      filtered = filtered.filter((booking: Booking) => booking.locationName === locationFilter);
    }

    return filtered;
  }, [bookings, statusFilter, locationFilter, upcomingBookings, pastBookings]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      confirmed: 'bg-green-100 text-green-800 border-green-300',
      cancelled: 'bg-red-100 text-red-800 border-red-300',
    };
    const icons = {
      pending: <Clock className="h-4 w-4" />,
      confirmed: <CheckCircle className="h-4 w-4" />,
      cancelled: <XCircle className="h-4 w-4" />,
    };
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {icons[status as keyof typeof icons]}
        <span className="font-medium capitalize">{status}</span>
      </div>
    );
  };

  const content = (
    <main className={embedded ? "flex-1 py-4 sm:py-6" : "flex-1 pt-20 sm:pt-24 pb-6 sm:pb-8"}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Booking Requests</h1>
          <p className="text-gray-600 mt-2">Review and manage chef booking requests</p>
        </div>

        {/* Storage Extension Approvals */}
        <div className="mb-8">
          <StorageExtensionApprovals />
        </div>

        {/* Location Filter (shown only when multiple locations exist) */}
        {locations.length > 1 && (
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-medium text-gray-700">Location:</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Locations</option>
              {locations.map((loc: any) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-4 mb-6 border-b overflow-x-auto">
          {[
            { key: 'all', label: 'All Bookings' },
            { key: 'upcoming', label: 'Upcoming' },
            { key: 'past', label: 'Past' },
            { key: 'pending', label: 'Pending' },
            { key: 'cancelled', label: 'Cancelled' },
          ].map((filter) => {
            // Calculate counts considering location filter
            const baseBookings = locationFilter === 'all'
              ? bookings
              : bookings.filter((b: Booking) => b.locationName === locationFilter);

            let count = 0;
            if (filter.key === 'all') {
              count = baseBookings.length;
            } else if (filter.key === 'upcoming') {
              count = upcomingBookings.filter((b: Booking) => locationFilter === 'all' || b.locationName === locationFilter).length;
            } else if (filter.key === 'past') {
              count = pastBookings.filter((b: Booking) => locationFilter === 'all' || b.locationName === locationFilter).length;
            } else {
              count = baseBookings.filter((b: Booking) => b.status === filter.key).length;
            }

            return (
              <button
                key={filter.key}
                onClick={() => setStatusFilter(filter.key)}
                className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${statusFilter === filter.key
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                {filter.label}
                <span className="ml-2 text-sm">
                  ({count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Bookings List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-4">
            <DataTable
              columns={getBookingColumns({
                onConfirm: (id) => {
                  if (!hasApprovedLicense) {
                    toast({
                      title: "License Not Approved",
                      description: "Your kitchen license must be approved by an admin before you can confirm bookings.",
                      variant: "destructive",
                    });
                    return;
                  }
                  handleConfirm(id);
                },
                onReject: handleCancelClick, // Reuse cancel click for reject as it opens same dialog or we might need differentiation. 
                // Wait, existing code uses handleCancelClick for Reject too?
                // Line 539: onClick={() => handleCancelClick(booking)} for Reject button. Yes.
                onCancel: handleCancelClick,
                hasApprovedLicense
              })}
              data={filteredBookings}
              filterColumn="chefName" // filter by Chef name by default
              filterPlaceholder="Filter by chef..."
            />
          </div>
        )}
      </div>

      {/* Cancellation Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {bookingToCancel?.status === 'pending' ? 'Reject Booking Request' : 'Cancel Booking Confirmation'}
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-4">
              <div className="space-y-3">
                <p className="font-medium">
                  {bookingToCancel?.status === 'pending'
                    ? "Are you sure you want to reject this request?"
                    : "Are you sure you want to cancel this booking? This action cannot be undone."}
                </p>
                {bookingToCancel && (
                  <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Chef:</span>
                      <span>{bookingToCancel.chefName || `Chef #${bookingToCancel.chefId}`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Kitchen:</span>
                      <span>{bookingToCancel.kitchenName || 'Kitchen'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Date:</span>
                      <span>{formatDate(bookingToCancel.bookingDate)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Time:</span>
                      <span>
                        {(() => {
                          const rawSlots = bookingToCancel.selectedSlots as Array<string | { startTime: string; endTime: string }> | undefined;
                          if (rawSlots && rawSlots.length > 0) {
                            // Normalize slots to handle both old string format and new object format
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
                            if (!isContiguous) {
                              return sorted.map(s => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`).join(', ');
                            }
                          }
                          return `${formatTime(bookingToCancel.startTime)} - ${formatTime(bookingToCancel.endTime)}`;
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                <p className="text-muted-foreground mt-3">
                  The chef will be notified via email.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDialogClose}>Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              className="bg-destructive hover:bg-destructive/90 focus:ring-destructive"
              disabled={updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending ? 'Processing...' : (bookingToCancel?.status === 'pending' ? 'Reject Request' : 'Yes, Cancel Booking')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ManagerHeader />
      {content}
    </div>
  );
}

