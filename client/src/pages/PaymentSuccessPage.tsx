import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Download, ArrowLeft, Loader2, FileText } from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export default function PaymentSuccessPage() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const [booking, setBooking] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get booking ID from URL (supports both bookingId and booking_id params)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get('bookingId') || params.get('booking_id');

    if (!bookingId) {
      setError('No booking ID provided');
      setIsLoading(false);
      return;
    }

    // Fetch booking details
    const fetchBooking = async () => {
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        if (!currentUser) {
          setError('Please log in to view booking details');
          setIsLoading(false);
          return;
        }

        const token = await currentUser.getIdToken();
        const response = await fetch(`/api/chef/bookings/${bookingId}`, {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch booking details');
        }

        const bookingData = await response.json();
        // Normalize booking data structure
        const normalizedBooking = {
          ...bookingData,
          kitchenName: bookingData.kitchen?.name || bookingData.kitchenName || 'Kitchen',
          bookingDate: bookingData.bookingDate || bookingData.booking_date,
          startTime: bookingData.startTime || bookingData.start_time,
          endTime: bookingData.endTime || bookingData.end_time,
          selectedSlots: bookingData.selectedSlots || bookingData.selected_slots,
          status: bookingData.status,
        };
        setBooking(normalizedBooking);
      } catch (err: any) {
        console.error('Error fetching booking:', err);
        setError(err.message || 'Failed to load booking details');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBooking();
  }, []);

  const handleDownloadInvoice = async () => {
    if (!booking?.id) return;

    setIsDownloading(true);
    try {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) {
        toast({
          title: "Authentication Required",
          description: "Please log in to download invoice",
          variant: "destructive",
        });
        return;
      }

      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/bookings/${booking.id}/invoice`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to generate invoice');
      }

      // Handle PDF download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      
      // Generate filename with booking ID and date
      const bookingDate = booking.bookingDate ? new Date(booking.bookingDate).toISOString().split('T')[0] : 'unknown';
      a.download = `LocalCooks-Invoice-${booking.id}-${bookingDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Invoice Downloaded",
        description: "Your invoice has been downloaded successfully!",
      });
    } catch (err: any) {
      console.error('Error downloading invoice:', err);
      toast({
        title: "Download Failed",
        description: err.message || "Failed to download invoice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Helper to format discrete time slots for display
  const formatBookingTimeSlots = (): string => {
    if (!booking) return '';
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
    
    const normalized = rawSlots.map(normalizeSlot).filter((s: { startTime: string; endTime: string }) => s.startTime && s.endTime);
    const sorted = [...normalized].sort((a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime));
    
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
    return sorted.map((s: { startTime: string; endTime: string }) => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`).join(', ');
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-grow pt-20 md:pt-24 pb-12 md:pb-16 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading booking details...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-grow pt-20 md:pt-24 pb-12 md:pb-16">
          <div className="container mx-auto px-4">
            <Card className="max-w-2xl mx-auto bg-white shadow-md">
              <CardContent className="p-8 text-center">
                <div className="text-red-500 mb-4">
                  <FileText className="h-12 w-12 mx-auto" />
                </div>
                <h1 className="text-2xl font-bold mb-4">Booking Not Found</h1>
                <p className="text-gray-600 mb-6">{error || 'Unable to load booking details'}</p>
                <Button onClick={() => navigate('/dashboard')} variant="outline">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Go to Dashboard
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow pt-20 md:pt-24 pb-12 md:pb-16">
        <div className="container mx-auto px-4">
          <Card className="max-w-3xl mx-auto bg-white shadow-lg">
            <CardContent className="p-6 md:p-8">
              {/* Success Header */}
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Payment Confirmed!</h1>
                <p className="text-lg text-gray-600">
                  Your payment has been processed successfully. Your booking is now pending manager approval.
                </p>
              </div>

              {/* Pending Approval Notice */}
              {booking.status === 'pending' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
                    Awaiting Manager Approval
                  </h3>
                  <p className="text-sm text-yellow-800">
                    Your booking request has been submitted and is pending approval from the kitchen manager. 
                    You will receive an email confirmation once your booking is approved.
                  </p>
                </div>
              )}

              {/* Booking Details */}
              <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Booking Details</h2>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Booking ID:</span>
                    <span className="font-medium text-gray-900">#{booking.id}</span>
                  </div>
                  {booking.kitchenName && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Kitchen:</span>
                      <span className="font-medium text-gray-900">{booking.kitchenName}</span>
                    </div>
                  )}
                  {booking.bookingDate && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Date:</span>
                      <span className="font-medium text-gray-900">{formatDate(booking.bookingDate)}</span>
                    </div>
                  )}
                  {booking.startTime && booking.endTime && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Time:</span>
                      <span className="font-medium text-gray-900">
                        {formatBookingTimeSlots()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Status:</span>
                    <span className={`font-medium ${
                      booking.status === 'confirmed' ? 'text-green-600' : 
                      booking.status === 'pending' ? 'text-yellow-600' : 
                      'text-gray-600'
                    }`}>
                      {booking.status?.charAt(0).toUpperCase() + booking.status?.slice(1) || 'Pending'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Info */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                <h3 className="font-semibold text-green-900 mb-2">Payment Information</h3>
                <p className="text-sm text-green-800 mb-2">
                  Your payment has been successfully processed. The charge has been applied to your payment method.
                </p>
                <p className="text-sm text-green-700">
                  You will receive an email confirmation with your booking details.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleDownloadInvoice}
                  disabled={isDownloading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating Invoice...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Download Invoice
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => navigate('/dashboard')}
                  variant="outline"
                  className="flex-1"
                  size="lg"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Go to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
