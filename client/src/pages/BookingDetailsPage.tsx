import { useState, useEffect, useMemo } from "react";
import { useLocation, useRoute } from "wouter";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import ManagerBookingLayout from "@/layouts/ManagerBookingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  User,
  ChefHat,
  Package,
  Wrench,
  DollarSign,
  FileText,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CreditCard,
  Phone,
  Mail,
  Receipt,
} from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";

interface BookingDetails {
  id: number;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<{ startTime: string; endTime: string }>;
  status: string;
  paymentStatus?: string;
  specialNotes?: string;
  totalPrice?: number;
  hourlyRate?: number;
  durationHours?: number;
  serviceFee?: number;
  currency?: string;
  createdAt: string;
  updatedAt?: string;
  paymentIntentId?: string;
  kitchen?: {
    id: number;
    name: string;
    description?: string;
    photos?: string[];
    locationId: number;
  };
  location?: {
    id: number;
    name: string;
    address?: string;
    timezone?: string;
  };
  chef?: {
    id: number;
    username: string;
    fullName?: string;
    phone?: string;
  };
  storageBookings?: Array<{
    id: number;
    storageListingId: number;
    startDate: string;
    endDate: string;
    totalPrice: number;
    status: string;
    storageListing?: {
      name: string;
      storageType: string;
      photos?: string[];
    };
  }>;
  equipmentBookings?: Array<{
    id: number;
    equipmentListingId: number;
    totalPrice: number;
    status: string;
    equipmentListing?: {
      equipmentType: string;
      brand?: string;
      photos?: string[];
    };
  }>;
  paymentTransaction?: {
    amount: number;
    serviceFee: number;
    managerRevenue: number;
    status: string;
    stripeProcessingFee?: number;
    paidAt?: string;
  };
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error("Error getting Firebase token:", error);
  }
  return {
    "Content-Type": "application/json",
  };
}

