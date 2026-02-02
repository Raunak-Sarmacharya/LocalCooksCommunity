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
  // Payment and refund fields
  totalPrice?: number;
  transactionAmount?: number;
  transactionId?: number;
  refundAmount?: number;
  // SIMPLE REFUND MODEL: Manager's balance is the cap
  // Stripe fee is a sunk cost — manager enters $X, customer gets $X, manager debited $X
  refundableAmount?: number; // Max refundable = manager's remaining balance
  stripeProcessingFee?: number; // Total Stripe processing fee (display only)
  managerRemainingBalance?: number; // Manager's remaining balance from this transaction
  managerRevenue?: number; // What manager originally received
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
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [bookingToRefund, setBookingToRefund] = useState<Booking | null>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');

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
    onSuccess: (data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      
      // Handle different response scenarios
      if (data?.requiresManualRefund) {
        // Cancellation of confirmed booking - needs manual refund
        toast({
          title: "Booking Cancelled",
          description: "Use 'Issue Refund' from the actions menu to process the refund.",
          variant: "default",
        });
      } else if (data?.refund) {
        // Rejection with auto-refund
        toast({
          title: "Booking Rejected & Refunded",
          description: `Refund of $${(data.refund.amount / 100).toFixed(2)} processed (customer absorbs Stripe fee).`,
        });
      } else {
        toast({
          title: "Success",
          description: status === 'confirmed' ? "Booking confirmed!" : "Booking cancelled",
        });
      }
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

  // Refund mutation
  const refundMutation = useMutation({
    mutationFn: async ({ transactionId, amountCents }: { transactionId: number; amountCents: number }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/revenue/transactions/${transactionId}/refund`, {
        method: 'POST',
        headers,
        credentials: "include",
        body: JSON.stringify({ amount: amountCents, reason: 'Refund issued by manager' }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to process refund');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/transactions'] });
      toast({
        title: "Refund Processed",
        description: "The refund has been successfully processed.",
      });
      setRefundDialogOpen(false);
      setBookingToRefund(null);
      setRefundAmount('');
    },
    onError: (error: Error) => {
      toast({
        title: "Refund Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRefundClick = (booking: Booking) => {
    setBookingToRefund(booking);
    // Default to full refund amount
    const refundableAmount = (booking as any).refundableAmount || (booking as any).totalPrice || 0;
    setRefundAmount((refundableAmount / 100).toFixed(2));
    setRefundDialogOpen(true);
  };

  const handleRefundConfirm = () => {
    if (bookingToRefund && refundAmount) {
      const amountCents = Math.round(parseFloat(refundAmount) * 100);
      const transactionId = (bookingToRefund as any).transactionId;
      if (transactionId && amountCents > 0) {
        refundMutation.mutate({ transactionId, amountCents });
      } else {
        toast({
          title: "Refund Error",
          description: "No transaction ID found for this booking. Please use the Revenue Dashboard to process refunds.",
          variant: "destructive",
        });
      }
    }
  };

  const handleRefundDialogClose = () => {
    setRefundDialogOpen(false);
    setBookingToRefund(null);
    setRefundAmount('');
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
                onReject: handleCancelClick,
                onCancel: handleCancelClick,
                onRefund: handleRefundClick,
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
                    : "Are you sure you want to cancel this booking?"}
                </p>
                {bookingToCancel?.status === 'pending' ? (
                  <p className="text-sm text-muted-foreground">
                    The customer will receive an automatic refund (minus non-refundable Stripe processing fee).
                  </p>
                ) : (
                  <p className="text-sm text-orange-600 font-medium">
                    ⚠️ Refunds are not automatic for confirmed bookings. After cancellation, use the &quot;Issue Refund&quot; action to process the refund manually.
                  </p>
                )}
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

      {/* Refund Dialog */}
      <AlertDialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-600">
              Issue Refund
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-4">
              <div className="space-y-4">
                <p className="font-medium">
                  Enter the refund amount for this booking:
                </p>
                {bookingToRefund && (
                  <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Chef:</span>
                      <span>{bookingToRefund.chefName || `Chef #${bookingToRefund.chefId}`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Kitchen:</span>
                      <span>{bookingToRefund.kitchenName || 'Kitchen'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Total Charged:</span>
                      <span>${((bookingToRefund.transactionAmount || bookingToRefund.totalPrice || 0) / 100).toFixed(2)}</span>
                    </div>
                    {(bookingToRefund.refundAmount || 0) > 0 && (
                      <div className="flex items-center gap-2 text-orange-600">
                        <span className="font-medium">Already Refunded:</span>
                        <span>${((bookingToRefund.refundAmount || 0) / 100).toFixed(2)}</span>
                      </div>
                    )}
                    {/* SIMPLE REFUND MODEL: Available balance is the cap */}
                    <div className="border-t pt-3 mt-3 space-y-2">
                      {(bookingToRefund.stripeProcessingFee || 0) > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Stripe Fee (non-refundable):</span>
                          <span>${((bookingToRefund.stripeProcessingFee || 0) / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between font-semibold text-green-600 bg-green-50 p-2 rounded-md">
                        <span>Available to Refund:</span>
                        <span>${((bookingToRefund.refundableAmount || 0) / 100).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Refund Input with Real-time Preview */}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label htmlFor="refundAmount" className="text-sm font-medium">
                      Refund Amount ($)
                    </label>
                    <input
                      id="refundAmount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={((bookingToRefund?.refundableAmount || 0) / 100).toFixed(2)}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Enter amount"
                    />
                  </div>
                  
                  {/* Real-time Refund Preview */}
                  {refundAmount && parseFloat(refundAmount) > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                      <div className="text-sm font-medium text-blue-800">Refund Preview</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">Customer Receives:</span>
                          <span className="font-semibold text-blue-900">${parseFloat(refundAmount).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">Your Account Debited:</span>
                          <span className="font-semibold text-blue-900">${parseFloat(refundAmount).toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="text-xs text-blue-600 mt-1">
                        ✓ Same amount for both — consistent with your Stripe dashboard
                      </div>
                    </div>
                  )}
                </div>
                
                <p className="text-muted-foreground text-xs">
                  Refunds typically arrive within 5-10 business days. The amount shown will be debited from your Stripe Connect balance and credited to the customer's original payment method.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleRefundDialogClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefundConfirm}
              className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500"
              disabled={refundMutation.isPending || !refundAmount || parseFloat(refundAmount) <= 0}
            >
              {refundMutation.isPending ? 'Processing...' : 'Process Refund'}
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

