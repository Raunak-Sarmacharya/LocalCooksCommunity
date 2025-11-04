import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Calendar, MapPin, ChefHat, Loader2 } from "lucide-react";
import { useLocation, Redirect } from "wouter";
import { useToast } from "@/hooks/use-toast";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect } from "react";

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
  locationName?: string;
}

export default function PortalBookingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Check authentication
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
        });
        if (response.ok) {
          const user = await response.json();
          const isPortalUser = user?.isPortalUser || user?.is_portal_user;
          setIsAuthenticated(isPortalUser);
          if (!isPortalUser) {
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  // Fetch portal user bookings
  const { data: bookings = [], isLoading } = useQuery<Booking[]>({
    queryKey: ['/api/portal/bookings'],
    queryFn: async () => {
      const response = await fetch('/api/portal/bookings', {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        if (response.status === 403) {
          throw new Error('Portal user access required');
        }
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch bookings');
      }
      return response.json();
    },
    enabled: isAuthenticated === true,
    refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
  });

  const handleLogout = async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
      queryClient.clear();
      window.location.href = "/portal/login";
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const filteredBookings = statusFilter === 'all' 
    ? bookings 
    : bookings.filter((b: Booking) => b.status === statusFilter);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Confirmed
          </span>
        );
      case 'pending':
        return (
          <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        );
      case 'cancelled':
        return (
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes || '00'} ${ampm}`;
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return <Redirect to="/portal/login" />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo className="h-10 w-auto" />
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Local Cooks Community</h1>
                <p className="text-sm text-gray-600">Commercial Kitchen Booking & Management</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => setLocation("/portal/book")}
                className="flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                Book Kitchen
              </Button>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="flex items-center gap-2"
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">My Bookings</h1>
            <p className="text-gray-600 mt-2">View and manage your kitchen bookings</p>
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
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredBookings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No bookings found</h3>
                <p className="text-gray-600 mb-4">
                  {statusFilter === 'all' 
                    ? "You don't have any bookings yet" 
                    : `No ${statusFilter} bookings`}
                </p>
                <Button
                  onClick={() => setLocation("/portal/book")}
                  className="mt-4"
                >
                  Book a Kitchen
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredBookings.map((booking: Booking) => (
                <Card key={booking.id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {getStatusBadge(booking.status)}
                          <span className="text-sm text-gray-600 flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(booking.bookingDate)}
                          </span>
                          <span className="text-sm text-gray-600 flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                          </span>
                        </div>
                        {booking.kitchenName && (
                          <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                            <ChefHat className="h-5 w-5 text-blue-600" />
                            {booking.kitchenName}
                          </h3>
                        )}
                        {booking.locationName && (
                          <p className="text-sm text-gray-600 flex items-center gap-1 mb-2">
                            <MapPin className="h-4 w-4" />
                            {booking.locationName}
                          </p>
                        )}
                        {booking.specialNotes && (
                          <p className="text-sm text-gray-700 mt-2 bg-gray-50 p-3 rounded">
                            <strong>Notes:</strong> {booking.specialNotes}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-4 pt-4 border-t">
                      Created: {new Date(booking.createdAt).toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

