/**
 * Revenue Metric Cards Component
 * 
 * Displays key revenue KPIs with comparison to previous period.
 * Uses skeleton loaders for loading states.
 */

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
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
    CheckCircle2,
    Percent,
    Info,
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

export function RevenueMetricCards({ metrics, isLoading }: RevenueMetricCardsProps) {
    if (isLoading) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

    // Calculate manager revenue from completed payments
    const completedManagerRevenue = (() => {
        const completedTotal = metrics.completedPayments || 0
        const totalRevenue = metrics.totalRevenue || 0
        const platformFee = metrics.platformFee || 0

        if (totalRevenue === 0) return 0

        const completedPlatformFee = platformFee * (completedTotal / totalRevenue)
        return completedTotal - completedPlatformFee
    })()

    return (
        <div className="space-y-4">
            {/* Primary Revenue Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetricCard
                    title="Total Revenue"
                    value={formatCurrency(metrics.totalRevenue)}
                    subtitle="All bookings"
                    icon={<DollarSign className="h-4 w-4" />}
                    iconBgClass="bg-emerald-100"
                    changePercent={metrics.revenueChangePercent}
                    gradient={true}
                    gradientClass="bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25"
                />
                <MetricCard
                    title="Avg Booking"
                    value={formatCurrency(metrics.averageBookingValue)}
                    subtitle={`${metrics.bookingCount} total bookings`}
                    icon={<BarChart3 className="h-4 w-4" />}
                    iconBgClass="bg-purple-100"
                    gradient={true}
                    gradientClass="bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg shadow-purple-500/25"
                />
            </div>

            {/* Secondary Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MetricCard
                    title="Platform Fee"
                    value={formatCurrency(metrics.platformFee)}
                    subtitle="Service fees"
                    icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                    iconBgClass="bg-muted"
                />
                <MetricCard
                    title="Completed (In Your Account)"
                    value={formatCurrency(completedManagerRevenue)}
                    subtitle={`${metrics.paidBookingCount || 0} bookings processed`}
                    icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    iconBgClass="bg-emerald-100"
                    valueClass="text-emerald-600"
                    tooltip="Money that has been successfully processed and is available in your Stripe Connect account or ready for payout"
                />
                {metrics.refundedAmount > 0 && (
                    <MetricCard
                        title="Refunded"
                        value={formatCurrency(metrics.refundedAmount)}
                        subtitle="Returned to customers"
                        icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
                        iconBgClass="bg-muted"
                    />
                )}
            </div>
        </div>
    )
}
