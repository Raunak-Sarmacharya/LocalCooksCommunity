import { logger } from "@/lib/logger";
/**
 * Revenue Data Hooks
 * 
 * Custom hooks for fetching revenue data using TanStack Query.
 * Abstracts all API calls and provides loading/error states.
 */

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { auth } from "@/lib/firebase"
import type {
    RevenueMetrics,
    RevenueByLocation,
    RevenueByDate,
    Transaction,
    Invoice,
    Payout,
    StripeConnectStatus,
    DateRange,
} from "../types"
import { calculatePercentChange } from "@/lib/formatters"

// ═══════════════════════════════════════════════════════════════════════
// AUTH HELPER
// ═══════════════════════════════════════════════════════════════════════

async function getAuthHeaders(): Promise<HeadersInit> {
    const currentFirebaseUser = auth.currentUser
    if (!currentFirebaseUser) {
        throw new Error("Firebase user not available")
    }
    const token = await currentFirebaseUser.getIdToken()
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// DATE RANGE HELPERS
// ═══════════════════════════════════════════════════════════════════════

export function useDateRangeParams(dateRange: DateRange) {
    return useMemo(() => {
        const startDate = dateRange.from ? dateRange.from.toISOString().split('T')[0] : undefined
        const endDate = dateRange.to ? dateRange.to.toISOString().split('T')[0] : undefined
        return { startDate, endDate }
    }, [dateRange.from, dateRange.to])
}

export function getDefaultDateRange(): DateRange {
    const today = new Date()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { from: startOfMonth, to: endOfMonth }
}

export function getPreviousPeriodRange(dateRange: DateRange): DateRange {
    if (!dateRange.from || !dateRange.to) {
        return { from: undefined, to: undefined }
    }

    const duration = dateRange.to.getTime() - dateRange.from.getTime()
    const previousTo = new Date(dateRange.from.getTime() - 1) // Day before current start
    const previousFrom = new Date(previousTo.getTime() - duration)

    return { from: previousFrom, to: previousTo }
}

// ═══════════════════════════════════════════════════════════════════════
// REVENUE METRICS HOOK
// ═══════════════════════════════════════════════════════════════════════

interface UseRevenueMetricsOptions {
    dateRange: DateRange
    locationId?: number | 'all'
    enabled?: boolean
}

export function useRevenueMetrics({ dateRange, locationId, enabled = true }: UseRevenueMetricsOptions) {
    const { startDate, endDate } = useDateRangeParams(dateRange)
    const previousRange = getPreviousPeriodRange(dateRange)
    const { startDate: prevStartDate, endDate: prevEndDate } = useDateRangeParams(previousRange)

    // Current period metrics
    const currentQuery = useQuery({
        queryKey: ['/api/manager/revenue/overview', startDate, endDate, locationId],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const params = new URLSearchParams()
            if (startDate) params.append('startDate', startDate)
            if (endDate) params.append('endDate', endDate)
            if (locationId && locationId !== 'all') params.append('locationId', locationId.toString())

            const response = await fetch(`/api/manager/revenue/overview?${params}`, {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch revenue metrics')
            return response.json() as Promise<RevenueMetrics>
        },
        enabled: enabled && !!startDate && !!endDate,
    })

    // Previous period metrics for comparison
    const previousQuery = useQuery({
        queryKey: ['/api/manager/revenue/overview', prevStartDate, prevEndDate, locationId, 'previous'],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const params = new URLSearchParams()
            if (prevStartDate) params.append('startDate', prevStartDate)
            if (prevEndDate) params.append('endDate', prevEndDate)
            if (locationId && locationId !== 'all') params.append('locationId', locationId.toString())

            const response = await fetch(`/api/manager/revenue/overview?${params}`, {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch previous period metrics')
            return response.json() as Promise<RevenueMetrics>
        },
        enabled: enabled && !!prevStartDate && !!prevEndDate,
    })

    // Combine with comparison data
    const metricsWithComparison = useMemo(() => {
        if (!currentQuery.data) return null

        const current = currentQuery.data
        const previous = previousQuery.data

        return {
            ...current,
            previousPeriodRevenue: previous?.totalRevenue || 0,
            revenueChangePercent: previous?.totalRevenue
                ? calculatePercentChange(current.totalRevenue, previous.totalRevenue)
                : undefined,
        } as RevenueMetrics
    }, [currentQuery.data, previousQuery.data])

    return {
        data: metricsWithComparison,
        isLoading: currentQuery.isLoading,
        isError: currentQuery.isError,
        error: currentQuery.error,
        refetch: currentQuery.refetch,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// REVENUE BY LOCATION HOOK
// ═══════════════════════════════════════════════════════════════════════

export function useRevenueByLocation(dateRange: DateRange, enabled: boolean = true) {
    const { startDate, endDate } = useDateRangeParams(dateRange)

    return useQuery({
        queryKey: ['/api/manager/revenue/by-location', startDate, endDate],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const params = new URLSearchParams()
            if (startDate) params.append('startDate', startDate)
            if (endDate) params.append('endDate', endDate)

            const response = await fetch(`/api/manager/revenue/by-location?${params}`, {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch revenue by location')
            return response.json() as Promise<RevenueByLocation[]>
        },
        enabled: enabled && !!startDate && !!endDate,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// CHART DATA HOOK
// ═══════════════════════════════════════════════════════════════════════

export function useRevenueChartData(
    dateRange: DateRange,
    locationId?: number | 'all',
    enabled: boolean = true
) {
    const { startDate, endDate } = useDateRangeParams(dateRange)

    return useQuery({
        queryKey: ['/api/manager/revenue/charts', startDate, endDate, locationId],
        queryFn: async () => {
            logger.info('[useRevenueChartData] Fetching charts with:', { startDate, endDate, locationId })
            const headers = await getAuthHeaders()
            const params = new URLSearchParams({
                period: 'daily',
            })
            if (startDate) params.append('startDate', startDate)
            if (endDate) params.append('endDate', endDate)
            if (locationId && locationId !== 'all') params.append('locationId', locationId.toString())

            const response = await fetch(`/api/manager/revenue/charts?${params}`, {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch chart data')
            const result = await response.json()
            logger.info('[useRevenueChartData] Received data:', result.data)
            return result.data as RevenueByDate[]
        },
        enabled: enabled && !!startDate && !!endDate,
        staleTime: 0, // Always refetch when date range changes
        refetchOnWindowFocus: false,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTIONS HOOK
// ═══════════════════════════════════════════════════════════════════════

interface UseTransactionsOptions {
    dateRange: DateRange
    locationId?: number | 'all'
    paymentStatus?: string
    limit?: number
    offset?: number
    enabled?: boolean
}

export function useTransactions({
    dateRange,
    locationId,
    paymentStatus,
    limit = 50,
    offset = 0,
    enabled = true
}: UseTransactionsOptions) {
    const { startDate, endDate } = useDateRangeParams(dateRange)

    return useQuery({
        queryKey: ['/api/manager/revenue/transactions', startDate, endDate, locationId, paymentStatus, limit, offset],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const params = new URLSearchParams({
                limit: limit.toString(),
                offset: offset.toString(),
            })
            if (startDate) params.append('startDate', startDate)
            if (endDate) params.append('endDate', endDate)
            if (locationId && locationId !== 'all') params.append('locationId', locationId.toString())
            if (paymentStatus && paymentStatus !== 'all') params.append('paymentStatus', paymentStatus)

            const response = await fetch(`/api/manager/revenue/transactions?${params}`, {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch transactions')
            const result = await response.json()
            return {
                transactions: result.transactions as Transaction[],
                total: result.total as number,
            }
        },
        enabled: enabled && !!startDate && !!endDate,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// INVOICES HOOK
// ═══════════════════════════════════════════════════════════════════════

export function useInvoices(
    dateRange: DateRange,
    locationId?: number | 'all',
    limit: number = 20,
    enabled: boolean = true
) {
    const { startDate, endDate } = useDateRangeParams(dateRange)

    return useQuery({
        queryKey: ['/api/manager/revenue/invoices', startDate, endDate, locationId, limit],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const params = new URLSearchParams({
                limit: limit.toString(),
                offset: '0',
            })
            if (startDate) params.append('startDate', startDate)
            if (endDate) params.append('endDate', endDate)
            if (locationId && locationId !== 'all') params.append('locationId', locationId.toString())

            const response = await fetch(`/api/manager/revenue/invoices?${params}`, {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch invoices')
            const result = await response.json()
            return result.invoices as Invoice[]
        },
        enabled: enabled && !!startDate && !!endDate,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// PAYOUTS HOOK
// ═══════════════════════════════════════════════════════════════════════

export function usePayouts(enabled: boolean = true) {
    return useQuery({
        queryKey: ['/api/manager/revenue/payouts'],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const response = await fetch('/api/manager/revenue/payouts', {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch payouts')
            const result = await response.json()
            return result.payouts as Payout[]
        },
        enabled,
    })
}

// ═══════════════════════════════════════════════════════════════════════
// STRIPE CONNECT STATUS HOOK
// ═══════════════════════════════════════════════════════════════════════

export function useStripeConnectStatus(enabled: boolean = true) {
    return useQuery({
        queryKey: ['/api/manager/stripe-connect/status'],
        queryFn: async () => {
            const headers = await getAuthHeaders()
            const response = await fetch('/api/manager/stripe-connect/status', {
                headers,
                credentials: 'include',
            })

            if (!response.ok) throw new Error('Failed to fetch Stripe Connect status')
            return response.json() as Promise<StripeConnectStatus>
        },
        enabled,
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    })
}

// ═══════════════════════════════════════════════════════════════════════
// INVOICE DOWNLOAD HANDLER
// ═══════════════════════════════════════════════════════════════════════

export async function downloadInvoice(bookingId: number, bookingType?: string, transactionId?: number): Promise<void> {
    const headers = await getAuthHeaders()
    
    // For storage transactions (including extensions), use the storage-specific endpoint
    // bookingId for storage is the storage_bookings.id
    const isStorage = bookingType === 'storage' || bookingType === 'storage_extension'
    const endpoint = isStorage
        ? `/api/manager/revenue/invoices/storage/${bookingId}`
        : `/api/manager/revenue/invoices/${bookingId}`
    
    const response = await fetch(endpoint, {
        headers,
        credentials: 'include',
    })

    if (!response.ok) throw new Error('Failed to download invoice')

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filename = isStorage 
        ? `storage-invoice-${bookingId}.pdf`
        : `invoice-${bookingId}.pdf`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
}

// Refund a transaction (manager-initiated)
export async function refundTransaction(params: {
    transactionId: number;
    amountCents: number;
    reason?: string;
}): Promise<any> {
    const headers = await getAuthHeaders()
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 20000)
    try {
        const response = await fetch(`/api/manager/revenue/transactions/${params.transactionId}/refund`, {
            method: 'POST',
            headers,
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({
                amount: params.amountCents,
                reason: params.reason,
            }),
        })

        if (!response.ok) {
            const errorBody = await response.json().catch(() => null)
            throw new Error(errorBody?.error || 'Failed to process refund')
        }

        return response.json()
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error('Refund request timed out. Please try again.')
        }
        throw error
    } finally {
        window.clearTimeout(timeoutId)
    }
}

// ═══════════════════════════════════════════════════════════════════════
// PAYOUT STATEMENT DOWNLOAD HANDLER
// ═══════════════════════════════════════════════════════════════════════

export async function downloadPayoutStatement(payoutId: string): Promise<void> {
    const headers = await getAuthHeaders()
    const response = await fetch(`/api/manager/revenue/payouts/${payoutId}/statement`, {
        headers,
        credentials: 'include',
    })

    if (!response.ok) throw new Error('Failed to download payout statement')

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payout-statement-${payoutId.substring(3)}.pdf`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
}
