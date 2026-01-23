/**
 * Manager Revenue Dashboard (Refactored)
 *
 * Enterprise-grade revenue monitoring dashboard for managers.
 * Uses TanStack Query, shadcn components, and modular architecture.
 *
 * Refactored from 1,351 lines to ~350 lines by:
 * - Extracting shared types to revenue/types.ts
 * - Using column definitions from revenue/columns.tsx
 * - Using custom hooks from revenue/hooks/use-revenue-data.ts
 * - Composing smaller components from revenue/components/
 */

import { useState, useMemo, useCallback } from "react"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { Info, CreditCard, ExternalLink, AlertCircle, FileText, Download } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Import from our revenue module
import {
  useRevenueMetrics,
  useRevenueByLocation,
  useRevenueChartData,
  useTransactions,
  useInvoices,
  usePayouts,
  useStripeConnectStatus,
  downloadInvoice,
  downloadPayoutStatement,
  getDefaultDateRange,
  type DateRange,
  type LocationOption,
  type PaymentStatus,
} from "@/components/manager/revenue"

import { RevenueMetricCards } from "@/components/manager/revenue/components/RevenueMetricCards"
import { TransactionTable } from "@/components/manager/revenue/components/TransactionTable"
import { DateRangePicker } from "@/components/manager/revenue/components/DateRangePicker"
import {
  RevenueTrendChart,
  RevenueByLocationChart,
  PaymentStatusChart,
} from "@/components/manager/revenue/components/RevenueCharts"
import { formatCurrency, formatDate, generateInvoiceNumber } from "@/lib/formatters"
import { useToast } from "@/hooks/use-toast"

// ═══════════════════════════════════════════════════════════════════════
// COMPONENT PROPS
// ═══════════════════════════════════════════════════════════════════════

interface ManagerRevenueDashboardProps {
  selectedLocation: LocationOption | null
  locations: LocationOption[]
  onNavigate?: (view: string) => void
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function ManagerRevenueDashboard({
  selectedLocation,
  locations,
  onNavigate,
}: ManagerRevenueDashboardProps) {
  const { user: firebaseUser } = useFirebaseAuth()
  const { toast } = useToast()
  const isEnabled = !!firebaseUser

  // Filter State
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange())
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<number | "all">("all")

  // Data Hooks
  const {
    data: metrics,
    isLoading: isLoadingMetrics,
  } = useRevenueMetrics({
    dateRange,
    locationId: selectedLocationFilter,
    enabled: isEnabled,
  })

  const { data: revenueByLocation = [], isLoading: isLoadingByLocation } = useRevenueByLocation(
    dateRange,
    isEnabled
  )

  const { data: chartData = [], isLoading: isLoadingCharts } = useRevenueChartData(
    dateRange,
    selectedLocationFilter,
    isEnabled
  )

  const {
    data: transactionsData,
    isLoading: isLoadingTransactions,
  } = useTransactions({
    dateRange,
    locationId: selectedLocationFilter,
    enabled: isEnabled,
  })

  const { data: invoices = [], isLoading: isLoadingInvoices } = useInvoices(
    dateRange,
    selectedLocationFilter,
    10,
    isEnabled
  )

  const { data: payouts = [], isLoading: isLoadingPayouts } = usePayouts(isEnabled)

  const { data: stripeStatus } = useStripeConnectStatus(isEnabled)

  // Prepare payment status chart data
  const paymentStatusData = useMemo(() => {
    if (!transactionsData?.transactions) return []

    const statusAmounts: Record<string, { amount: number; count: number }> = {}

    transactionsData.transactions.forEach((t) => {
      const status = t.paymentStatus || "pending"
      const amount =
        status === "paid" || status === "processing"
          ? t.managerRevenue || 0
          : t.totalPrice || 0

      if (!statusAmounts[status]) {
        statusAmounts[status] = { amount: 0, count: 0 }
      }
      statusAmounts[status].amount += amount
      statusAmounts[status].count += 1
    })

    return Object.entries(statusAmounts).map(([status, data]) => ({
      status: status as PaymentStatus,
      amount: data.amount,
      count: data.count,
    }))
  }, [transactionsData])

