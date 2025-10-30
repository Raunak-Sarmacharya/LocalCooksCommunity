import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Calendar, User, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";

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
}

async function getAuthHeaders(): Promise<HeadersInit> {
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
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Fetch all bookings for this manager with real-time polling
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['managerBookings'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/bookings', {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error('Failed to fetch bookings');
      }
      return response.json();
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
        const error = await response.json();
        throw new Error(error.message || 'Failed to update booking status');
      }
      return response.json();
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

  const handleReject = (bookingId: number) => {
    if (window.confirm('Are you sure you want to cancel this booking?')) {
      updateStatusMutation.mutate({ bookingId, status: 'cancelled' });
    }
  };

  const filteredBookings = bookings.filter((booking: Booking) => {
    if (statusFilter === 'all') return true;
    return booking.status === statusFilter;
  });

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
          <div className="flex gap-4 mb-6 border-b">
            {['all', 'pending', 'confirmed', 'cancelled'].map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-4 py-2 font-medium capitalize transition-colors ${
                  statusFilter === filter
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {filter}
                <span className="ml-2 text-sm">
                  ({filter === 'all' ? bookings.length : bookings.filter((b: Booking) => b.status === filter).length})
                </span>
              </button>
            ))}
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
              {filteredBookings.map((booking: Booking) => (
                <div
                  key={booking.id}
                  className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">
                        {booking.kitchenName || 'Kitchen'}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <MapPin className="h-4 w-4" />
                          <span>{booking.locationName || 'Location'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <User className="h-4 w-4" />
                          <span>Chef {booking.chefName || `#${booking.chefId}`}</span>
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
                        onClick={() => handleConfirm(booking.id)}
                        disabled={updateStatusMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Confirm Booking
                      </button>
                      <button
                        onClick={() => handleReject(booking.id)}
                        disabled={updateStatusMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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

