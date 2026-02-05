"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Download, Eye, CheckCircle, Clock, XCircle, AlertCircle, RotateCcw } from "lucide-react"

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
import { formatCurrency, formatDate, generateInvoiceNumber } from "@/lib/formatters"
import type { Transaction, Invoice, Payout, PaymentStatus } from "./types"

// Payment status badge configuration
const paymentStatusConfig: Record<PaymentStatus, {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: typeof CheckCircle;
    tooltip?: string;
}> = {
    paid: {
        label: 'Paid',
        variant: 'default',
        icon: CheckCircle,
        tooltip: 'Payment completed and in your account'
    },
    pending: {
        label: 'Pending',
        variant: 'secondary',
        icon: Clock,
        tooltip: 'Payment pending - will be processed after booking'
    },
    processing: {
        label: 'Processing',
        variant: 'outline',
        icon: Clock,
        tooltip: 'Payment is being processed'
    },
    failed: {
        label: 'Failed',
        variant: 'destructive',
        icon: XCircle,
        tooltip: 'Payment failed'
    },
    refunded: {
        label: 'Refunded',
        variant: 'outline',
        icon: AlertCircle,
        tooltip: 'Payment was refunded'
    },
    partially_refunded: {
        label: 'Partial Refund',
        variant: 'outline',
        icon: AlertCircle,
        tooltip: 'Payment was partially refunded'
    },
    canceled: {
        label: 'Canceled',
        variant: 'outline',
        icon: XCircle,
        tooltip: 'Booking was canceled'
    },
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
    const config = paymentStatusConfig[status] || paymentStatusConfig.pending
    const Icon = config.icon

    const badge = (
        <Badge variant={config.variant} className="gap-1 capitalize">
            <Icon className="h-3 w-3" />
            {config.label}
        </Badge>
    )

    if (config.tooltip) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>{badge}</TooltipTrigger>
                    <TooltipContent>
                        <p className="text-sm">{config.tooltip}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    }

    return badge
}