  // Handlers
  const handleDownloadInvoice = useCallback(async (bookingId: number) => {
    try {
      await downloadInvoice(bookingId)
      toast({
        title: "Invoice Downloaded",
        description: `Invoice ${generateInvoiceNumber(bookingId)} downloaded successfully`,
      })
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download invoice. Please try again.",
        variant: "destructive",
      })
    }
  }, [toast])

  const handleDownloadPayoutStatement = useCallback(async (payoutId: string) => {
    try {
      await downloadPayoutStatement(payoutId)
      toast({
        title: "Statement Downloaded",
        description: "Payout statement downloaded successfully",
      })
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download statement. Please try again.",
        variant: "destructive",
      })
    }
  }, [toast])

  const handleNavigateToPayments = useCallback(() => {
    if (onNavigate) {
      onNavigate("payments")
    }
  }, [onNavigate])

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Revenue Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Track your earnings, payments, and financial performance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date Range Picker */}
          <DateRangePicker
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
          />

          {/* Location Filter */}
          {locations.length > 1 && (
            <Select
              value={selectedLocationFilter === "all" ? "all" : selectedLocationFilter.toString()}
              onValueChange={(value) =>
                setSelectedLocationFilter(value === "all" ? "all" : parseInt(value))
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Info Banner */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-800">
              <p className="font-medium mb-1">Understanding Your Revenue</p>
              <p className="text-blue-700">
                <strong>Completed Payments:</strong> Money in your Stripe account.{" "}
                <strong>Processing:</strong> Payments being processed.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Metrics */}
      <RevenueMetricCards metrics={metrics} isLoading={isLoadingMetrics} />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueTrendChart data={chartData} isLoading={isLoadingCharts} />

        {locations.length > 1 ? (
          <RevenueByLocationChart data={revenueByLocation} isLoading={isLoadingByLocation} />
        ) : (
          <PaymentStatusChart data={paymentStatusData} isLoading={isLoadingTransactions} />
        )}
      </div>

      {/* Transaction History */}
      <TransactionTable
        transactions={transactionsData?.transactions || []}
        isLoading={isLoadingTransactions}
        onDownloadInvoice={handleDownloadInvoice}
      />

      {/* Recent Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-violet-100 rounded-lg">
                <FileText className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <CardTitle className="text-base">Recent Invoices</CardTitle>
                <p className="text-xs text-muted-foreground">Latest booking invoices</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invoices.slice(0, 5).map((invoice: any) => (
                <div
                  key={invoice.bookingId}
                  className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {generateInvoiceNumber(invoice.bookingId, new Date(invoice.bookingDate))}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatDate(invoice.bookingDate)}</span>
                        <span>•</span>
                        <span>{invoice.kitchenName}</span>
                        <span>•</span>
                        <span>{formatCurrency(invoice.totalPrice)}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadInvoice(invoice.bookingId)}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payout History */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 rounded-lg">
              <CreditCard className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-base">Payout History</CardTitle>
              <p className="text-xs text-muted-foreground">Your Stripe Connect payouts</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stripe Connect Warning */}
          {stripeStatus && (!stripeStatus.hasAccount || stripeStatus.status !== "complete") && (
            <Alert className="mb-4 border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-900 font-semibold">
                {!stripeStatus.hasAccount
                  ? "Connect Your Stripe Account"
                  : "Complete Your Stripe Setup"}
              </AlertTitle>
              <AlertDescription className="text-amber-800 mt-2">
                <p className="mb-3">
                  {!stripeStatus.hasAccount
                    ? "Connect Stripe to receive automatic payouts to your bank."
                    : "Complete onboarding to start receiving automatic payouts."}
                </p>
                <Button
                  onClick={handleNavigateToPayments}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  size="sm"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {!stripeStatus.hasAccount ? "Set Up Stripe Connect" : "Complete Setup"}
                  <ExternalLink className="h-3 w-3 ml-2" />
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {isLoadingPayouts ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : payouts.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No payouts yet</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Payouts will appear here once processed
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {payouts.map((payout: any) => (
                <div
                  key={payout.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <CreditCard className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {formatCurrency(payout.amount, payout.currency?.toUpperCase() || "CAD")}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatDate(payout.arrivalDate)}</span>
                        <span>•</span>
                        <span>{payout.method || "Bank Transfer"}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadPayoutStatement(payout.id)}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Statement
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
