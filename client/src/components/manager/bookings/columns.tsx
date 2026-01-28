"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, CheckCircle, XCircle, Clock, MapPin, User, Calendar as CalendarIcon, FileText, Package, Boxes, DollarSign } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

// Storage/Equipment item types from JSONB fields
export type StorageItem = {
    id: number;
    storageListingId: number;
    name: string;
    storageType: string;
    totalPrice: number; // in cents
    startDate?: string;
    endDate?: string;
}

export type EquipmentItem = {
    id: number;
    equipmentListingId: number;
    name: string;
    totalPrice: number; // in cents
}

// Define the Booking type
export type Booking = {
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
    storageItems?: StorageItem[];
    equipmentItems?: EquipmentItem[];
    // Price fields
    totalPrice?: number; // in cents - gross amount charged to customer
    serviceFee?: number; // in cents - platform fee (covers Stripe processing)
    hourlyRate?: number; // in cents
    durationHours?: number;
    paymentStatus?: string;
}

interface BookingColumnsProps {
    onConfirm: (bookingId: number) => void;
    onReject: (booking: Booking) => void;
    onCancel: (booking: Booking) => void;
    hasApprovedLicense: boolean;
}

const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
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

export const getBookingColumns = ({ onConfirm, onReject, onCancel, hasApprovedLicense }: BookingColumnsProps): ColumnDef<Booking>[] => [
    {
        accessorKey: "kitchenName",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Kitchen / Location
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => (
            <div className="flex flex-col">
                <span className="font-medium text-sm">{row.getValue("kitchenName") || 'Unknown Kitchen'}</span>
                <div className="flex items-center text-xs text-muted-foreground mt-0.5">
                    <MapPin className="h-3 w-3 mr-1" />
                    {row.original.locationName || 'Unknown Location'}
                </div>
            </div>
        ),
    },
    {
        accessorKey: "chefName",
        header: "Chef",
        cell: ({ row }) => (
            <div className="flex items-center text-sm">
                <User className="h-3 w-3 mr-2 text-muted-foreground" />
                {row.getValue("chefName") || `Chef #${row.original.chefId}`}
            </div>
        ),
    },
    {
        accessorKey: "bookingDate",
        header: ({ column }) => (
            <Button
                variant="ghost"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
                Date & Time
                <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => (
            <div className="flex flex-col text-sm">
                <div className="flex items-center">
                    <CalendarIcon className="h-3 w-3 mr-2 text-muted-foreground" />
                    {formatDate(row.getValue("bookingDate"))}
                </div>
                <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3 mr-2" />
                    {formatTime(row.original.startTime)} - {formatTime(row.original.endTime)}
                </div>
            </div>
        ),
    },
    {
        id: "addons",
        header: () => (
            <div className="flex items-center gap-1">
                <Boxes className="h-3.5 w-3.5" />
                <span>Rentals</span>
            </div>
        ),
        cell: ({ row }) => {
            const storageItems = row.original.storageItems || [];
            const equipmentItems = row.original.equipmentItems || [];
            const hasAddons = storageItems.length > 0 || equipmentItems.length > 0;

            if (!hasAddons) {
                return <span className="text-muted-foreground text-xs">—</span>;
            }

            const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

            return (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex flex-col gap-1 cursor-help max-w-[200px]">
                                {storageItems.length > 0 && (
                                    <div className="flex items-start gap-1.5">
                                        <Boxes className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                        <div className="text-xs">
                                            {storageItems.map((s, idx) => {
                                                const formatStorageDate = (dateStr?: string) => {
                                                    if (!dateStr) return '';
                                                    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                };
                                                // Use storage dates if available, otherwise fall back to booking date
                                                const startDate = s.startDate || row.original.bookingDate;
                                                const endDate = s.endDate || row.original.bookingDate;
                                                const dateRange = startDate === endDate 
                                                    ? formatStorageDate(startDate)
                                                    : `${formatStorageDate(startDate)} - ${formatStorageDate(endDate)}`;
                                                return (
                                                    <div key={idx} className="truncate">
                                                        {s.name} ({s.storageType}) <span className="text-muted-foreground">• {dateRange}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {equipmentItems.length > 0 && (
                                    <div className="flex items-start gap-1.5">
                                        <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                        <span className="text-xs truncate">
                                            {equipmentItems.map(e => e.name).join(', ')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                            <div className="space-y-2">
                                {storageItems.length > 0 && (
                                    <div>
                                        <p className="font-medium text-xs flex items-center gap-1 mb-1">
                                            <Boxes className="h-3 w-3" /> Storage Rentals
                                        </p>
                                        <ul className="text-xs space-y-1">
                                            {storageItems.map((item, idx) => {
                                                const formatStorageDate = (dateStr?: string) => {
                                                    if (!dateStr) return '';
                                                    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                };
                                                const dateRange = item.startDate && item.endDate 
                                                    ? (item.startDate === item.endDate 
                                                        ? formatStorageDate(item.startDate)
                                                        : `${formatStorageDate(item.startDate)} - ${formatStorageDate(item.endDate)}`)
                                                    : '';
                                                return (
                                                    <li key={idx} className="flex flex-col">
                                                        <div className="flex justify-between gap-3">
                                                            <span>{item.name} ({item.storageType})</span>
                                                            <span className="text-muted-foreground">{formatPrice(item.totalPrice)}</span>
                                                        </div>
                                                        {dateRange && (
                                                            <span className="text-muted-foreground text-[10px]">
                                                                📅 {dateRange}
                                                            </span>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                                {equipmentItems.length > 0 && (
                                    <div>
                                        <p className="font-medium text-xs flex items-center gap-1 mb-1">
                                            <Package className="h-3 w-3" /> Equipment Rentals
                                        </p>
                                        <ul className="text-xs space-y-0.5">
                                            {equipmentItems.map((item, idx) => (
                                                <li key={idx} className="flex justify-between gap-3">
                                                    <span>{item.name}</span>
                                                    <span className="text-muted-foreground">{formatPrice(item.totalPrice)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        }
    },
    {
        accessorKey: "totalPrice",
        header: () => (
            <div className="text-right flex items-center justify-end gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                <span>Payment</span>
            </div>
        ),
        cell: ({ row }) => {
            const totalPrice = row.original.totalPrice ?? 0;
            const serviceFee = row.original.serviceFee ?? 0;
            const netAmount = totalPrice - serviceFee;
            
            const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
            
            if (totalPrice === 0) {
                return <span className="text-muted-foreground text-xs">—</span>;
            }

            return (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="text-right cursor-help">
                                <div className="font-medium text-sm">{formatPrice(totalPrice)}</div>
                                <div className="text-xs text-green-600">You receive: {formatPrice(netAmount)}</div>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between gap-4">
                                    <span>Total Charged:</span>
                                    <span className="font-medium">{formatPrice(totalPrice)}</span>
                                </div>
                                <div className="flex justify-between gap-4 text-violet-600">
                                    <span>Platform Fee (Stripe):</span>
                                    <span>-{formatPrice(serviceFee)}</span>
                                </div>
                                <div className="border-t pt-1 flex justify-between gap-4 font-semibold text-green-600">
                                    <span>You Receive:</span>
                                    <span>{formatPrice(netAmount)}</span>
                                </div>
                                <p className="text-xs text-muted-foreground pt-1">
                                    Platform fee covers Stripe processing (2.9% + $0.30)
                                </p>
                            </div>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        },
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string

            let variant: "default" | "secondary" | "destructive" | "outline" = "outline"
            let icon = null;

            if (status === 'confirmed') {
                variant = "default"
                icon = <CheckCircle className="h-3 w-3 mr-1" />
            } else if (status === 'cancelled') {
                variant = "destructive"
                icon = <XCircle className="h-3 w-3 mr-1" />
            } else {
                variant = "secondary"
                icon = <Clock className="h-3 w-3 mr-1" />
            }

            return (
                <Badge variant={variant} className="capitalize items-center flex w-fit">
                    {icon}
                    {status}
                </Badge>
            )
        },
    },
    {
        accessorKey: "specialNotes",
        header: "Notes",
        cell: ({ row }) => {
            const notes = row.getValue("specialNotes") as string;
            if (!notes) return <span className="text-muted-foreground text-xs italic">No notes</span>;

            return (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center cursor-help text-muted-foreground hover:text-foreground transition-colors">
                                <FileText className="h-4 w-4" />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                            <p className="text-sm">{notes}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )
        }
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const booking = row.original

            // Calculate manual "isPast" for action logic if needed, 
            // but simpler to rely on status + handler validation
            const isPending = booking.status === 'pending';
            const isConfirmed = booking.status === 'confirmed';
            const isCancelled = booking.status === 'cancelled';

            // Check if time has passed for confirmed bookings
            const bookingDateTime = new Date(`${booking.bookingDate.split('T')[0]}T${booking.startTime}`);
            const isPast = bookingDateTime < new Date();
            const canCancel = isConfirmed && !isPast;


            if (isCancelled || (isConfirmed && isPast)) {
                return null; // No actions for past/cancelled
            }

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>

                        {isPending && (
                            <>
                                <DropdownMenuItem
                                    onClick={() => onConfirm(booking.id)}
                                    disabled={!hasApprovedLicense}
                                    className="text-green-600 focus:text-green-700 focus:bg-green-50"
                                >
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    Confirm Booking
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => onReject(booking)}
                                    className="text-red-600 focus:text-red-700 focus:bg-red-50"
                                >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Reject Booking
                                </DropdownMenuItem>
                            </>
                        )}

                        {canCancel && (
                            <DropdownMenuItem
                                onClick={() => onCancel(booking)}
                                className="text-red-600 focus:text-red-700 focus:bg-red-50"
                            >
                                <XCircle className="mr-2 h-4 w-4" />
                                Cancel Booking
                            </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(booking.id.toString())}>
                            Copy Booking ID
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
