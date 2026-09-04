"use client"
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";

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
import { getTransactionRevenueBreakdown } from "./revenue-calculations"

// Payment status badge configuration
function getPaymentStatusConfig(): Record<PaymentStatus, {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: typeof CheckCircle;
    tooltip?: string;
}> {
    return {
    authorized: {
        label: mt("paymentHeldStatus"),
        variant: 'outline',
        icon: Clock,
        tooltip: mt("paymentAuthorizedTooltip")
    },
    paid: {
        label: mt("paidStatus"),
        variant: 'default',
        icon: CheckCircle,
        tooltip: mt("paymentPaidTooltip")
    },
    pending: {
        label: tt("pending"),
        variant: 'secondary',
        icon: Clock,
        tooltip: mt("paymentPendingTooltip")
    },
    processing: {
        label: mt("processing"),
        variant: 'outline',
        icon: Clock,
        tooltip: mt("paymentProcessingTooltip")
    },
    failed: {
        label: mt("failedStatus"),
        variant: 'destructive',
        icon: XCircle,
        tooltip: mt("paymentFailedTooltip")
    },
    refunded: {
        label: mt("refunded"),
        variant: 'outline',
        icon: AlertCircle,
        tooltip: mt("paymentRefundedTooltip")
    },
    partially_refunded: {
        label: mt("partialRefundStatus"),
        variant: 'outline',
        icon: AlertCircle,
        tooltip: mt("paymentPartialRefundTooltip")
    },
    canceled: {
        label: mt("canceledStatus"),
        variant: 'outline',
        icon: XCircle,
        tooltip: mt("paymentCanceledTooltip")
    },
};
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
    const paymentStatusConfig = getPaymentStatusConfig();
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
            accessorKey: "createdAt",
            header: () => null,
            cell: () => null,
            enableHiding: true,
            meta: { hidden: true },
        },
        {
            id: "reference",
            header: mt("ref"),
            cell: ({ row }) => {
                const ref = row.original.referenceCode || row.original.bookingId || row.original.id;
                return (
                    <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {ref ? `#${ref}` : "—"}
                    </div>
                );
            },
        },
        {
            accessorKey: "bookingDate",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >{mt("date")}<ArrowUpDown className="ml-2 h-4 w-4" />
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
            header: mt("chefHeader"),
            cell: ({ row }) => (
                <span className="text-sm">
                    {row.getValue("chefName") || tt("guest")}
                </span>
            ),
        },
        {
            accessorKey: "locationName",
            header: mt("locationHeader"),
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
                                <span className="text-green-600">{mt("claimPayment")}</span>
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
                >{mt("total")}<ArrowUpDown className="ml-2 h-4 w-4" />
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
                <div className="text-right">{mt("taxHeader")}</div>
            ),
            cell: ({ row }) => {
                const taxRate = row.original.taxRatePercent ?? 0;
                const { taxAmount } = getTransactionRevenueBreakdown(row.original);
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right text-amber-600 text-sm">
                                    {formatCurrency(taxAmount)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">{mt("taxRateTooltip", { rate: taxRate })}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "stripeFee",
            header: () => (
                <div className="text-right">{mt("stripeFee")}</div>
            ),
            cell: ({ row }) => {
                const { stripeFee } = getTransactionRevenueBreakdown(row.original);

                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-right text-stripe text-sm">
                                    {formatCurrency(stripeFee)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-sm">{mt("stripeProcessingFeeFromStripeAPI")}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "refundAmount",
            header: () => (
                <div className="text-right">{mt("refunded")}</div>
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
                                <p className="text-sm">{mt("amountRefundedToCustomer")}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            id: "netRevenue",
            accessorFn: (transaction) => getTransactionRevenueBreakdown(transaction).netRevenue,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="justify-end w-full"
                >{mt("netRevenue")}<ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const {
                    isRevenueEligible,
                    grossNetRevenue,
                    refundAmount,
                    netRevenue,
                } = getTransactionRevenueBreakdown(row.original);
                const hasRefund = isRevenueEligible && refundAmount > 0;
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={`text-right font-semibold ${!isRevenueEligible ? 'text-muted-foreground' : hasRefund ? 'text-orange-600' : 'text-primary'}`}>
                                    {formatCurrency(netRevenue)}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                {!isRevenueEligible ? (
                                    <p className="text-sm">{mt("canceledPendingHeldFailedAndFullyRefundedTransactionsAreExcl")}</p>
                                ) : hasRefund ? (
                                    <div className="text-sm space-y-1">
                                        <p>Original: {formatCurrency(grossNetRevenue)}</p>
                                        <p className="text-red-500">{mt("refundMinus", { amount: formatCurrency(refundAmount) })}</p>
                                        <p className="font-semibold">{mt("effectiveAmount", { amount: formatCurrency(netRevenue) })}</p>
                                    </div>
                                ) : (
                                    <p className="text-sm">{mt("netRevenueAfterTaxAndStripeFees")}</p>
                                )}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
        },
        {
            accessorKey: "paymentStatus",
            header: mt("statusHeader"),
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
                const canDownloadInvoice = transaction.bookingType === 'kitchen' || transaction.bookingType === 'bundle' || transaction.bookingType === 'storage' || transaction.bookingType === 'storage_extension'

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">{mt("openMenu")}</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{mt("actions")}</DropdownMenuLabel>
                            <DropdownMenuItem
                                onClick={() => onDownloadInvoice(
                                    transaction.bookingId,
                                    transaction.bookingType,
                                    transaction.transactionId ?? undefined
                                )}
                                disabled={!canDownloadInvoice}
                            >
                                <Download className="mr-2 h-4 w-4" />{mt("downloadInvoice")}</DropdownMenuItem>
                            {onViewDetails && (
                                <DropdownMenuItem onClick={() => onViewDetails(transaction)}>
                                    <Eye className="mr-2 h-4 w-4" />{mt("viewDetails")}</DropdownMenuItem>
                            )}
                            {onRefund && (
                                <DropdownMenuItem
                                    onClick={() => onRefund(transaction)}
                                    disabled={!canRefund}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />{mt("issueRefund")}</DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => navigator.clipboard.writeText(transaction.paymentIntentId || '')}
                                disabled={!transaction.paymentIntentId}
                            >{mt("copyPaymentID")}</DropdownMenuItem>
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
            header: mt("invoiceNumberHeader"),
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
                >{mt("date")}<ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => formatDate(row.getValue("bookingDate")),
        },
        {
            accessorKey: "kitchenName",
            header: mt("kitchenHeader"),
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-sm font-medium">{row.getValue("kitchenName")}</span>
                    <span className="text-xs text-muted-foreground">{row.original.locationName}</span>
                </div>
            ),
        },
        {
            accessorKey: "totalPrice",
            header: mt("amountHeader"),
            cell: ({ row }) => (
                <div className="font-medium">
                    {formatCurrency(row.getValue("totalPrice"))}
                </div>
            ),
        },
        {
            accessorKey: "paymentStatus",
            header: mt("statusHeader"),
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
                    <Download className="h-4 w-4" />{mt("download")}</Button>
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
                >{mt("arrivalDate")}<ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => formatDate(row.getValue("arrivalDate")),
        },
        {
            accessorKey: "amount",
            header: mt("amountHeader"),
            cell: ({ row }) => (
                <div className="font-semibold">
                    {formatCurrency(row.getValue("amount"), row.original.currency.toUpperCase())}
                </div>
            ),
        },
        {
            accessorKey: "method",
            header: mt("methodHeader"),
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">
                    {row.getValue("method") || mt("bankTransfer")}
                </span>
            ),
        },
        {
            accessorKey: "status",
            header: mt("statusHeader"),
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
                    <Download className="h-4 w-4" />{mt("statement")}</Button>
            ),
        },
    ]
}
