import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Calendar, User, MapPin, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
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
import { auth } from "@/lib/firebase";

interface Booking {
  id: number;
  kitchenId: number;
  chefId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
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

  // Filter bookings based on status filter and time category
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
    
    return filtered;
  }, [bookings, statusFilter, upcomingBookings, pastBookings]);

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
    <main className={embedded ? "flex-1 py-6" : "flex-1 pt-24 pb-8"}>
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Booking Requests</h1>
            <p className="text-gray-600 mt-2">Review and manage chef booking requests</p>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-4 mb-6 border-b overflow-x-auto">
            {[
              { key: 'all', label: 'All Bookings' },
              { key: 'upcoming', label: 'Upcoming' },
              { key: 'past', label: 'Past' },
              { key: 'pending', label: 'Pending' },
              { key: 'cancelled', label: 'Cancelled' },
            ].map((filter) => {
              let count = 0;
              if (filter.key === 'all') {
                count = bookings.length;
              } else if (filter.key === 'upcoming') {
                count = upcomingBookings.length;
              } else if (filter.key === 'past') {
                count = pastBookings.length;
              } else {
                count = bookings.filter((b: Booking) => b.status === filter.key).length;
              }

              return (
                <button
                  key={filter.key}
                  onClick={() => setStatusFilter(filter.key)}
                  className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${
                    statusFilter === filter.key
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
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No bookings found</h3>
              <p className="text-gray-600">
                {statusFilter === 'all' 
                  ? "You don't have any bookings yet" 
                  : `No ${statusFilter} bookings`}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredBookings.map((booking: Booking) => {
                return (
                <div
                  key={booking.id}
                  className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-xl font-semibold text-gray-900">
                          {booking.kitchenName || 'Kitchen'}
                        </h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <MapPin className="h-4 w-4" />
                          <span>{booking.locationName || 'Location'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <User className="h-4 w-4" />
                          <span>{booking.chefName || `Chef #${booking.chefId}`}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Calendar className="h-4 w-4" />
                          <span>{formatDate(booking.bookingDate)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Clock className="h-4 w-4" />
                          <span>{formatTime(booking.startTime)} - {formatTime(booking.endTime)}</span>
                        </div>
                      </div>
                      {booking.specialNotes && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-md">
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">Notes: </span>
                            {booking.specialNotes}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="ml-4">
                      {getStatusBadge(booking.status)}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  {booking.status === 'pending' && (
                    <div className="flex gap-3 mt-4 pt-4 border-t">
                      <button
                        onClick={() => {
                          if (!hasApprovedLicense) {
                            toast({
                              title: "License Not Approved",
                              description: "Your kitchen license must be approved by an admin before you can confirm bookings.",
                              variant: "destructive",
                            });
                            return;
                          }
                          handleConfirm(booking.id);
                        }}
                        disabled={updateStatusMutation.isPending || !hasApprovedLicense}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title={!hasApprovedLicense ? "Kitchen license must be approved before confirming bookings" : ""}
                      >
                        <CheckCircle className="h-4 w-4" />
                        Confirm Booking
                      </button>
                      <button
                        onClick={() => handleCancelClick(booking)}
                        disabled={updateStatusMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  )}
                  
                  {booking.status === 'confirmed' && (() => {
                    // Check if booking time has passed
                    const bookingDateTime = new Date(`${booking.bookingDate.split('T')[0]}T${booking.startTime}`);
                    const isBookingPast = bookingDateTime < new Date();
                    
                    // Only show cancel button if booking hasn't started yet
                    if (isBookingPast) {
                      return null;
                    }
                    
                    return (
                      <div className="flex gap-3 mt-4 pt-4 border-t">
                        <button
                          onClick={() => handleCancelClick(booking)}
                          disabled={updateStatusMutation.isPending}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <XCircle className="h-4 w-4" />
                          Cancel Booking
                        </button>
                      </div>
                    );
                  })()}
                </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Cancellation Confirmation Dialog */}
        <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Cancel Booking Confirmation
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-4">
                <div className="space-y-3">
                  <p className="font-medium">
                    Are you sure you want to cancel this booking? This action cannot be undone.
                  </p>
                  {bookingToCancel && (
                    <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
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
                        <span>{formatTime(bookingToCancel.startTime)} - {formatTime(bookingToCancel.endTime)}</span>
                      </div>
                    </div>
                  )}
                  <p className="text-gray-600 mt-3">
                    The chef will be notified via email that their booking has been cancelled.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancelDialogClose}>Keep Booking</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancelConfirm}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                disabled={updateStatusMutation.isPending}
              >
                {updateStatusMutation.isPending ? 'Cancelling...' : 'Yes, Cancel Booking'}
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
      <Footer />
    </div>
  );
}

