/**
 * Revenue Charts Component
 * 
 * Enterprise-grade visualization components using shadcn/ui chart patterns.
 * Uses ChartContainer, ChartTooltip, and ChartLegend for consistent styling.
 */

import { useMemo } from "react"
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    ChartLegend,
    ChartLegendContent,
    type ChartConfig,
} from "@/components/ui/chart"
import { TrendingUp, Building2, CircleDollarSign } from "lucide-react"
import { formatChartDate, centsToDollars } from "@/lib/formatters"
import type { RevenueByDate, RevenueByLocation, PaymentStatus } from "../types"

// ═══════════════════════════════════════════════════════════════════════
// CHART COLORS - Using website's coded colors
// ═══════════════════════════════════════════════════════════════════════

const CHART_COLORS = {
    emerald: "#10b981",      // Emerald-500 - Primary success/revenue color
    emeraldLight: "#34d399", // Emerald-400
    emeraldDark: "#059669",  // Emerald-600
    primary: "#e11d48",      // Rose-600 - Website primary (347 91% 51%)
    blue: "#3b82f6",         // Blue-500 - Processing
    amber: "#f59e0b",        // Amber-500 - Pending
    red: "#ef4444",          // Red-500 - Failed
    gray: "#6b7280",         // Gray-500 - Refunded/Canceled
    violet: "#8b5cf6",       // Violet-500 - Platform fee
}

// ═══════════════════════════════════════════════════════════════════════
// CHART CONFIGS
// ═══════════════════════════════════════════════════════════════════════

const revenueTrendConfig = {
    totalRevenue: {
        label: "Total Revenue",
        color: CHART_COLORS.emerald,
    },
    managerRevenue: {
        label: "Your Earnings",
        color: CHART_COLORS.emeraldDark,
    },
} satisfies ChartConfig

const revenueByLocationConfig = {
    managerRevenue: {
        label: "Your Earnings",
        color: CHART_COLORS.emerald,
    },
    platformFee: {
        label: "Platform Fee",
        color: CHART_COLORS.violet,
    },
} satisfies ChartConfig

// ═══════════════════════════════════════════════════════════════════════
// CHART LOADING SKELETON
// ═══════════════════════════════════════════════════════════════════════

function ChartSkeleton() {
    return (
        <Card>
            <CardHeader className="pb-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48 mt-1" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-[250px] w-full rounded-lg" />
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// REVENUE TREND CHART
// ═══════════════════════════════════════════════════════════════════════

interface RevenueTrendChartProps {
    data: RevenueByDate[]
    isLoading: boolean
}

export function RevenueTrendChart({ data, isLoading }: RevenueTrendChartProps) {
    const chartData = useMemo(() => {
        console.log('[RevenueTrendChart] Raw data:', data);
        const mapped = data.map(item => ({
            date: formatChartDate(item.date),
            totalRevenue: centsToDollars(item.totalRevenue),
            managerRevenue: centsToDollars(item.managerRevenue),
        }));
        console.log('[RevenueTrendChart] Mapped chartData:', mapped);
        return mapped;
    }, [data])

    if (isLoading) {
        return <ChartSkeleton />
    }

    if (chartData.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-muted-foreground" />
                        Revenue Trend
                    </CardTitle>
                    <CardDescription>Daily revenue over time</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center h-[250px] text-center">
                        <TrendingUp className="h-12 w-12 text-muted-foreground/20 mb-4" />
                        <p className="text-sm text-muted-foreground">No revenue data available</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Revenue will appear here once you have bookings</p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                    Revenue Trend
                </CardTitle>
                <CardDescription>Daily revenue over time</CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={revenueTrendConfig} className="h-[250px] w-full">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="fillTotalRevenue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.emerald} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.emerald} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="fillManagerRevenue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.emeraldDark} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.emeraldDark} stopOpacity={0.1} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(value) => value.slice(0, 6)}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(value) => `$${value}`}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent indicator="dot" />}
                        />
                        <Area
                            dataKey="totalRevenue"
                            type="natural"
                            fill="url(#fillTotalRevenue)"
                            stroke={CHART_COLORS.emerald}
                            strokeWidth={2}
                        />
                        <Area
                            dataKey="managerRevenue"
                            type="natural"
                            fill="url(#fillManagerRevenue)"
                            stroke={CHART_COLORS.emeraldDark}
                            strokeWidth={2}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                    </AreaChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// REVENUE BY LOCATION CHART
