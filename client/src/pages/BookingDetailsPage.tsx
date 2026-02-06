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
import {
  BookingActionSheet,
  type BookingForAction,
} from "@/components/manager/bookings/BookingActionSheet";

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
    taxRatePercent?: number;
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
    paymentStatus?: string;
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
    paymentStatus?: string;
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
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
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
      // Use different endpoints for chef vs manager
      const endpoint = isManagerView
        ? `/api/manager/revenue/invoices/${booking.id}`
        : `/api/bookings/${booking.id}/invoice`;
      
      const response = await fetch(endpoint, {
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
      case "authorized":
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200">
            <CreditCard className="h-3 w-3 mr-1" />
            Payment Held
          </Badge>
        );
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
      case "partially_refunded":
        return (
          <Badge className="bg-orange-100 text-orange-800 border-orange-200">
            <Receipt className="h-3 w-3 mr-1" />
            Partial Refund
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case "canceled":
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-200">
            <XCircle className="h-3 w-3 mr-1" />
            Canceled
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
    // PARTIAL CAPTURE AWARENESS: Only sum approved items (exclude rejected/failed)
    // After partial capture, rejected items have paymentStatus='failed' and status='cancelled'
    const storageTotal = booking.storageBookings?.reduce((sum, s) => {
      if (s.paymentStatus === 'failed' || s.status === 'cancelled') return sum;
      return sum + (s.totalPrice || 0);
    }, 0) || 0;
    const equipmentTotal = booking.equipmentBookings?.reduce((sum, e) => {
      if (e.paymentStatus === 'failed' || e.status === 'cancelled') return sum;
      return sum + (e.totalPrice || 0);
    }, 0) || 0;

    // Subtotal is kitchen + approved storage + approved equipment (what was actually charged)
    const subtotal = kitchenTotal + storageTotal + equipmentTotal;

    return {
      kitchen: kitchenTotal,
      storage: storageTotal,
      equipment: equipmentTotal,
      subtotal: subtotal,
      serviceFee: booking.serviceFee || 0,
      total: subtotal,
    };
  }, [booking]);

  // PARTIAL CAPTURE AWARENESS: Filtered lists for display (exclude rejected/failed items)
  // These are used for rendering storage/equipment sections — rejected items should not appear
  const approvedStorageBookings = useMemo(() => 
    booking?.storageBookings?.filter(s => s.paymentStatus !== 'failed' && s.status !== 'cancelled') || [],
    [booking]
  );
  const approvedEquipmentBookings = useMemo(() => 
    booking?.equipmentBookings?.filter(e => e.paymentStatus !== 'failed' && e.status !== 'cancelled') || [],
    [booking]
  );

  const openActionSheet = () => {
    setActionSheetOpen(true);
  };

  const bookingForAction: BookingForAction | null = booking ? {
    id: booking.id,
    kitchenName: booking.kitchen?.name,
    chefName: booking.chef?.fullName || booking.chef?.username,
    locationName: booking.location?.name,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: booking.totalPrice,
    transactionAmount: booking.paymentTransaction?.amount,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    // PARTIAL CAPTURE AWARENESS: Only include approved items in action sheet
    // Rejected items (paymentStatus='failed') should not appear as actionable
    storageItems: booking.storageBookings
      ?.filter((s) => s.paymentStatus !== 'failed' && s.status !== 'cancelled')
      .map((s) => ({
        id: s.id,
        storageBookingId: s.id,
        name: s.storageListing?.name || `Storage #${s.storageListingId}`,
        storageType: s.storageListing?.storageType || 'Storage',
        totalPrice: s.totalPrice,
        startDate: s.startDate,
        endDate: s.endDate,
      })),
    equipmentItems: booking.equipmentBookings
      ?.filter((e) => e.paymentStatus !== 'failed' && e.status !== 'cancelled')
      .map((e) => ({
        id: e.id,
        equipmentBookingId: e.id,
        name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
        totalPrice: e.totalPrice,
      })),
    paymentStatus: booking.paymentStatus,
  } : null;

  const handleApprovalSubmit = async (params: {
    bookingId: number;
    status: 'confirmed' | 'cancelled';
    storageActions?: Array<{ storageBookingId: number; action: string }>;
    equipmentActions?: Array<{ equipmentBookingId: number; action: string }>;
  }) => {
    if (!booking?.id) return;

    setIsUpdatingStatus(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${booking.id}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({
          status: params.status,
          storageActions: params.storageActions,
          equipmentActions: params.equipmentActions,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update booking`);
      }

      // Update local state — also update storage booking statuses
      const updatedStorageBookings = booking.storageBookings?.map((sb) => {
        const action = params.storageActions?.find((a) => a.storageBookingId === sb.id);
        return action ? { ...sb, status: action.action } : { ...sb, status: params.status };
      });
      setBooking({ ...booking, status: params.status, storageBookings: updatedStorageBookings });

      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });

      toast({
        title: "Success",
        description: params.status === 'confirmed' ? "Booking confirmed!" : "Booking rejected.",
      });
    } catch (err) {
      console.error('Error updating booking:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to update booking',
        variant: "destructive",
      });
    } finally {
      setIsUpdatingStatus(false);
      setActionSheetOpen(false);
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
                    onClick={openActionSheet}
                    disabled={isUpdatingStatus}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {isUpdatingStatus ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Take Action
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

          {approvedStorageBookings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Package className="h-5 w-5 text-purple-600" />
                  Storage Bookings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {approvedStorageBookings.map((storage) => (
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
                        <Badge variant="outline" className={
                          storage.status === "confirmed" ? "border-green-300 text-green-700 bg-green-50" :
                          storage.status === "cancelled" ? "border-red-300 text-red-700 bg-red-50" :
                          storage.status === "pending" ? "border-yellow-300 text-yellow-700 bg-yellow-50" :
                          storage.status === "active" ? "border-green-300 text-green-700 bg-green-50" :
                          "border-gray-300 text-gray-600"
                        }>
                          {storage.status === "confirmed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {storage.status === "cancelled" && <XCircle className="h-3 w-3 mr-1" />}
                          {storage.status === "pending" && <AlertCircle className="h-3 w-3 mr-1" />}
                          {storage.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {approvedEquipmentBookings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wrench className="h-5 w-5 text-amber-600" />
                  Equipment Rentals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {approvedEquipmentBookings.map((equipment) => (
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
                    {formatCurrency(totals.subtotal)} {booking.currency || "CAD"}
                  </span>
                </div>

                {/* AUTH-HOLD AWARENESS: Show prominent banner for authorized (held) payments */}
                {booking.paymentStatus === 'authorized' && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <CreditCard className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div className="text-xs text-blue-800">
                        <p className="font-semibold mb-0.5">Payment Held</p>
                        <p className="text-blue-700">
                          {isManagerView 
                            ? "This payment is authorized but not yet captured. Approve or reject from the action sheet to capture or release the hold."
                            : "Your card has been authorized. The charge will be finalized once the kitchen manager approves your booking."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chef View - Payment Breakdown (without Stripe fee) */}
                {!isManagerView && booking.paymentTransaction && (
                  <>
                    <Separator />
                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-medium text-gray-500 uppercase">Payment Breakdown</p>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Subtotal</span>
                        <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                      </div>
                      {(() => {
                        const taxRatePercent = booking.kitchen?.taxRatePercent || 0;
                        const subtotal = totals.subtotal || 0;
                        const taxAmount = Math.round((subtotal * taxRatePercent) / 100);
                        
                        return taxRatePercent > 0 ? (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Tax ({taxRatePercent}%)</span>
                            <span className="font-medium text-amber-600">{formatCurrency(taxAmount)}</span>
                          </div>
                        ) : null;
                      })()}
                      <Separator className="my-2" />
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-gray-900">
                          {booking.paymentStatus === 'authorized' ? 'Amount Authorized' : 'Amount Paid'}
                        </span>
                        <span className={booking.paymentStatus === 'authorized' ? 'text-blue-600' : 'text-green-600'}>
                          {formatCurrency(booking.paymentTransaction.amount)}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* Manager View - Revenue Breakdown (with Stripe fee) */}
                {isManagerView && booking.paymentTransaction && (
                  <>
                    <Separator />
                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-medium text-gray-500 uppercase">
                        {booking.paymentStatus === 'authorized' ? 'Authorization Details' : 'Revenue Breakdown'}
                      </p>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">
                          {booking.paymentStatus === 'authorized' ? 'Authorized Amount' : 'Gross Amount'}
                        </span>
                        <span className="font-medium">{formatCurrency(booking.paymentTransaction.amount)}</span>
                      </div>
                      {(() => {
                        const amount = booking.paymentTransaction.amount || 0;
                        const stripeFee = booking.paymentTransaction.stripeProcessingFee || 0;
                        const taxRatePercent = booking.kitchen?.taxRatePercent || 0;
                        const subtotal = totals.subtotal || 0;
                        const taxAmount = Math.round((subtotal * taxRatePercent) / 100);
                        const netRevenue = amount - taxAmount - stripeFee;
                        const isAuthorized = booking.paymentStatus === 'authorized';
                        
                        return (
                          <>
                            {taxRatePercent > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">
                                  {isAuthorized ? `Est. Tax (${taxRatePercent}%)` : `Tax Collected (${taxRatePercent}%)`}
                                </span>
                                <span className="font-medium text-amber-600">-{formatCurrency(taxAmount)}</span>
                              </div>
                            )}
                            {!isAuthorized && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Stripe Fee</span>
                                <span className="font-medium text-red-600">-{formatCurrency(stripeFee)}</span>
                              </div>
                            )}
                            <Separator className="my-2" />
                            <div className="flex justify-between text-sm font-semibold">
                              <span className="text-gray-900">
                                {isAuthorized ? 'Est. Net Revenue' : 'Your Net Revenue'}
                              </span>
                              <span className={isAuthorized ? 'text-blue-600' : 'text-green-600'}>
                                {formatCurrency(isAuthorized ? amount - taxAmount : netRevenue)}
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>

              {(booking.paymentStatus === "paid" || booking.paymentStatus === "partially_refunded") && (
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
        <BookingActionSheet
          open={actionSheetOpen}
          onOpenChange={setActionSheetOpen}
          booking={bookingForAction}
          isLoading={isUpdatingStatus}
          onSubmit={handleApprovalSubmit}
        />
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
