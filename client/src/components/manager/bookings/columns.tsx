"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, CheckCircle, XCircle, Clock, MapPin, User, Calendar as CalendarIcon, FileText, Package, Boxes, DollarSign, Eye, RotateCcw, ClipboardCheck } from "lucide-react"

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
    rejected?: boolean; // true if manager rejected this item
}

export type EquipmentItem = {
    id: number;
    equipmentListingId: number;
    name: string;
    totalPrice: number; // in cents
    rejected?: boolean; // true if manager rejected this item
}

// Define the Booking type
export type Booking = {
    id: number;
    kitchenId: number;
    chefId: number;
    bookingDate: string;
    startTime: string;
    endTime: string;
    selectedSlots?: Array<{ startTime: string; endTime: string }>; // Array of discrete 1-hour time slots
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
    totalPrice?: number; // in cents - gross amount charged to customer (from kitchen_bookings)
    transactionAmount?: number; // in cents - actual amount charged via Stripe (from payment_transactions)
    serviceFee?: number; // in cents - platform fee (from payment_transactions)
    managerRevenue?: number; // in cents - what manager actually receives (from payment_transactions)
    hourlyRate?: number; // in cents
    durationHours?: number;
    paymentStatus?: string;
    paymentIntentId?: string;
    transactionId?: number;
    refundAmount?: number; // in cents - amount already refunded
    // SIMPLE REFUND MODEL: Manager's balance is the cap
    // Stripe fee is sunk cost — manager enters $X, customer gets $X, manager debited $X
    refundableAmount?: number; // in cents - max refundable = manager's remaining balance
    stripeProcessingFee?: number; // in cents - total Stripe processing fee (display only)
    managerRemainingBalance?: number; // in cents - manager's remaining balance from this transaction
    taxRatePercent?: number; // kitchen's tax rate percentage for revenue calculations
    taxAmount?: number; // in cents - tax = kb.total_price * tax_rate / 100 (same as transaction history)
    netRevenue?: number; // in cents - net = transactionAmount - taxAmount - stripeFee (same as transaction history)
    // ── Voided Authorization Context ────────────────────────────────────────
    isVoidedAuthorization?: boolean; // true when PT was canceled before capture — $0 moved
    isAuthorizedHold?: boolean;      // true when payment is held but not yet captured
    originalAuthorizedAmount?: number; // Original auth amount for voided display context (in cents)
}

interface BookingColumnsProps {
    onConfirm: (bookingId: number) => void;
    onReject: (booking: Booking) => void;
    onCancel: (booking: Booking) => void;
    onRefund?: (booking: Booking) => void;
    onTakeAction?: (booking: Booking) => void;
    hasApprovedLicense: boolean;
}

const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/St_Johns',
    });
};

const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
};