// ═══════════════════════════════════════════════════════════════════════

interface RevenueByLocationChartProps {
    data: RevenueByLocation[]
    isLoading: boolean
}

export function RevenueByLocationChart({ data, isLoading }: RevenueByLocationChartProps) {
    const chartData = useMemo(() => {
        return data.map(loc => ({
            name: loc.locationName.length > 12 ? loc.locationName.substring(0, 12) + '...' : loc.locationName,
            fullName: loc.locationName,
            managerRevenue: centsToDollars(loc.managerRevenue),
            platformFee: centsToDollars(loc.platformFee),
        }))
    }, [data])

    if (isLoading) {
        return <ChartSkeleton />
    }

    if (chartData.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                        Revenue by Location
                    </CardTitle>
                    <CardDescription>Breakdown by location</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center h-[250px] text-center">
                        <Building2 className="h-12 w-12 text-muted-foreground/20 mb-4" />
                        <p className="text-sm text-muted-foreground">No location data available</p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-violet-600" />
                    Revenue by Location
                </CardTitle>
                <CardDescription>Breakdown by location</CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={revenueByLocationConfig} className="h-[250px] w-full">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="name"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(value) => `$${value}`}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent indicator="dashed" />}
                        />
                        <Bar dataKey="managerRevenue" fill={CHART_COLORS.emerald} radius={4} />
                        <Bar dataKey="platformFee" fill={CHART_COLORS.violet} radius={4} />
                        <ChartLegend content={<ChartLegendContent />} />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// PAYMENT STATUS PIE CHART
// ═══════════════════════════════════════════════════════════════════════

interface PaymentStatusChartProps {
    data: Array<{ status: PaymentStatus; amount: number; count: number }>
    isLoading: boolean
}

const statusColors: Record<PaymentStatus, string> = {
    authorized: CHART_COLORS.blue,
    paid: CHART_COLORS.emerald,
    pending: CHART_COLORS.amber,
    processing: CHART_COLORS.blue,
    failed: CHART_COLORS.red,
    refunded: CHART_COLORS.gray,
    partially_refunded: CHART_COLORS.gray,
    canceled: CHART_COLORS.gray,
}

const statusLabels: Record<PaymentStatus, string> = {
    authorized: 'Payment Held',
    paid: 'Paid',
    pending: 'Pending',
    processing: 'Processing',
    failed: 'Failed',
    refunded: 'Refunded',
    partially_refunded: 'Partial Refund',
    canceled: 'Canceled',
}

export function PaymentStatusChart({ data, isLoading }: PaymentStatusChartProps) {
    const chartData = useMemo(() => {
        return data
            .filter(item => item.amount > 0)
            .map(item => ({
                name: statusLabels[item.status] || item.status,
                value: centsToDollars(item.amount),
                status: item.status,
                count: item.count,
                fill: statusColors[item.status] || 'hsl(var(--muted-foreground))',
            }))
            .sort((a, b) => b.value - a.value)
    }, [data])

    // Build dynamic chart config from data
    const paymentStatusConfig = useMemo(() => {
        const config: ChartConfig = {}
        chartData.forEach(item => {
            config[item.name] = {
                label: item.name,
                color: item.fill,
            }
        })
        return config
    }, [chartData])

    if (isLoading) {
        return <ChartSkeleton />
    }

    if (chartData.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
                        Payment Status
                    </CardTitle>
                    <CardDescription>Distribution by status</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center h-[250px] text-center">
                        <CircleDollarSign className="h-12 w-12 text-muted-foreground/20 mb-4" />
                        <p className="text-sm text-muted-foreground">No payment data available</p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const total = chartData.reduce((sum, item) => sum + item.value, 0)

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CircleDollarSign className="h-5 w-5 text-amber-600" />
                    Payment Status
                </CardTitle>
                <CardDescription>Distribution by status</CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={paymentStatusConfig} className="mx-auto aspect-square h-[250px]">
                    <PieChart>
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent hideLabel />}
                        />
                        <Pie
                            data={chartData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={60}
                            strokeWidth={5}
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                        </Pie>
                        <ChartLegend
                            content={<ChartLegendContent nameKey="name" />}
                            className="-translate-y-2 flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center"
                        />
                    </PieChart>
                </ChartContainer>
                <div className="mt-4 text-center">
                    <p className="text-2xl font-bold">${total.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Total across all statuses</p>
                </div>
            </CardContent>
        </Card>
    )
}
