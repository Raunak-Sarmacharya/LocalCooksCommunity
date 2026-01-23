"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, CheckCircle, XCircle, Clock, MapPin, User, Calendar as CalendarIcon, FileText } from "lucide-react"

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
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string

            let variant: "default" | "secondary" | "destructive" | "outline" = "outline"
            let icon = null;

            if (status === 'confirmed') {
                variant = "default" // or success style if we had it
                icon = <CheckCircle className="h-3 w-3 mr-1" />
            } else if (status === 'cancelled') {
                variant = "destructive"
                icon = <XCircle className="h-3 w-3 mr-1" />
            } else {
                variant = "secondary" // Pending
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
