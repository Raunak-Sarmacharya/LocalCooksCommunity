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
import type { RevenueMetrics } from "../types"

interface RevenueMetricCardsProps {
    metrics: RevenueMetrics | null
    isLoading: boolean
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
    iconBgClass: string
    valueClass?: string
    changePercent?: number
    tooltip?: string
    gradient?: boolean
    gradientClass?: string
}

function MetricCard({
    title,
    value,
    subtitle,
    icon,
    iconBgClass,
    valueClass = "text-foreground",
    changePercent,
    tooltip,
    gradient = false,
    gradientClass,
}: MetricCardProps) {
    const content = (
        <Card className={`relative overflow-hidden transition-all duration-200 hover:shadow-md ${gradient ? `border-0 ${gradientClass} text-white` : ''
            }`}>
            <CardContent className="p-4">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-1.5">
                            <p className={`text-xs font-medium uppercase tracking-wider ${gradient ? 'text-white/80' : 'text-muted-foreground'
                                }`}>
                                {title}
                            </p>
                            {tooltip && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className={`h-3 w-3 cursor-help ${gradient ? 'text-white/60' : 'text-muted-foreground'
                                                }`} />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-sm">{tooltip}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                        <p className={`text-2xl font-bold mt-1 ${gradient ? 'text-white' : valueClass}`}>
                            {value}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                            <p className={`text-xs ${gradient ? 'text-white/70' : 'text-muted-foreground'}`}>
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
                    <div className={`p-2 rounded-lg ${gradient ? 'bg-white/20' : iconBgClass}`}>
                        {icon}
                    </div>
                </div>
                {gradient && (
                    <div className="absolute -bottom-3 -right-3 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
                )}
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

export function RevenueMetricCards({ metrics, isLoading }: RevenueMetricCardsProps) {
    // Fetch live Stripe balance for real-time payout data
    const { data: stripeBalance, isLoading: isLoadingBalance } = useQuery<StripeBalanceData>({
        queryKey: ['stripeBalance'],
        queryFn: async () => {
            const currentFirebaseUser = auth.currentUser
            if (!currentFirebaseUser) {
                throw new Error("Firebase user not available")
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
                throw new Error('Failed to fetch Stripe balance')
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
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
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

    // Use the new fields - taxAmount is actual tax collected (not platform fee)
    // Only show tax if explicitly set (don't fall back to platformFee which is service fee)
    const taxAmount = metrics.taxAmount ?? 0
    const stripeFee = metrics.stripeFee ?? 0
    const netRevenue = metrics.netRevenue ?? (metrics.totalRevenue - taxAmount - stripeFee)

    return (
        <div className="space-y-4">
            {/* Primary Revenue Cards - Hero Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetricCard
                    title="Gross Revenue"
                    value={formatCurrency(metrics.totalRevenue)}
                    subtitle="Total amount charged"
                    icon={<DollarSign className="h-4 w-4" />}
                    iconBgClass="bg-emerald-100"
                    changePercent={metrics.revenueChangePercent}
                    gradient={true}
                    gradientClass="bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25"
                    tooltip="Total gross revenue from all bookings before any deductions"
                />
                <MetricCard
                    title="Net Revenue"
                    value={formatCurrency(netRevenue)}
                    subtitle="After tax & fees"
                    icon={<Wallet className="h-4 w-4" />}
                    iconBgClass="bg-blue-100"
                    gradient={true}
                    gradientClass="bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25"
                    tooltip="Your actual earnings after tax collected and Stripe processing fees"
                />
            </div>

            {/* Revenue Breakdown - Enterprise Detail Section */}
            <Card className="border-0 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="h-4 w-4 text-slate-600" />
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Revenue Breakdown</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {/* Tax Collected */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <Receipt className="h-3.5 w-3.5 text-amber-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tax Collected</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-sm">Total tax collected from all bookings based on your kitchen&apos;s tax rate. This amount is collected from customers and remitted to tax authorities.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <p className="text-xl font-bold text-amber-600">{formatCurrency(taxAmount)}</p>
                            <p className="text-xs text-muted-foreground">
                                {metrics.taxRatePercent && metrics.taxRatePercent > 0
                                    ? `${metrics.taxRatePercent}% tax rate`
                                    : 'No tax applied'}
                            </p>
                        </div>

                        {/* Stripe Processing Fee */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <CreditCard className="h-3.5 w-3.5 text-violet-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stripe Fee</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p className="text-sm">Actual Stripe processing fee from Stripe Balance Transaction API. Falls back to estimate (~2.9% + $0.30) for older transactions.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <p className="text-xl font-bold text-violet-600">{formatCurrency(stripeFee)}</p>
                            <p className="text-xs text-muted-foreground">From Stripe API</p>
                        </div>

                        {/* Live Stripe Balance - Available for Payout */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Available</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-sm">
                                            <div className="space-y-2 text-sm">
                                                <p className="font-medium">Live Stripe Balance</p>
                                                <p className="text-muted-foreground">Real-time data from Stripe Balance API:</p>
                                                <ul className="text-xs space-y-1 text-muted-foreground">
                                                    <li>• Funds that have cleared and are ready for payout</li>
                                                    <li>• Updated automatically as payments complete</li>
                                                    <li>• Includes tax you collected</li>
                                                </ul>
                                                <p className="text-xs border-t pt-2 mt-2">You are responsible for remitting tax to the appropriate authorities.</p>
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
                                {stripeBalance?.hasStripeAccount ? 'From Stripe' : 'No Stripe account'}
                            </p>
                        </div>

                        {/* Pending Balance */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-amber-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-sm">
                                            <div className="space-y-2 text-sm">
                                                <p className="font-medium">Pending Balance</p>
                                                <p className="text-muted-foreground">Funds from recent payments:</p>
                                                <ul className="text-xs space-y-1 text-muted-foreground">
                                                    <li>• Payments still in processing period</li>
                                                    <li>• Usually clears in 2-7 business days</li>
                                                    <li>• Will move to Available when cleared</li>
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
                            <p className="text-xs text-muted-foreground">Processing</p>
                        </div>

                        {/* Average Booking */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <BarChart3 className="h-3.5 w-3.5 text-slate-600" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg Booking</span>
                            </div>
                            <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{formatCurrency(metrics.averageBookingValue)}</p>
                            <p className="text-xs text-muted-foreground">{metrics.bookingCount} total bookings</p>
                        </div>
                    </div>

                    {/* Refunded Amount - Only show if there are refunds */}
                    {metrics.refundedAmount > 0 && (
                        <>
                            <Separator className="my-4" />
                            <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                                <div className="flex items-center gap-2">
                                    <DollarSign className="h-4 w-4 text-red-500" />
                                    <span className="text-sm font-medium text-red-700 dark:text-red-400">Refunded</span>
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