// Payout status badge
function PayoutStatusBadge({ status }: { status: string }) {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
        paid: 'default',
        pending: 'secondary',
        in_transit: 'outline',
        canceled: 'outline',
        failed: 'destructive',
    }

    return (
        <Badge variant={variants[status] || 'outline'} className="capitalize">
            {status.replace('_', ' ')}
        </Badge>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTION TABLE COLUMNS
// ═══════════════════════════════════════════════════════════════════════

interface TransactionColumnsProps {
    onDownloadInvoice: (bookingId: number, bookingType?: string, transactionId?: number) => void
    onViewDetails?: (transaction: Transaction) => void
    onRefund?: (transaction: Transaction) => void
}

export function getTransactionColumns({
    onDownloadInvoice,
    onViewDetails,
    onRefund,
}: TransactionColumnsProps): ColumnDef<Transaction>[] {
    return [
        {
            accessorKey: "bookingDate",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <span className="text-sm font-medium">
                    {formatDate(row.getValue("bookingDate"))}
                </span>
            ),
        },
        {
            accessorKey: "chefName",
            header: "Chef",
            cell: ({ row }) => (
                <span className="text-sm">
                    {row.getValue("chefName") || "Guest"}
                </span>
            ),
        },
        {
            accessorKey: "locationName",
            header: "Location",
            cell: ({ row }) => {
                const bookingType = row.original.bookingType;
                const isDamageClaim = bookingType === 'damage_claim';
                const isSpecialType = isDamageClaim || bookingType === 'overstay_penalty' || bookingType === 'storage_extension';
                const description = row.original.description;
                
                return (
                    <div className="flex flex-col">
                        <span className="text-sm font-medium">
                            {isDamageClaim ? (
                                <span className="text-green-600 font-semibold">
                                    {description || 'Damage Claim'}
                                </span>
                            ) : isSpecialType && description ? (
                                description
                            ) : (
                                row.original.kitchenName
                            )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {isDamageClaim ? (
                                <span className="text-green-600">Claim Payment</span>
                            ) : (
                                row.getValue("locationName")
                            )}
                        </span>
                    </div>
                )
            },
        },
        {
            accessorKey: "totalPrice",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="justify-end w-full"
                >
                    Total
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <div className="text-right font-medium">
                    {formatCurrency(row.getValue("totalPrice"))}
                </div>
            ),
        },
        {
            accessorKey: "taxAmount",
            header: () => (
                <div className="text-right">Tax</div>
            ),
            cell: ({ row }) => {
                const taxAmount = row.original.taxAmount ?? 0;
                const taxRate = row.original.taxRatePercent ?? 0;
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right text-amber-600 text-sm">
                                    {formatCurrency(taxAmount)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">Tax rate: {taxRate}%</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "stripeFee",
            header: () => (
                <div className="text-right">Stripe Fee</div>
            ),
            cell: ({ row }) => {
                const stripeFee = row.original.stripeFee ?? 0;
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right text-violet-600 text-sm">
                                    {formatCurrency(stripeFee)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">Stripe processing fee (from Stripe API)</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "refundAmount",
            header: () => (
                <div className="text-right">Refunded</div>
            ),
            cell: ({ row }) => {
                const refundAmount = row.original.refundAmount ?? 0;
                if (refundAmount === 0) {
                    return <div className="text-right text-muted-foreground text-sm">—</div>;
                }
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right text-red-600 text-sm font-medium">
                                    -{formatCurrency(refundAmount)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">Amount refunded to customer</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "netRevenue",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="justify-end w-full"
                >
                    Net Revenue
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const netRevenue = row.original.netRevenue ?? 0;
                const refundAmount = row.original.refundAmount ?? 0;
                // Show effective net revenue (after refunds)
                const effectiveNet = Math.max(0, netRevenue - refundAmount);
                const hasRefund = refundAmount > 0;
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={`text-right font-semibold ${hasRefund ? 'text-orange-600' : 'text-primary'}`}>
                                    {formatCurrency(effectiveNet)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                {hasRefund ? (
                                    <div className="text-sm space-y-1">
                                        <p>Original: {formatCurrency(netRevenue)}</p>
                                        <p className="text-red-500">Refund: -{formatCurrency(refundAmount)}</p>
                                        <p className="font-semibold">Effective: {formatCurrency(effectiveNet)}</p>
                                    </div>
                                ) : (
                                    <p className="text-sm">Net revenue after tax and Stripe fees</p>
                                )}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "paymentStatus",
            header: "Status",
            cell: ({ row }) => (
                <PaymentStatusBadge status={row.getValue("paymentStatus")} />
            ),
            filterFn: (row, id, value) => {
                return value === 'all' || row.getValue(id) === value
            },
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const transaction = row.original
                const canRefund = !!transaction.transactionId
                    && transaction.refundableAmount > 0
                    && (transaction.paymentStatus === 'paid' || transaction.paymentStatus === 'partially_refunded')
                // Damage claims, overstay penalties, and storage extensions don't have invoices
                const canDownloadInvoice = transaction.bookingType === 'kitchen' || transaction.bookingType === 'bundle' || transaction.bookingType === 'storage' 

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
                            <DropdownMenuItem
                                onClick={() => onDownloadInvoice(
                                    transaction.bookingId,
                                    transaction.bookingType,
                                    transaction.transactionId ?? undefined
                                )}
                                disabled={!canDownloadInvoice}
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Download Invoice
                            </DropdownMenuItem>
                            {onViewDetails && (
                                <DropdownMenuItem onClick={() => onViewDetails(transaction)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View Details
                                </DropdownMenuItem>
                            )}
                            {onRefund && (
                                <DropdownMenuItem
                                    onClick={() => onRefund(transaction)}
                                    disabled={!canRefund}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Issue Refund
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => navigator.clipboard.writeText(transaction.paymentIntentId || '')}
                                disabled={!transaction.paymentIntentId}
                            >
                                Copy Payment ID
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ]
}

// ═══════════════════════════════════════════════════════════════════════
// INVOICE TABLE COLUMNS
// ═══════════════════════════════════════════════════════════════════════

interface InvoiceColumnsProps {
    onDownload: (bookingId: number, bookingType?: string) => void
}

export function getInvoiceColumns({ onDownload }: InvoiceColumnsProps): ColumnDef<Invoice>[] {
    return [
        {
            accessorKey: "invoiceNumber",
            header: "Invoice #",
            cell: ({ row }) => (
                <span className="font-mono text-sm font-medium">
                    {generateInvoiceNumber(row.original.bookingId, new Date(row.original.bookingDate))}
                </span>
            ),
        },
        {
            accessorKey: "bookingDate",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => formatDate(row.getValue("bookingDate")),
        },
        {
            accessorKey: "kitchenName",
            header: "Kitchen",
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-sm font-medium">{row.getValue("kitchenName")}</span>
                    <span className="text-xs text-muted-foreground">{row.original.locationName}</span>
                </div>
            ),
        },
        {
            accessorKey: "totalPrice",
            header: "Amount",
            cell: ({ row }) => (
                <div className="font-medium">
                    {formatCurrency(row.getValue("totalPrice"))}
                </div>
            ),
        },
        {
            accessorKey: "paymentStatus",
            header: "Status",
            cell: ({ row }) => (
                <PaymentStatusBadge status={row.getValue("paymentStatus")} />
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDownload(row.original.bookingId, row.original.bookingType)}
                    className="gap-2"
                >
                    <Download className="h-4 w-4" />
                    Download
                </Button>
            ),
        },
    ]
}

// ═══════════════════════════════════════════════════════════════════════
// PAYOUT TABLE COLUMNS
// ═══════════════════════════════════════════════════════════════════════

interface PayoutColumnsProps {
    onDownloadStatement: (payoutId: string) => void
}

export function getPayoutColumns({ onDownloadStatement }: PayoutColumnsProps): ColumnDef<Payout>[] {
    return [
        {
            accessorKey: "arrivalDate",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Arrival Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => formatDate(row.getValue("arrivalDate")),
        },
        {
            accessorKey: "amount",
            header: "Amount",
            cell: ({ row }) => (
                <div className="font-semibold">
                    {formatCurrency(row.getValue("amount"), row.original.currency.toUpperCase())}
                </div>
            ),
        },
        {
            accessorKey: "method",
            header: "Method",
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">
                    {row.getValue("method") || 'Bank Transfer'}
                </span>
            ),
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => <PayoutStatusBadge status={row.getValue("status")} />,
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDownloadStatement(row.original.id)}
                    className="gap-2"
                >
                    <Download className="h-4 w-4" />
                    Statement
                </Button>
            ),
        },
    ]
}
