/**
 * Revenue Metric Cards Component
 * 
 * Enterprise-grade revenue dashboard with clear breakdown showing:
 * - Total Revenue (gross amount charged)
 * - Tax Collected (based on kitchen tax rate)
 * - Stripe Processing Fees (actual from Stripe API)
 * - Live Payout Status (real-time from Stripe Balance API)
 * 
 * Uses skeleton loaders for loading states.
 */

import { useQuery } from "@tanstack/react-query"
import { mt } from "@/i18n/manager"
import { auth } from "@/lib/firebase"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    BarChart3,
    Receipt,
    CreditCard,
    Wallet,
    Info,
    Clock,
    Banknote,
} from "lucide-react"
import { formatCurrency, formatPercent } from "@/lib/formatters"
import type { RevenueMetrics, Transaction } from "../types"
import { getTransactionRevenueBreakdown, aggregateTransactionPayoutTotals } from "../revenue-calculations"
import { KitchenPayoutSummaryTiles } from "@/components/booking/BookingPricingBreakdown"
import { tt } from "@/i18n/common-ns";

interface RevenueMetricCardsProps {
    metrics: RevenueMetrics | null
    isLoading: boolean
    transactions?: Transaction[]
}

function MetricCardSkeleton() {
    return (
        <Card className="relative overflow-hidden">
            <CardContent className="p-4">
                <div className="flex items-start justify-between">
                    <div className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-8 w-28" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-8 w-8 rounded-lg" />
                </div>
            </CardContent>
        </Card>
    )
}

interface MetricCardProps {
    title: string
    value: string
    subtitle: string
    icon: React.ReactNode
    iconBgClass?: string
    valueClass?: string
    changePercent?: number
    tooltip?: string
}

