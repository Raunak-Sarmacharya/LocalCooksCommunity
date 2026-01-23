/**
 * Revenue Charts Component
 * 
 * Recharts-based visualization components for revenue data.
 * Uses shadcn chart patterns with ChartContainer.
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
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LineChart as LineChartIcon, BarChart3, PieChart as PieChartIcon } from "lucide-react"
import { formatCurrency, formatChartDate, centsToDollars } from "@/lib/formatters"
import type { RevenueByDate, RevenueByLocation, PaymentStatus } from "../types"

// ═══════════════════════════════════════════════════════════════════════
// CHART LOADING SKELETON
// ═══════════════════════════════════════════════════════════════════════

function ChartSkeleton() {
    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div>
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-3 w-24 mt-1" />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Skeleton className="h-[280px] w-full" />
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
        return data.map(item => ({
            date: formatChartDate(item.date),
            totalRevenue: centsToDollars(item.totalRevenue),
            managerRevenue: centsToDollars(item.managerRevenue),
            platformFee: centsToDollars(item.platformFee),
        }))
    }, [data])

    if (isLoading) {
        return <ChartSkeleton />
    }

    return (
        <Card className="hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-100 rounded-lg">
                        <LineChartIcon className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                        <CardTitle className="text-base">Revenue Trend</CardTitle>
                        <p className="text-xs text-muted-foreground">Daily revenue over time</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="h-[280px]">
                    {chartData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <LineChartIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground">No revenue data</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">Revenue will appear here</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorManagerRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorTotalRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                                    width={50}
                                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: '1px solid hsl(var(--border))',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                        padding: '8px 12px',
                                        fontSize: '12px',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                    formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                                />
                                <Legend
                                    wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                                    iconType="circle"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="totalRevenue"
                                    stroke="#10b981"
                                    fillOpacity={1}
                                    fill="url(#colorTotalRevenue)"
                                    name="Total Revenue"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="managerRevenue"
                                    stroke="hsl(var(--primary))"
                                    fillOpacity={1}
                                    fill="url(#colorManagerRevenue)"
                                    name="Your Earnings"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
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
            name: loc.locationName.length > 15 ? loc.locationName.substring(0, 15) + '...' : loc.locationName,
            fullName: loc.locationName,
            managerRevenue: centsToDollars(loc.managerRevenue),
            platformFee: centsToDollars(loc.platformFee),
        }))
    }, [data])

    if (isLoading) {
        return <ChartSkeleton />
    }

    return (
        <Card className="hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-violet-100 rounded-lg">
                        <BarChart3 className="h-4 w-4 text-violet-600" />
                    </div>
                    <div>
                        <CardTitle className="text-base">Revenue by Location</CardTitle>
                        <p className="text-xs text-muted-foreground">Breakdown by location</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="h-[280px]">
                    {chartData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <BarChart3 className="h-10 w-10 text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground">No location data</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                                    angle={-45}
                                    textAnchor="end"
                                    height={60}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                                    width={50}
                                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: '1px solid hsl(var(--border))',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                        padding: '8px 12px',
                                        fontSize: '12px',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                    formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                                />
                                <Bar dataKey="managerRevenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Your Earnings" />
                                <Bar dataKey="platformFee" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} name="Platform Fee" />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
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
    paid: '#10b981',
    pending: '#f59e0b',
    processing: '#3b82f6',
    failed: '#ef4444',
    refunded: '#6b7280',
    partially_refunded: '#9ca3af',
    canceled: '#9ca3af',
}

const statusLabels: Record<PaymentStatus, string> = {
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
            }))
            .sort((a, b) => b.value - a.value)
    }, [data])

    if (isLoading) {
        return <ChartSkeleton />
    }

    return (
        <Card className="hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-100 rounded-lg">
                        <PieChartIcon className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                        <CardTitle className="text-base">Payment Status</CardTitle>
                        <p className="text-xs text-muted-foreground">Distribution by status</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="h-[280px]">
                    {chartData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <PieChartIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground">No payment data</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={chartData.length > 1}
                                    label={chartData.length > 1 ? ({ percent }) => `${(percent * 100).toFixed(0)}%` : undefined}
                                    outerRadius={90}
                                    innerRadius={chartData.length === 1 ? 60 : 30}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={statusColors[entry.status as PaymentStatus] || '#6b7280'} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: '1px solid hsl(var(--border))',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                        padding: '8px 12px',
                                        fontSize: '12px',
                                        backgroundColor: 'hsl(var(--background))'
                                    }}
                                    formatter={(value: number, name: string, props: any) => {
                                        const count = props.payload?.count || 0
                                        return [`$${value.toFixed(2)} (${count} bookings)`, name]
                                    }}
                                />
                                <Legend
                                    wrapperStyle={{ fontSize: '12px', paddingTop: '16px' }}
                                    iconType="circle"
                                    formatter={(value, entry: any) => {
                                        const total = chartData.reduce((sum, item) => sum + item.value, 0)
                                        const percent = total > 0 ? ((entry.payload.value / total) * 100).toFixed(1) : '0'
                                        return `${value}: $${entry.payload.value.toFixed(2)} (${percent}%)`
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
