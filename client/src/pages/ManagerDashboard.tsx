import { Calendar, Clock, MapPin } from "lucide-react";
import { useState } from "react";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";

export default function ManagerDashboard() {
  const { locations, bookings, isLoadingLocations, isLoadingBookings } = useManagerDashboard();
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);

  const selectedBookings = selectedLocation
    ? bookings.filter(b => {
        // Would need to join kitchen data to filter by location
        return true;
      })
    : bookings;

  const pendingBookings = selectedBookings.filter(b => b.status === "pending");
  const confirmedBookings = selectedBookings.filter(b => b.status === "confirmed");

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <ManagerHeader />
      <main className="flex-1 pt-24 pb-8">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Manager Dashboard</h1>
            <p className="text-gray-600 mt-2">Manage your locations, kitchens, and bookings</p>
          </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Stats Cards */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-full">
              <Calendar className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Pending Bookings</p>
              <p className="text-2xl font-bold text-gray-900">{pendingBookings.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-full">
              <Clock className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Confirmed Bookings</p>
              <p className="text-2xl font-bold text-gray-900">{confirmedBookings.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 bg-purple-100 rounded-full">
              <MapPin className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Locations</p>
              <p className="text-2xl font-bold text-gray-900">{locations.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Locations Section */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Your Locations</h2>
        </div>
        <div className="p-6">
          {isLoadingLocations ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Loading locations...</p>
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No locations assigned yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {locations.map((location) => (
                <div
                  key={location.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedLocation === location.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedLocation(location.id)}
                >
                  <h3 className="font-semibold text-gray-900">{location.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{location.address}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bookings Section */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Recent Bookings</h2>
        </div>
        <div className="p-6">
          {isLoadingBookings ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Loading bookings...</p>
            </div>
          ) : selectedBookings.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No bookings yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedBookings.slice(0, 10).map((booking) => (
                <div
                  key={booking.id}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            booking.status === "confirmed"
                              ? "bg-green-100 text-green-800"
                              : booking.status === "pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {booking.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">
                        <Calendar className="inline h-4 w-4 mr-1" />
                        {formatDate(booking.bookingDate)}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        <Clock className="inline h-4 w-4 mr-1" />
                        {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                      </p>
                      {booking.specialNotes && (
                        <p className="text-sm text-gray-600 mt-2">
                          <span className="font-medium">Notes:</span> {booking.specialNotes}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