function MetricCard({
    title,
    value,
    subtitle,
    icon,
    valueClass = "text-foreground",
    changePercent,
    tooltip,
}: MetricCardProps) {
    const content = (
        <Card className="border border-gray-200 bg-white transition-all duration-200 hover:shadow-md">
            <CardContent className="p-4">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                {title}
                            </p>
                            {tooltip && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 cursor-help text-muted-foreground" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-sm">{tooltip}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                        <p className={`text-2xl font-bold mt-1 ${valueClass}`}>
                            {value}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                            <p className="text-xs text-muted-foreground">
                                {subtitle}
                            </p>
                            {changePercent !== undefined && changePercent !== 0 && (
                                <Badge
                                    variant={changePercent >= 0 ? "default" : "destructive"}
                                    className="text-xs py-0 px-1.5 h-5 gap-0.5"
                                >
                                    {changePercent >= 0 ? (
                                        <TrendingUp className="h-3 w-3" />
                                    ) : (
                                        <TrendingDown className="h-3 w-3" />
                                    )}
                                    {formatPercent(Math.abs(changePercent))}
                                </Badge>
                            )}
                        </div>
                    </div>
                    {icon}
                </div>
            </CardContent>
        </Card>
    )

    return content
}

// Interface for live Stripe balance data
interface StripeBalanceData {
    available: number
    pending: number
    inTransit: number
    currency: string
    hasStripeAccount: boolean
}

export function RevenueMetricCards({ metrics, isLoading, transactions }: RevenueMetricCardsProps) {
  
    // Fetch live Stripe balance for real-time payout data
    const { data: stripeBalance, isLoading: isLoadingBalance } = useQuery<StripeBalanceData>({
        queryKey: ['stripeBalance'],
        queryFn: async () => {
            const currentFirebaseUser = auth.currentUser
            if (!currentFirebaseUser) {
                throw new Error(tt("firebaseUserNotAvailable"))
            }
            const token = await currentFirebaseUser.getIdToken()
            const response = await fetch('/api/manager/revenue/stripe-balance', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
            })
            if (!response.ok) {
                throw new Error(tt("failedToFetchStripeBalance"))
            }
            return response.json()
        },
        staleTime: 1000 * 30, // Cache for 30 seconds - balance changes frequently
        refetchInterval: 1000 * 60, // Refresh every minute
    })

    if (isLoading) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                </div>
            </div>
        )
    }

    if (!metrics) {
        return null
    }

    // Recalculate tax and fees per-transaction using reverse-calculation and authoritative manager revenue.
    // This fixes bugs where server-side metrics might be outdated or missing Stripe fee data.
    let taxAmount: number;
    let stripeFee: number;
    let netRevenue: number;

    if (transactions && transactions.length > 0) {
        const totals = transactions.reduce((acc, t) => {
            const breakdown = getTransactionRevenueBreakdown(t);

            return {
                tax: acc.tax + breakdown.taxAmount,
                fee: acc.fee + breakdown.stripeFee,
                net: acc.net + breakdown.netRevenue
            };
        }, { tax: 0, fee: 0, net: 0 });

        taxAmount = totals.tax;
        stripeFee = totals.fee;
        netRevenue = totals.net;
    } else {
        // Fallback: use server-provided values (best effort without per-transaction data)
        taxAmount = metrics.taxAmount ?? 0;
        stripeFee = metrics.stripeFee ?? 0;
        netRevenue = metrics.netRevenue ?? Math.max(0, (metrics.managerRevenue ?? 0) - (metrics.refundedAmount ?? 0));
    }

    return (
        <div className="space-y-4">
            {transactions && transactions.length > 0 && (
                <KitchenPayoutSummaryTiles
                    {...aggregateTransactionPayoutTotals(transactions)}
                />
            )}
            {/* Primary Revenue Cards - Hero Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetricCard
                    title={mt("grossRevenue")}
                    value={formatCurrency(metrics.totalRevenue)}
                    subtitle={mt("totalAmountCharged")}
                    icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
                    iconBgClass="bg-emerald-100"
                    changePercent={metrics.revenueChangePercent}
                    tooltip={mt("grossRevenueTooltip")}
                />
                <MetricCard
                    title={mt("netRevenue")}
                    value={formatCurrency(netRevenue)}
                    subtitle={mt("afterTaxFees")}
                    icon={<Wallet className="h-4 w-4 text-blue-500" />}
                    iconBgClass="bg-blue-100"
                    tooltip={mt("netRevenueTooltip")}
                />
            </div>

            {/* Revenue Breakdown - Enterprise Detail Section */}
            <Card className="border border-gray-200 bg-white">
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="h-4 w-4 text-slate-600" />
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{mt("revenueBreakdown")}</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {/* Tax Collected */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <Receipt className="h-3.5 w-3.5 text-amber-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{mt("taxCollected")}</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-sm">{mt("taxCollectedTooltip")}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <p className="text-xl font-bold text-amber-600">{formatCurrency(taxAmount)}</p>
                            <p className="text-xs text-muted-foreground">
                                {metrics.taxRatePercent && metrics.taxRatePercent > 0
                                    ? mt("taxRatePercentLabel", { rate: metrics.taxRatePercent })
                                    : mt("noTaxApplied")}
                            </p>
                        </div>

                        {/* Stripe Processing Fee */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <CreditCard className="h-3.5 w-3.5 text-stripe" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{mt("stripeFee")}</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-stripe cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-sm">{mt("stripeFeeTooltipDetail")}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <p className="text-xl font-bold text-stripe">{formatCurrency(stripeFee)}</p>
                            <p className="text-xs text-muted-foreground">{mt("fromStripeAPI")}</p>
                        </div>

                        {/* Live Stripe Balance - Available for Payout */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{mt("available")}</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-sm">
                                            <div className="space-y-2 text-sm">
                                                <p className="font-medium">{mt("liveStripeBalance")}</p>
                                                <p className="text-muted-foreground">{mt("realTimeDataFromStripeBalanceAPI")}</p>
                                                <ul className="text-xs space-y-1 text-muted-foreground">
                                                    <li>• {mt("fundsReadyForPayout")}</li>
                                                    <li>• {mt("balanceUpdatedAutomatically")}</li>
                                                    <li>• {mt("includesTaxCollected")}</li>
                                                </ul>
                                                <p className="text-xs border-t pt-2 mt-2">{mt("youAreResponsibleForRemittingTaxToTheAppropriateAuthorities")}</p>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            {isLoadingBalance ? (
                                <Skeleton className="h-7 w-24" />
                            ) : (
                                <p className="text-xl font-bold text-emerald-600">
                                    {formatCurrency(stripeBalance?.available ?? 0)}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                {stripeBalance?.hasStripeAccount ? mt("fromStripe") : mt("noStripeAccount")}
                            </p>
                        </div>

                        {/* Pending Balance */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-amber-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{mt("pending")}</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-sm">
                                            <div className="space-y-2 text-sm">
                                                <p className="font-medium">{mt("pendingBalance")}</p>
                                                <p className="text-muted-foreground">{mt("fundsFromRecentPayments")}</p>
                                                <ul className="text-xs space-y-1 text-muted-foreground">
                                                    <li>• {mt("paymentsStillProcessing")}</li>
                                                    <li>• {mt("clearsInBusinessDays")}</li>
                                                    <li>• {mt("willMoveToAvailable")}</li>
                                                </ul>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            {isLoadingBalance ? (
                                <Skeleton className="h-7 w-24" />
                            ) : (
                                <p className="text-xl font-bold text-amber-600">
                                    {formatCurrency(stripeBalance?.pending ?? 0)}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">{mt("processing")}</p>
                        </div>

                        {/* Average Booking */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <BarChart3 className="h-3.5 w-3.5 text-slate-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{mt("avgBooking")}</span>
                            </div>
                            <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{formatCurrency(metrics.averageBookingValue)}</p>
                            <p className="text-xs text-muted-foreground">{mt("totalBookingsCount", { count: metrics.bookingCount })}</p>
                        </div>
                    </div>

                    {/* Refunded Amount - Only show if there are refunds */}
                    {metrics.refundedAmount > 0 && (
                        <>
                            <Separator className="my-4" />
                            <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                                <div className="flex items-center gap-2">
                                    <DollarSign className="h-4 w-4 text-red-500" />
                                    <span className="text-sm font-medium text-red-700 dark:text-red-400">{mt("refunded")}</span>
                                </div>
                                <span className="text-lg font-bold text-red-600">{formatCurrency(metrics.refundedAmount)}</span>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
