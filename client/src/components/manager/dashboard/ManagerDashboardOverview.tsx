import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Clock,
    Check,
    BookOpen,
    X,
    MapPin,
    ChefHat,
    User,
    Boxes,
    Package,
    Eye,
} from "lucide-react";
// We will stick to the existing calendar for now to minimize logic breakage, 
// but encapsulate it better. 
// Ideally we would move to Shadcn Calendar (react-day-picker) but that requires rewrite of modifiers.
// For "Standardization", wrapping the external lib in a semantic container is acceptable if standard UI elements wrap it.
import CalendarComponent from 'react-calendar';
import 'react-calendar/dist/Calendar.css';

import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RevenueMetricCards } from "@/components/manager/revenue/components/RevenueMetricCards";
import type { RevenueMetrics } from "@/components/manager/revenue/types";
import { tt } from "@/i18n/common-ns";

// Storage/Equipment item types
interface StorageItem {
    id: number;
    storageListingId: number;
    name: string;
    storageType: string;
    totalPrice: number;
}

interface EquipmentItem {
    id: number;
    equipmentListingId: number;
    name: string;
    totalPrice: number;
}

// Define strict types
interface Booking {
    id: number;
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
    bookingDate: string;
    startTime: string;
    endTime: string;
    kitchenName?: string;
    locationName?: string;
    chefName?: string;
    specialNotes?: string;
    storageItems?: StorageItem[];
    equipmentItems?: EquipmentItem[];
}

interface Location {
    id: number;
    name: string;
    address: string;
    logoUrl?: string;
}

interface ManagerDashboardOverviewProps {
    selectedLocation: Location | null;
    onNavigate: (view: 'bookings' | 'overview') => void;
}


