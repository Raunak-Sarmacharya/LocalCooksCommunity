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
import { mt } from "@/i18n/manager"
import { useQueryClient } from "@tanstack/react-query"
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
  refundTransaction,
  getDefaultDateRange,
  type DateRange,
  type LocationOption,
  type PaymentStatus,
  type Transaction,
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
  const queryClient = useQueryClient()
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
  // Uses totalPrice for consistency with Revenue Trend chart's "Total Revenue"
  const paymentStatusData = useMemo(() => {
    if (!transactionsData?.transactions) return []

    const statusAmounts: Record<string, { amount: number; count: number }> = {}

    transactionsData.transactions.forEach((t) => {
      const status = t.paymentStatus || "pending"
      // Use totalPrice for all statuses to match Revenue Trend's Total Revenue
      const amount = t.totalPrice || 0

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
  const handleDownloadInvoice = useCallback(async (bookingId: number, bookingType?: string, transactionId?: number) => {
    try {
      await downloadInvoice(bookingId, bookingType, transactionId)
      toast({ title: mt("invoiceDownloaded"),
        description: mt("invoiceDownloadedDesc", { number: generateInvoiceNumber(bookingId) }),
      })
    } catch (error: any) {
      toast({ title: mt("downloadFailed"),
        description: error?.message || mt("failedToDownloadInvoiceTryAgain"),
        variant: "destructive",
      })
    }
  }, [toast])

  const handleDownloadPayoutStatement = useCallback(async (payoutId: string) => {
    try {
      await downloadPayoutStatement(payoutId)
      toast({ title: mt("statementDownloaded"),
        description: mt("payoutStatementDownloadedSuccessfully"),
      })
    } catch (error) {
      toast({ title: mt("downloadFailed"),
        description: mt("failedToDownloadStatementPleaseTryAgain"),
        variant: "destructive",
      })
    }
  }, [toast])

  const handleRefundTransaction = useCallback(async (transaction: Transaction, amountCents: number, reason?: string) => {
    if (!transaction?.transactionId) {
      toast({ title: mt("refundFailed"),
        description: mt("missingTransactionIDForThisBooking"),
        variant: "destructive",
      })
      throw new Error(mt("missingTransactionIdForBooking"))
    }

    try {
      await refundTransaction({
        transactionId: transaction.transactionId,
        amountCents,
        reason,
      })

      toast({ title: mt("refundInitiated"),
        description: mt("theRefundWasSubmittedSuccessfully"),
      })

      // Refresh revenue data after refund
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/transactions'] })
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/overview'] })
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/charts'] })
    } catch (error: any) {
      toast({ title: mt("refundFailed"),
        description: error?.message || mt("unableToProcessRefundTryAgain"),
        variant: "destructive",
      })
      throw error
    }
  }, [queryClient, toast])

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
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{mt("revenueDashboard")}</h1>
          <p className="text-muted-foreground mt-1">{mt("trackYourEarningsPaymentsAndFinancialPerformance")}</p>
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
                <SelectValue placeholder={mt("cmdAllLocations")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{mt("cmdAllLocations")}</SelectItem>
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
              <p className="font-medium mb-1">{mt("understandingYourRevenue")}</p>
              <p className="text-blue-700">
                <strong>{mt("completedPayments")}</strong> Money in your Stripe account.{" "}
                <strong>{mt("processing2")}</strong>{mt("paymentsBeingProcessed")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Metrics */}
      <RevenueMetricCards metrics={metrics} isLoading={isLoadingMetrics} transactions={transactionsData?.transactions} />

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
        onRefundTransaction={handleRefundTransaction}
      />

      {/* Recent Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-violet-600" />
              <div>
                <CardTitle className="text-base">{mt("recentInvoices")}</CardTitle>
                <p className="text-xs text-muted-foreground">{mt("latestBookingInvoices")}</p>
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
                    onClick={() => handleDownloadInvoice(invoice.bookingId, invoice.bookingType)}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />{mt("download")}</Button>
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
            <CreditCard className="h-4 w-4 text-emerald-600" />
            <div>
              <CardTitle className="text-base">{mt("payoutHistory")}</CardTitle>
              <p className="text-xs text-muted-foreground">{mt("yourStripeConnectPayouts")}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stripe Connect Warning */}
          {stripeStatus && (!stripeStatus.hasAccount || stripeStatus.status !== "complete") && (() => {
            const stage = stripeStatus?.verificationStage;
            let alertTitle = mt("completeStripeSetup");
            let alertDesc = mt("completeStripeSetupDesc");
            let buttonLabel = mt("completeSetup");
            
            if (!stripeStatus.hasAccount) {
              alertTitle = mt("connectStripeAccount");
              alertDesc = mt("connectStripeAccountDesc");
              buttonLabel = mt("setUpStripeConnect");
            } else if (stage === 'pending_verification') {
              alertTitle = mt("verificationInProgress");
              alertDesc = mt("verificationInProgressDesc");
              buttonLabel = mt("checkStatus");
            } else if (stage === 'requires_additional_info') {
              alertTitle = mt("additionalInfoNeeded");
              alertDesc = mt("additionalInfoNeededDesc");
              buttonLabel = mt("provideInformation");
            } else if (stage === 'past_due') {
              alertTitle = mt("stripeActionRequired");
              alertDesc = mt("stripeActionRequiredDesc");
              buttonLabel = mt("updateInfo");
            } else if (stage === 'details_needed') {
              alertTitle = mt("startStripeSetup");
              alertDesc = mt("startStripeSetupDesc");
              buttonLabel = mt("completeSetup");
            } else if (stage === 'payouts_disabled') {
              alertTitle = mt("addBankAccount");
              alertDesc = mt("addBankAccountDesc");
              buttonLabel = mt("addBankAccount");
            }

            return (
              <Alert className={`mb-4 ${stage === 'past_due' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                <AlertCircle className={`h-4 w-4 ${stage === 'past_due' ? 'text-red-600' : 'text-amber-600'}`} />
                <AlertTitle className={`${stage === 'past_due' ? 'text-red-900' : 'text-amber-900'} font-semibold`}>
                  {alertTitle}
                </AlertTitle>
                <AlertDescription className={`${stage === 'past_due' ? 'text-red-800' : 'text-amber-800'} mt-2`}>
                  <p className="mb-3">{alertDesc}</p>
                  <Button
                    onClick={handleNavigateToPayments}
                    className={`${stage === 'past_due' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'} text-white`}
                    size="sm"
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {buttonLabel}
                    <ExternalLink className="h-3 w-3 ml-2" />
                  </Button>
                </AlertDescription>
              </Alert>
            );
          })()}

          {isLoadingPayouts ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : payouts.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">{mt("noPayoutsYet")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1">{mt("payoutsWillAppearHereOnceProcessed")}</p>
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
                        <span>{payout.method || mt("bankTransfer")}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadPayoutStatement(payout.id)}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />{mt("statement")}</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