export default function BookingDetailsPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/booking/:id");
  const [, managerParams] = useRoute("/manager/booking/:id");
  const bookingId = params?.id || managerParams?.id;
  const isManagerView = !!managerParams?.id;

  useFirebaseAuth();
  const { toast } = useToast();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const queryClient = useQueryClient();

  const handleViewChange = (_view: string) => {
    navigate("/dashboard");
  };

  useEffect(() => {
    if (!bookingId) {
      setError("No booking ID provided");
      setIsLoading(false);
      return;
    }

    const fetchBookingDetails = async () => {
      try {
        const headers = await getAuthHeaders();
        const endpoint = isManagerView
          ? `/api/manager/bookings/${bookingId}/details`
          : `/api/chef/bookings/${bookingId}/details`;

        const response = await fetch(endpoint, {
          credentials: "include",
          headers,
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Booking not found");
          }
          if (response.status === 403) {
            throw new Error("You don't have permission to view this booking");
          }
          throw new Error("Failed to fetch booking details");
        }

        const data = await response.json();
        setBooking(data);
      } catch (err) {
        console.error("Error fetching booking details:", err);
        setError(err instanceof Error ? err.message : "Failed to load booking details");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBookingDetails();
  }, [bookingId, isManagerView]);

  const handleDownloadInvoice = async () => {
    if (!booking?.id) return;

    setIsDownloading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/bookings/${booking.id}/invoice`, {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to generate invoice");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;

      const bookingDate = booking.bookingDate
        ? new Date(booking.bookingDate).toISOString().split("T")[0]
        : "unknown";
      a.download = `LocalCooks-Invoice-${booking.id}-${bookingDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Invoice Downloaded",
        description: "Your invoice has been downloaded successfully!",
      });
    } catch (err) {
      console.error("Error downloading invoice:", err);
      toast({
        title: "Download Failed",
        description: err instanceof Error ? err.message : "Failed to download invoice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    const [hours, minutes] = timeStr.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (cents: number | undefined | null) => {
    if (cents === undefined || cents === null) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatBookingTimeSlots = (): string => {
    if (!booking) return "";
    const rawSlots = booking.selectedSlots;

    if (!rawSlots || rawSlots.length === 0) {
      return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`;
    }

    const sorted = [...rawSlots].sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );

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

    return sorted
      .map((s) => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`)
      .join(", ");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Confirmed
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pending Approval
          </Badge>
        );
      case "cancelled":
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200">
            <XCircle className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getPaymentStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "paid":
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CreditCard className="h-3 w-3 mr-1" />
            Paid
          </Badge>
        );
      case "processing":
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "refunded":
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-200">
            <Receipt className="h-3 w-3 mr-1" />
            Refunded
          </Badge>
        );
      default:
        return null;
    }
  };

  const calculateDuration = () => {
    if (!booking) return 0;
    if (booking.durationHours) return booking.durationHours;
    if (booking.selectedSlots && booking.selectedSlots.length > 0) {
      return booking.selectedSlots.length;
    }
    const [startH] = booking.startTime.split(":").map(Number);
    const [endH] = booking.endTime.split(":").map(Number);
    return endH - startH;
  };

  const totals = useMemo(() => {
    if (!booking) return { kitchen: 0, storage: 0, equipment: 0, subtotal: 0, tax: 0, total: 0 };

    const kitchenTotal = booking.totalPrice || 0;
    const storageTotal = booking.storageBookings?.reduce((sum, s) => sum + (s.totalPrice || 0), 0) || 0;
    const equipmentTotal = booking.equipmentBookings?.reduce((sum, e) => sum + (e.totalPrice || 0), 0) || 0;

    const subtotal = kitchenTotal;
    const serviceFee = booking.serviceFee || 0;

    return {
      kitchen: kitchenTotal - storageTotal - equipmentTotal,
      storage: storageTotal,
      equipment: equipmentTotal,
      subtotal: subtotal,
      serviceFee: serviceFee,
      total: subtotal,
    };
  }, [booking]);

  const handleUpdateStatus = async (status: 'confirmed' | 'cancelled') => {
    if (!booking?.id) return;

    const action = status === 'confirmed' ? 'confirm' : 'reject';
    if (!window.confirm(`${action === 'confirm' ? 'Confirm' : 'Reject'} this booking?`)) {
      return;
    }

    setIsUpdatingStatus(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${booking.id}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to ${action} booking`);
      }

      // Update local state
      setBooking({ ...booking, status });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });

      toast({
        title: "Success",
        description: status === 'confirmed' ? "Booking confirmed!" : "Booking rejected.",
      });
    } catch (err) {
      console.error(`Error ${action}ing booking:`, err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : `Failed to ${action} booking`,
        variant: "destructive",
      });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleBack = () => {
    if (isManagerView) {
      navigate("/manager/dashboard");
    } else {
      navigate("/dashboard");
    }
  };

  // Loading content
  const loadingContent = (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading booking details...</p>
      </div>
    </div>
  );

  // Error content
  const errorContent = (
    <div className="py-12">
      <Card className="max-w-2xl mx-auto bg-white shadow-md">
        <CardContent className="p-8 text-center">
          <div className="text-red-500 mb-4">
            <FileText className="h-12 w-12 mx-auto" />
          </div>
          <h1 className="text-2xl font-bold mb-4">Booking Not Found</h1>
          <p className="text-gray-600 mb-6">{error || "Unable to load booking details"}</p>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  // Main booking content
  const bookingContent = booking && (
    <div className="max-w-4xl mx-auto">
      <Card className="mb-6 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-blue-100 text-sm mb-1">Booking #{booking.id}</p>
              <h1 className="text-2xl md:text-3xl font-bold">
                {booking.kitchen?.name || "Kitchen Booking"}
              </h1>
              {booking.location && (
                <p className="text-blue-100 flex items-center mt-2">
                  <MapPin className="h-4 w-4 mr-1" />
                  {booking.location.name}
                  {booking.location.address && ` - ${booking.location.address}`}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {getStatusBadge(booking.status)}
              {getPaymentStatusBadge(booking.paymentStatus)}
              {isManagerView && booking.status === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus('confirmed')}
                    disabled={isUpdatingStatus}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {isUpdatingStatus ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleUpdateStatus('cancelled')}
                    disabled={isUpdatingStatus}
                  >
                    {isUpdatingStatus ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calendar className="h-5 w-5 text-blue-600" />
                Date & Time
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Date</p>
                  <p className="font-semibold text-gray-900">
                    {formatDate(booking.bookingDate)}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Duration</p>
                  <p className="font-semibold text-gray-900">
                    {calculateDuration()} hour{calculateDuration() !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <p className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Time Slots
                </p>
                <p className="font-semibold text-green-800 text-lg">
                  {formatBookingTimeSlots()}
                </p>
              </div>
            </CardContent>
          </Card>

          {booking.storageBookings && booking.storageBookings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Package className="h-5 w-5 text-purple-600" />
                  Storage Bookings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {booking.storageBookings.map((storage) => (
                    <div
                      key={storage.id}
                      className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {storage.storageListing?.name || `Storage #${storage.storageListingId}`}
                        </p>
                        <p className="text-sm text-gray-500">
                          {storage.storageListing?.storageType}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatShortDate(storage.startDate)} - {formatShortDate(storage.endDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-purple-700">
                          {formatCurrency(storage.totalPrice)}
                        </p>
                        <Badge variant="outline" className={storage.status === "active" ? "border-green-300 text-green-700" : "border-gray-300 text-gray-600"}>
                          {storage.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {booking.equipmentBookings && booking.equipmentBookings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wrench className="h-5 w-5 text-amber-600" />
                  Equipment Rentals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {booking.equipmentBookings.map((equipment) => (
                    <div
                      key={equipment.id}
                      className="flex items-center justify-between p-4 bg-amber-50 rounded-lg border border-amber-200"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {equipment.equipmentListing?.equipmentType || `Equipment #${equipment.equipmentListingId}`}
                        </p>
                        {equipment.equipmentListing?.brand && (
                          <p className="text-sm text-gray-500">{equipment.equipmentListing.brand}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-amber-700">
                          {formatCurrency(equipment.totalPrice)}
                        </p>
                        <Badge variant="outline" className={equipment.status === "active" ? "border-green-300 text-green-700" : "border-gray-300 text-gray-600"}>
                          {equipment.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {booking.specialNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-gray-600" />
                  Special Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">{booking.specialNotes}</p>
              </CardContent>
            </Card>
          )}

          {isManagerView && booking.chef && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User className="h-5 w-5 text-blue-600" />
                  Chef Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <ChefHat className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {booking.chef.fullName || booking.chef.username}
                    </p>
                    <p className="text-sm text-gray-500 flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {booking.chef.username}
                    </p>
                    {booking.chef.phone && (
                      <p className="text-sm text-gray-500 flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {booking.chef.phone}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="sticky top-24">
            <CardHeader className="bg-gradient-to-r from-gray-50 to-blue-50">
              <CardTitle className="flex items-center gap-2 text-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
                Payment Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    Kitchen ({calculateDuration()} hr{calculateDuration() !== 1 ? "s" : ""})
                  </span>
                  <span className="font-medium">
                    {formatCurrency(totals.kitchen > 0 ? totals.kitchen : booking.totalPrice)}
                  </span>
                </div>

                {totals.storage > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Storage</span>
                    <span className="font-medium text-purple-700">{formatCurrency(totals.storage)}</span>
                  </div>
                )}

                {totals.equipment > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Equipment</span>
                    <span className="font-medium text-amber-700">{formatCurrency(totals.equipment)}</span>
                  </div>
                )}

                <Separator />

                <div className="flex justify-between items-center pt-2">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="text-xl font-bold text-green-600">
                    {formatCurrency(booking.totalPrice)} {booking.currency || "CAD"}
                  </span>
                </div>

                {isManagerView && booking.paymentTransaction && (
                  <>
                    <Separator />
                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-medium text-gray-500 uppercase">Revenue Breakdown</p>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Gross Amount</span>
                        <span className="font-medium">{formatCurrency(booking.paymentTransaction.amount)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Platform Fee</span>
                        <span className="font-medium text-red-600">-{formatCurrency(booking.paymentTransaction.serviceFee)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-gray-900">Your Revenue</span>
                        <span className="text-green-600">{formatCurrency(booking.paymentTransaction.managerRevenue)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {booking.paymentStatus === "paid" && (
                <Button
                  onClick={handleDownloadInvoice}
                  disabled={isDownloading}
                  className="w-full mt-6 bg-blue-600 hover:bg-blue-700"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Download Invoice
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-gray-500">Booking Details</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Booking ID</span>
                <span className="font-mono text-gray-700">#{booking.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-700">{formatShortDate(booking.createdAt)}</span>
              </div>
              {booking.updatedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Updated</span>
                  <span className="text-gray-700">{formatShortDate(booking.updatedAt)}</span>
                </div>
              )}
              {booking.paymentIntentId && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment Ref</span>
                  <span className="font-mono text-xs text-gray-600 truncate max-w-[120px]">
                    {booking.paymentIntentId.slice(-8)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  // Render with appropriate layout
  if (isManagerView) {
    return (
      <ManagerBookingLayout
        breadcrumbs={[
          { label: "Dashboard", onClick: () => navigate("/manager/dashboard") },
          { label: "Bookings", onClick: () => navigate("/manager/dashboard") },
          { label: booking ? `Booking #${booking.id}` : "Booking Details" },
        ]}
      >
        {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
      </ManagerBookingLayout>
    );
  }

  // Chef view with ChefDashboardLayout
  return (
    <ChefDashboardLayout
      activeView="bookings"
      onViewChange={handleViewChange}
      breadcrumbs={[
        { label: "Dashboard", onClick: () => navigate("/dashboard") },
        { label: "My Bookings", onClick: () => navigate("/dashboard") },
        { label: booking ? `Booking #${booking.id}` : "Booking Details" },
      ]}
    >
      {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
    </ChefDashboardLayout>
  );
}