export const getBookingColumns = ({ onConfirm, onReject, onCancel, onRefund, onTakeAction, hasApprovedLicense }: BookingColumnsProps): ColumnDef<Booking>[] => [
    {
        accessorKey: "createdAt",
        header: () => null,
        cell: () => null,
        enableHiding: true,
        meta: { hidden: true },
    },
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
        cell: ({ row }) => {
            const createdAt = row.original.createdAt;
            const formattedCreatedAt = createdAt 
                ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/St_Johns' })
                : null;
            return (
                <div className="flex flex-col">
                    <span className="font-medium text-sm">{row.getValue("kitchenName") || 'Unknown Kitchen'}</span>
                    <div className="flex items-center text-xs text-muted-foreground mt-0.5">
                        <MapPin className="h-3 w-3 mr-1" />
                        {row.original.locationName || 'Unknown Location'}
                    </div>
                    {formattedCreatedAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                            Created: {formattedCreatedAt}
                        </div>
                    )}
                </div>
            );
        },
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
        cell: ({ row }) => {
            // Normalize slots to always have {startTime, endTime} format
            // Database may have old format (strings like "09:00") or new format (objects)
            const rawSlots = row.original.selectedSlots as Array<string | { startTime: string; endTime: string }> | undefined;
            
            const normalizeSlot = (slot: string | { startTime: string; endTime: string }): { startTime: string; endTime: string } => {
                if (typeof slot === 'string') {
                    // Old format: just start time string, calculate end time (+1 hour)
                    const [h, m] = slot.split(':').map(Number);
                    const endMins = h * 60 + m + 60;
                    const endH = Math.floor(endMins / 60);
                    const endM = endMins % 60;
                    return {
                        startTime: slot,
                        endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
                    };
                }
                return slot;
            };
            
            const normalizedSlots = rawSlots?.map(normalizeSlot).filter(s => s.startTime && s.endTime) || [];
            const hasDiscreteSlots = normalizedSlots.length > 0;
            
            // Check if slots are contiguous (no gaps)
            const areContiguous = (slots: Array<{ startTime: string; endTime: string }>) => {
                if (slots.length <= 1) return true;
                const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
                for (let i = 1; i < sorted.length; i++) {
                    // Check if previous slot's endTime equals current slot's startTime
                    if (sorted[i - 1].endTime !== sorted[i].startTime) return false;
                }
                return true;
            };
            
            const showAsRange = !hasDiscreteSlots || areContiguous(normalizedSlots);
            
            return (
                <div className="flex flex-col text-sm">
                    <div className="flex items-center">
                        <CalendarIcon className="h-3 w-3 mr-2 text-muted-foreground" />
                        {formatDate(row.getValue("bookingDate"))}
                    </div>
                    {showAsRange ? (
                        <div className="flex items-center text-xs text-muted-foreground mt-1">
                            <Clock className="h-3 w-3 mr-2" />
                            {formatTime(row.original.startTime)} - {formatTime(row.original.endTime)}
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground mt-1">
                            <Clock className="h-3 w-3 mr-1" />
                            {[...normalizedSlots].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((slot, idx) => (
                                <span key={slot.startTime} className="inline-flex items-center">
                                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">
                                        {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                                    </span>
                                    {idx < normalizedSlots.length - 1 && <span className="mx-0.5 text-gray-400">+</span>}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            );
        },
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
                            <div className="flex flex-col gap-1 cursor-help max-w-[150px]">
                                {storageItems.length > 0 && (
                                    <div className="flex items-start gap-1.5">
                                        <Boxes className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                        <div className="text-xs">
                                            {storageItems.map((s, idx) => {
                                                const formatStorageDate = (dateStr?: string) => {
                                                    if (!dateStr) return '';
                                                    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/St_Johns' });
                                                };
                                                // Use storage dates if available, otherwise fall back to booking date
                                                const startDate = s.startDate || row.original.bookingDate;
                                                const endDate = s.endDate || row.original.bookingDate;
                                                const dateRange = startDate === endDate 
                                                    ? formatStorageDate(startDate)
                                                    : `${formatStorageDate(startDate)} - ${formatStorageDate(endDate)}`;
                                                return (
                                                    <div key={idx} className={`flex flex-col ${s.rejected ? 'opacity-60' : ''}`}>
                                                        <span className={`truncate ${s.rejected ? 'line-through text-red-500' : ''}`}>{s.name} ({s.storageType})</span>
                                                        <span className="text-muted-foreground text-[10px]">{dateRange}</span>
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
                                            {equipmentItems.map((e, idx) => (
                                                <span key={idx} className={e.rejected ? 'line-through text-red-500 opacity-60' : ''}>
                                                    {e.name}{idx < equipmentItems.length - 1 ? ', ' : ''}
                                                </span>
                                            ))}
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
                                                    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/St_Johns' });
                                                };
                                                const dateRange = item.startDate && item.endDate 
                                                    ? (item.startDate === item.endDate 
                                                        ? formatStorageDate(item.startDate)
                                                        : `${formatStorageDate(item.startDate)} - ${formatStorageDate(item.endDate)}`)
                                                    : '';
                                                return (
                                                    <li key={idx} className={`flex flex-col ${item.rejected ? 'opacity-60' : ''}`}>
                                                        <div className="flex justify-between gap-3">
                                                            <span className={item.rejected ? 'line-through' : ''}>{item.name} ({item.storageType})</span>
                                                            <span className={item.rejected ? 'text-red-400 line-through' : 'text-muted-foreground'}>
                                                                {formatPrice(item.totalPrice)}
                                                                {item.rejected && ' ✕'}
                                                            </span>
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
                                                <li key={idx} className={`flex justify-between gap-3 ${item.rejected ? 'opacity-60' : ''}`}>
                                                    <span className={item.rejected ? 'line-through' : ''}>{item.name}</span>
                                                    <span className={item.rejected ? 'text-red-400 line-through' : 'text-muted-foreground'}>
                                                        {formatPrice(item.totalPrice)}
                                                        {item.rejected && ' ✕'}
                                                    </span>
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
            const isVoided = row.original.isVoidedAuthorization === true;
            const isAuthHold = row.original.isAuthorizedHold === true;
            const originalAuthAmount = row.original.originalAuthorizedAmount;

            // Use actual Stripe transaction data when available
            const transactionAmount = row.original.transactionAmount;
            const stripeFee = row.original.stripeProcessingFee ?? 0;
            
            // Fall back to booking totalPrice if no transaction data
            const displayAmount = transactionAmount ?? row.original.totalPrice ?? 0;
            
            // ENTERPRISE STANDARD: Use values calculated EXACTLY like transaction history
            // Tax = kb.total_price * tax_rate_percent / 100 (calculated in booking.repository.ts)
            // Net = transactionAmount - taxAmount - stripeFee (calculated in booking.repository.ts)
            const taxRatePercent = row.original.taxRatePercent ?? 0;
            const taxAmount = row.original.taxAmount ?? 0; // From API (same calc as transaction history)
            const netAmount = row.original.netRevenue ?? (displayAmount - taxAmount - stripeFee);
            
            const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

            // ── VOIDED AUTHORIZATION: No money captured, hold released ────────────
            if (isVoided) {
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right cursor-help">
                                    <div className="font-medium text-sm text-muted-foreground">No Charge</div>
                                    <div className="text-xs text-blue-600">Hold released</div>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-sm">
                                    <p className="font-medium text-blue-700">Authorization Voided</p>
                                    {originalAuthAmount != null && originalAuthAmount > 0 && (
                                        <div className="flex justify-between gap-4 text-muted-foreground">
                                            <span>Original hold:</span>
                                            <span className="font-mono line-through">{formatPrice(originalAuthAmount)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between gap-4 font-medium">
                                        <span>Amount charged:</span>
                                        <span className="font-mono">$0.00</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground pt-1">
                                        The payment hold was released before capture. No charge was made and no Stripe fees apply.
                                    </p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            }

            // ── AUTHORIZED HOLD: Pending capture (manager hasn't acted yet) ──────
            if (isAuthHold) {
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right cursor-help">
                                    <div className="font-medium text-sm">{formatPrice(displayAmount)}</div>
                                    <div className="text-xs text-blue-600">Payment held</div>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-sm">
                                    <p className="font-medium text-blue-700">Payment Hold (Not Yet Charged)</p>
                                    <div className="flex justify-between gap-4">
                                        <span>Hold amount:</span>
                                        <span className="font-medium font-mono">{formatPrice(displayAmount)}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground pt-1">
                                        This amount is held on the chef&apos;s card. Use &quot;Take Action&quot; to approve (capture) or reject (release).
                                    </p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            }

            // ── NO PAYMENT DATA: Fallback ────────────────────────────────────────
            if (displayAmount === 0) {
                return <span className="text-muted-foreground text-xs">—</span>;
            }

            // ── CAPTURED PAYMENT: Show actual Stripe data with revenue breakdown ──
            // Show actual Stripe data if we have transaction data, otherwise show pending
            const hasTransactionData = transactionAmount !== null && transactionAmount !== undefined;

            return (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="text-right cursor-help">
                                <div className="font-medium text-sm">{formatPrice(displayAmount)}</div>
                                {hasTransactionData ? (
                                    <div className="text-xs text-green-600">You receive: {formatPrice(netAmount)}</div>
                                ) : (
                                    <div className="text-xs text-muted-foreground">Awaiting payment</div>
                                )}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between gap-4">
                                    <span>Total Charged:</span>
                                    <span className="font-medium">{formatPrice(displayAmount)}</span>
                                </div>
                                {hasTransactionData && taxAmount > 0 && (
                                    <div className="flex justify-between gap-4 text-amber-600">
                                        <span>Tax ({taxRatePercent}%):</span>
                                        <span>-{formatPrice(taxAmount)}</span>
                                    </div>
                                )}
                                {hasTransactionData && stripeFee > 0 && (
                                    <div className="flex justify-between gap-4 text-red-600">
                                        <span>Stripe Fee:</span>
                                        <span>-{formatPrice(stripeFee)}</span>
                                    </div>
                                )}
                                {hasTransactionData && (
                                    <div className="border-t pt-1 flex justify-between gap-4 font-semibold text-green-600">
                                        <span>You Receive:</span>
                                        <span>{formatPrice(netAmount)}</span>
                                    </div>
                                )}
                                {!hasTransactionData && (
                                    <p className="text-xs text-muted-foreground">
                                        Payment data will be available after checkout completes
                                    </p>
                                )}
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
            const paymentStatus = row.original.paymentStatus;

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

            const isVoided = row.original.isVoidedAuthorization === true;
            const isAuthHold = row.original.isAuthorizedHold === true;

            return (
                <div className="flex flex-col gap-1">
                    <Badge variant={variant} className="capitalize items-center flex w-fit">
                        {icon}
                        {status}
                    </Badge>
                    {isVoided && (
                        <Badge variant="outline" className="text-[10px] text-gray-600 border-gray-300 bg-gray-50 w-fit">
                            <DollarSign className="h-2.5 w-2.5 mr-0.5" />
                            Auth Voided
                        </Badge>
                    )}
                    {isAuthHold && status === 'pending' && (
                        <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-200 bg-blue-50 w-fit">
                            <DollarSign className="h-2.5 w-2.5 mr-0.5" />
                            Payment Held
                        </Badge>
                    )}
                </div>
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


            // Check if booking has refundable amount (for cancelled bookings that need manual refund)
            const hasRefundableAmount = booking.paymentStatus && 
                ['paid', 'partially_refunded'].includes(booking.paymentStatus) && 
                (booking.refundableAmount === undefined || booking.refundableAmount > 0);
            
            // For cancelled bookings, only show refund action if there's refundable amount
            if (isCancelled && !hasRefundableAmount) {
                return null; // No actions for fully refunded cancelled bookings
            }
            
            if (isConfirmed && isPast) {
                return null; // No actions for past confirmed bookings
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

                        {isPending && onTakeAction && (
                            <DropdownMenuItem
                                onClick={() => onTakeAction(booking)}
                                disabled={!hasApprovedLicense}
                                className="text-primary focus:text-primary focus:bg-primary/5"
                            >
                                <ClipboardCheck className="mr-2 h-4 w-4" />
                                Take Action
                            </DropdownMenuItem>
                        )}

                        {isPending && !onTakeAction && (
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

                        {/* Refund action - show for paid/partially_refunded bookings with refundable amount
                            This covers both:
                            - Cancelled confirmed bookings (need manual refund)
                            - Active bookings where manager wants to issue partial refund */}
                        {onRefund && hasRefundableAmount && (
                            <DropdownMenuItem
                                onClick={() => onRefund(booking)}
                                className="text-orange-600 focus:text-orange-700 focus:bg-orange-50"
                            >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Issue Refund
                            </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <a href={`/manager/booking/${booking.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                            </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(booking.id.toString())}>
                            Copy Booking ID
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