export function ManagerDashboardOverview({ selectedLocation: _selectedLocation, onNavigate }: ManagerDashboardOverviewProps) {
  
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    // Fetch revenue metrics for the overview
    const { data: revenueMetrics, isLoading: isLoadingRevenue } = useQuery<RevenueMetrics>({
        queryKey: ['managerRevenueOverview'],
        queryFn: async () => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) {
                throw new Error(tt("firebaseUserNotAvailable"));
            }

            const token = await currentFirebaseUser.getIdToken();
            const headers: HeadersInit = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };

            // Get current month's revenue
            const today = new Date();
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            const startDate = startOfMonth.toISOString().split('T')[0];
            const endDate = endOfMonth.toISOString().split('T')[0];

            const response = await fetch(`/api/manager/revenue/overview?startDate=${startDate}&endDate=${endDate}`, {
                headers,
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error(tt("failedToFetchRevenueMetrics"));
            }

            return await response.json();
        },
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    });

    // Use the same query as ManagerBookingsPanel for consistency and real-time updates
    const { data: bookings = [], isLoading: isLoadingBookings } = useQuery<Booking[]>({
        queryKey: ['managerBookings'],
        queryFn: async () => {
            // Get Firebase token for authentication
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) {
                throw new Error(tt("firebaseUserNotAvailable"));
            }

            const token = await currentFirebaseUser.getIdToken();
            const headers: HeadersInit = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };

            const response = await fetch('/api/manager/bookings', {
                headers,
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error(tt("failedToFetchBookings"));
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            return [];
        },
        // Real-time polling
        refetchInterval: (data) => {
            if (!data || !Array.isArray(data)) return 10000;
            const hasPendingBookings = data.some((b) => b.status === "pending");
            const hasUpcomingBookings = data.some((b) => {
                try {
                    const bookingDate = new Date(b.bookingDate);
                    return bookingDate >= new Date();
                } catch {
                    return false;
                }
            });
            if (hasPendingBookings) return 5000;
            if (hasUpcomingBookings) return 15000;
            return 30000;
        },
        refetchIntervalInBackground: true,
    });

    const { data: viewings = [], isLoading: isLoadingViewings } = useQuery<any[]>({
        queryKey: ['managerViewings'],
        queryFn: async () => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) {
                throw new Error(tt("firebaseUserNotAvailable"));
            }
            const token = await currentFirebaseUser.getIdToken();
            const headers: HeadersInit = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };
            const response = await fetch('/api/viewings/manager', {
                headers,
                credentials: "include",
            });
            if (!response.ok) throw new Error(tt("failedToFetchViewings"));
            return await response.json();
        },
        refetchInterval: 15000,
    });

    const pendingBookings = bookings.filter((b) => b.status === "pending");
    const confirmedBookings = bookings.filter((b) => b.status === "confirmed");
    const pendingTours = viewings.filter((v: any) => v.viewing.status === "pending");
    const confirmedTours = viewings.filter((v: any) => v.viewing.status === "confirmed");

    // Helper function to normalize date to YYYY-MM-DD format
    const normalizeDate = (date: Date | string): string => {
        try {
            const d = typeof date === 'string' ? new Date(date) : date;
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (error) {
            logger.error('Error normalizing date:', error);
            return '';
        }
    };

    // Group bookings by date
    const bookingsByDate = useMemo(() => {
        const grouped: { [key: string]: Booking[] } = {};
        bookings.forEach((booking) => {
            if (!booking.bookingDate) return;
            const dateStr = normalizeDate(booking.bookingDate);
            if (!dateStr) return;

            if (!grouped[dateStr]) {
                grouped[dateStr] = [];
            }
            grouped[dateStr].push(booking);
        });
        return grouped;
    }, [bookings]);

    // Group viewings by date
    const viewingsByDate = useMemo(() => {
        const grouped: { [key: string]: any[] } = {};
        viewings.forEach((v: any) => {
            if (!v.viewing?.scheduledAt) return;
            const dateStr = normalizeDate(v.viewing.scheduledAt);
            if (!dateStr) return;

            if (!grouped[dateStr]) {
                grouped[dateStr] = [];
            }
            grouped[dateStr].push(v);
        });
        return grouped;
    }, [viewings]);

    // Get bookings for a specific date
    const getBookingsForDate = (date: Date): Booking[] => {
        const dateStr = normalizeDate(date);
        return bookingsByDate[dateStr] || [];
    };

    const getViewingsForDate = (date: Date): any[] => {
        const dateStr = normalizeDate(date);
        return viewingsByDate[dateStr] || [];
    };

    // Custom tile content with booking indicators
    const tileContent = ({ date, view }: { date: Date; view: string }) => {
        if (view !== 'month') return null;
        const dateBookings = getBookingsForDate(date);
        const dateViewings = getViewingsForDate(date);
        if (dateBookings.length === 0 && dateViewings.length === 0) return null;

        const pendingBookingsCount = dateBookings.filter((b) => b.status === 'pending').length;
        const confirmedBookingsCount = dateBookings.filter((b) => b.status === 'confirmed').length;
        const cancelledBookingsCount = dateBookings.filter((b) => b.status === 'cancelled').length;
        
        const hasTours = dateViewings.length > 0;

        return (
            <div className="absolute bottom-1 left-0 right-0 flex items-center justify-center gap-1 px-1">
                {pendingBookingsCount > 0 && (
                    <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full" title={`${pendingBookingsCount} pending`}></div>
                )}
                {confirmedBookingsCount > 0 && (
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full" title={`${confirmedBookingsCount} confirmed`}></div>
                )}
                {hasTours && (
                    <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" title={`${dateViewings.length} viewings`}></div>
                )}
                {cancelledBookingsCount > 0 && (
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" title={`${cancelledBookingsCount} cancelled`}></div>
                )}
            </div>
        );
    };

    // Custom tile className for dates with bookings
    const tileClassName = ({ date, view }: { date: Date; view: string }) => {
        if (view !== 'month') return '';
        const dateBookings = getBookingsForDate(date);
        const dateViewings = getViewingsForDate(date);
        if (dateBookings.length === 0 && dateViewings.length === 0) return '';

        const hasPending = dateBookings.some((b) => b.status === 'pending');
        const hasConfirmed = dateBookings.some((b) => b.status === 'confirmed');

        let classes = [];
        if (hasPending) classes.push('has-pending-booking');
        else if (hasConfirmed) classes.push('has-confirmed-booking');
        else if (dateBookings.length > 0) classes.push('has-booking');
        
        if (dateViewings.length > 0) classes.push('has-viewing');

        return classes.join(' ');
    };

    return (
        <div className="space-y-6">
            {/* Revenue Summary - This Month - Using standardized RevenueMetricCards */}
            <RevenueMetricCards metrics={revenueMetrics ?? null} isLoading={isLoadingRevenue} />

            {/* Booking Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="hover:shadow-lg transition-all duration-300 border-l-4 border-l-yellow-400">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">{mt("pendingReview")}</p>
                                <p className="text-3xl font-bold mt-1 text-foreground">{pendingBookings.length}</p>
                            </div>
                            <div className="p-3 bg-yellow-100 rounded-full">
                                <Clock className="h-6 w-6 text-yellow-600" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="hover:shadow-lg transition-all duration-300 border-l-4 border-l-green-500">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">{mt("confirmed")}</p>
                                <p className="text-3xl font-bold mt-1 text-foreground">{confirmedBookings.length}</p>
                            </div>
                            <div className="p-3 bg-green-100 rounded-full">
                                <Check className="h-6 w-6 text-green-600" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="hover:shadow-lg transition-all duration-300 border-l-4 border-l-primary">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">{mt("totalBookings")}</p>
                                <p className="text-3xl font-bold mt-1 text-foreground">{bookings.length}</p>
                            </div>
                            <div className="p-3 bg-blue-100 rounded-full">
                                <BookOpen className="h-6 w-6 text-blue-600" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Modern Calendar */}
            <Card>
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0 pb-4">
                    <div className="flex items-center gap-3">
                        <CardTitle className="text-xl">{mt("bookingCalendar")}</CardTitle>
                        {isLoadingBookings && (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-2 sm:mt-0">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                            <span>{mt("pendingBooking")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>{mt("confirmedBooking")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span>{mt("viewing")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                            <span>{mt("cancelled")}</span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="react-calendar-wrapper">
                        {isLoadingBookings && bookings.length === 0 ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="text-center">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                                    <p className="text-muted-foreground">{mt("loadingBookings")}</p>
                                </div>
                            </div>
                        ) : (
                            <CalendarComponent
                                onChange={(value: any) => setSelectedDate(value)}
                                value={selectedDate}
                                tileContent={tileContent}
                                tileClassName={tileClassName}
                                className="w-full border-0 font-sans"
                                locale="en-US"
                            />
                        )}
                    </div>
                    <style>{`
            .react-calendar-wrapper .react-calendar {
              width: 100%;
              border: none;
              font-family: inherit;
            }
            .react-calendar-wrapper .react-calendar__tile {
              position: relative;
              height: 60px;
              padding: 8px;
              font-size: 14px;
            }
            .react-calendar-wrapper .react-calendar__tile--now {
              background: hsl(var(--accent));
              color: hsl(var(--accent-foreground));
            }
            .react-calendar-wrapper .react-calendar__tile--active {
              background: hsl(var(--primary));
              color: hsl(var(--primary-foreground));
            }
            .react-calendar-wrapper .react-calendar__tile.has-pending-booking {
              border: 2px solid #f59e0b;
            }
            .react-calendar-wrapper .react-calendar__tile.has-confirmed-booking {
              border: 2px solid #10b981;
            }
            .react-calendar-wrapper .react-calendar__tile.has-booking {
              border: 1px solid #cbd5e1;
            }
            .react-calendar-wrapper .react-calendar__tile.has-viewing {
              border: 1px solid #a855f7;
            }
            .react-calendar-wrapper .react-calendar__navigation {
              margin-bottom: 1rem;
            }
            .react-calendar-wrapper .react-calendar__navigation button {
              font-size: 16px;
              font-weight: 600;
            }
          `}</style>
                </CardContent>
            </Card>

            {/* Selected Date Details */}
            {selectedDate && (
                <Card className="animate-in fade-in slide-in-from-bottom-5 duration-300">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 gap-4">
                        <CardTitle className="text-lg leading-tight">
                            Bookings for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </CardTitle>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedDate(null)}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {isLoadingBookings || isLoadingViewings ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : getBookingsForDate(selectedDate).length === 0 && getViewingsForDate(selectedDate).length === 0 ? (
                            <div className="text-center py-8">
                                <Clock className="h-12 w-12 text-muted mx-auto mb-3" />
                                <p className="text-muted-foreground">{mt("noBookingsOrViewingsOnThisDate")}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {getBookingsForDate(selectedDate).map((booking) => {
                                    const formatTime = (time: string) => {
                                        if (!time) return '';
                                        const [hours, minutes] = time.split(':');
                                        const hour = parseInt(hours);
                                        const ampm = hour >= 12 ? 'PM' : 'AM';
                                        const displayHour = hour % 12 || 12;
                                        return `${displayHour}:${minutes} ${ampm}`;
                                    };

                                    return (
                                        <div
                                            key={`booking-${booking.id}`}
                                            className={cn(
                                                "p-4 rounded-lg border flex flex-col sm:flex-row sm:items-start justify-between gap-4",
                                                booking.status === 'pending' ? "bg-yellow-50 border-yellow-200" :
                                                    booking.status === 'confirmed' ? "bg-green-50 border-green-200" :
                                                        "bg-muted/50 border-border"
                                            )}
                                        >
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    <Badge
                                                        variant={
                                                            booking.status === 'pending' ? "outline" :
                                                                booking.status === 'confirmed' ? "default" :
                                                                    "secondary"
                                                        }
                                                        className={
                                                            booking.status === 'pending' ? "text-yellow-800 border-yellow-300 bg-yellow-100" :
                                                                booking.status === 'confirmed' ? "bg-success text-success-foreground hover:bg-success/90" :
                                                                    ""
                                                        }
                                                    >
                                                        {booking.status.toUpperCase()}
                                                    </Badge>
                                                    <span className="text-sm font-medium flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                                                    </span>
                                                </div>
                                                {booking.kitchenName && (
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                                                        <ChefHat className="h-3 w-3" />
                                                        {booking.kitchenName}
                                                    </p>
                                                )}
                                                {booking.locationName && (
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                                                        <MapPin className="h-3 w-3" />
                                                        {booking.locationName}
                                                    </p>
                                                )}
                                                {booking.chefName && (
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                                                        <User className="h-3 w-3" />
                                                        Chef: {booking.chefName}
                                                    </p>
                                                )}
                                                {/* Storage & Equipment Add-ons */}
                                                {((booking.storageItems && booking.storageItems.length > 0) || 
                                                  (booking.equipmentItems && booking.equipmentItems.length > 0)) && (
                                                    <div className="mt-2 p-2 bg-background rounded border">
                                                        <p className="text-xs font-medium text-muted-foreground mb-1.5">{mt("addOns")}</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {booking.storageItems?.map((item, idx) => (
                                                                <Badge key={`s-${idx}`} variant="outline" className="text-xs gap-1">
                                                                    <Boxes className="h-3 w-3" />
                                                                    {item.name} ({item.storageType})
                                                                </Badge>
                                                            ))}
                                                            {booking.equipmentItems?.map((item, idx) => (
                                                                <Badge key={`e-${idx}`} variant="outline" className="text-xs gap-1">
                                                                    <Package className="h-3 w-3" />
                                                                    {item.name}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {booking.specialNotes && (
                                                    <div className="mt-2 p-2 bg-background rounded border text-xs text-muted-foreground">
                                                        <span className="font-medium">{mt("notes")}</span> {booking.specialNotes}
                                                    </div>
                                                )}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => onNavigate('bookings')}
                                                className="w-full sm:w-auto text-primary hover:text-primary hover:bg-primary/10"
                                            >{mt("viewDetails")}</Button>
                                        </div>
                                    );
                                })}

                                {getViewingsForDate(selectedDate).map((viewingRec) => {
                                    const formatTime = (isoString: string, durationMins: number) => {
                                        if (!isoString) return '';
                                        const d = new Date(isoString);
                                        const startTimeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                        const dEnd = new Date(d.getTime() + durationMins * 60000);
                                        const endTimeStr = dEnd.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                        return `${startTimeStr} - ${endTimeStr}`;
                                    };

                                    return (
                                        <div
                                            key={`viewing-${viewingRec.viewing.id}`}
                                            className={cn(
                                                "p-4 rounded-lg border flex flex-col sm:flex-row sm:items-start justify-between gap-4",
                                                viewingRec.viewing.status === 'pending' ? "bg-purple-50 border-purple-200" :
                                                    viewingRec.viewing.status === 'confirmed' ? "bg-green-50 border-green-200" :
                                                        "bg-muted/50 border-border"
                                            )}
                                        >
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    <Badge className="bg-purple-600 text-white hover:bg-purple-700">
                                                        VIEWING
                                                    </Badge>
                                                    <Badge
                                                        variant={
                                                            viewingRec.viewing.status === 'pending' ? "outline" :
                                                                viewingRec.viewing.status === 'confirmed' ? "default" :
                                                                    "secondary"
                                                        }
                                                        className={
                                                            viewingRec.viewing.status === 'pending' ? "text-purple-800 border-purple-300 bg-purple-100" :
                                                                viewingRec.viewing.status === 'confirmed' ? "bg-success text-success-foreground hover:bg-success/90" :
                                                                    ""
                                                        }
                                                    >
                                                        {viewingRec.viewing.status.toUpperCase()}
                                                    </Badge>
                                                    <span className="text-sm font-medium flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatTime(viewingRec.viewing.scheduledAt, viewingRec.viewing.durationMinutes)}
                                                    </span>
                                                </div>
                                                {viewingRec.kitchenName && (
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                                                        <ChefHat className="h-3 w-3" />
                                                        {viewingRec.kitchenName}
                                                    </p>
                                                )}
                                                {viewingRec.locationName && (
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                                                        <MapPin className="h-3 w-3" />
                                                        {viewingRec.locationName}
                                                    </p>
                                                )}
                                                {(viewingRec.chefName || viewingRec.chefUsername) && (
                                                    <div className="flex items-center text-gray-600 mt-1">
                                                        <User className="h-3 w-3 mr-1 text-gray-400" />
                                                        Chef: {viewingRec.chefName || viewingRec.chefUsername?.split('@')[0]}
                                                    </div>
                                                )}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    // Since Viewings are managed from the Bookings Dashboard's "Viewings" tab now
                                                    // if we are using tabs, we just route to bookings (ManagerDashboard routes Viewings properly if it knows)
                                                    // Let's call onNavigate('bookings') which opens ManagerBookingDashboard.
                                                    // ManagerBookingDashboard doesn't take tab argument via this prop currently,
                                                    // but the user can select the "Kitchen Viewings" tab once there.
                                                    onNavigate('bookings')
                                                }}
                                                className="w-full sm:w-auto text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                            >
                                                <Eye className="w-4 h-4 mr-2" />{mt("viewDetails")}</Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
