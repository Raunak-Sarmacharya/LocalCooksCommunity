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

import { useState, useCallback, useEffect } from "react"
import { SiStripe } from "react-icons/si"
import { mt } from "@/i18n/manager"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { CreditCard, ExternalLink, AlertCircle, FileText, Download, ChevronRight, Loader2 } from "@/components/ui/manager-icons"
import { useMutation } from "@tanstack/react-query"
import { getManagerStripeDashboardLink } from "@/lib/manager-stripe-dashboard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { ChefPageHeader } from "@/components/chef/ui"

// Import from our revenue module
import { useTransactions, useInvoices, usePayouts, useStripeConnectStatus, downloadInvoice, downloadPayoutStatement, type DateRange, type LocationOption } from "@/components/manager/revenue"

import { TransactionTable } from "@/components/manager/revenue/components/TransactionTable"
import { DateRangePicker } from "@/components/manager/revenue/components/DateRangePicker"
import { formatBookingDate, formatCurrency, formatDate, generateInvoiceNumber } from "@/lib/formatters"
import { useToast } from "@/hooks/use-toast"
import StripeConnectSetup from "@/components/manager/StripeConnectSetup"
import { RevenueLedger } from "@/components/manager/revenue/components/RevenueLedger"
import { useManagerRevenue } from "@/components/manager/revenue/hooks/use-manager-revenue"

// ═══════════════════════════════════════════════════════════════════════
// COMPONENT PROPS
// ═══════════════════════════════════════════════════════════════════════

interface ManagerRevenueDashboardProps {
  selectedLocation: LocationOption | null
  locations: LocationOption[]
  hasPublishedKitchen?: boolean
  hasRevenueHistory?: boolean
  isHistoryLoading?: boolean
  onNavigate?: (view: string) => void
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function ManagerRevenueDashboard(props: ManagerRevenueDashboardProps) {
  const { user } = useFirebaseAuth()
  const { data: status, isLoading, isError, refetch } = useStripeConnectStatus(!!user)
  const ready = !!status?.accountId && status.hasAccount && status.status === "complete"
    && status.chargesEnabled === true && status.payoutsEnabled === true
  if (!ready && props.isHistoryLoading) {
    return <div className="space-y-6"><ChefPageHeader title={mt("navRevenue")} /><Skeleton className="h-40 w-full" /></div>
  }
  if (!ready && props.hasRevenueHistory === false) {
    return <div className="space-y-6">
      <ChefPageHeader title={mt("navRevenue")} />
      {!user || isLoading ? <Skeleton className="mx-auto h-40 w-full max-w-2xl" /> : isError ? <Alert variant="destructive" className="mx-auto max-w-2xl">
        <AlertTitle>{mt("revenueConnectionUnavailable")}</AlertTitle>
        <AlertDescription><Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>{mt("retry")}</Button></AlertDescription>
      </Alert> : <Card className="mx-auto max-w-2xl"><CardContent className="p-6 md:p-8"><StripeConnectSetup /></CardContent></Card>}
    </div>
  }
  return <RevenueAnalytics {...props} showReconnectNotice={!!user && !isLoading && !isError && !ready} hasPaymentAccount={!!status?.hasAccount} />
}

function RevenueSectionError({ section, onRetry }: { section: string; onRetry: () => void }) {
  return <Card className="border-destructive/30"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
    <p className="text-sm text-destructive">{mt("revenueSectionUnavailable", { section })}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>{mt("retry")}</Button>
  </CardContent></Card>
}

function RevenueAnalytics({
  selectedLocation,
  locations,
  onNavigate,
  hasPublishedKitchen = false,
  showReconnectNotice = false,
  hasPaymentAccount = false,
}: ManagerRevenueDashboardProps & { showReconnectNotice?: boolean; hasPaymentAccount?: boolean }) {
  const { user: firebaseUser } = useFirebaseAuth()
  const { toast } = useToast()
  const stripeDashboard = useMutation({
    mutationFn: () => getManagerStripeDashboardLink(),
    onSuccess: ({ url }) => { window.open(url, "_blank", "noopener,noreferrer") },
    onError: (error: Error) => { toast({ title: mt("error"), description: error.message, variant: "destructive" }) },
  })
  const isEnabled = !!firebaseUser

  const [dateRange, setDateRange] = useState<DateRange>(() => ({ from: new Date(new Date().getFullYear(), new Date().getMonth(), 1), to: new Date() }))
  const [locationId, setLocationId] = useState<number | undefined>(selectedLocation?.id)
  const [kitchenId, setKitchenId] = useState<number | undefined>()
  useEffect(() => { setLocationId(selectedLocation?.id); setKitchenId(undefined) }, [selectedLocation?.id])
  const ledger = useManagerRevenue(dateRange, locationId, kitchenId, isEnabled)

  const {
    data: transactionsData,
    isLoading: isLoadingTransactions,
    isError: isErrorTransactions,
    refetch: refetchTransactions,
  } = useTransactions({
    dateRange,
    locationId,
    enabled: isEnabled,
  })

  const { data: invoices = [], isLoading: isLoadingInvoices, isError: isErrorInvoices, refetch: refetchInvoices } = useInvoices(
    dateRange,
    locationId,
    10,
    isEnabled
  )

  const { data: payouts = [], isLoading: isLoadingPayouts, isError: isErrorPayouts, refetch: refetchPayouts } = usePayouts(isEnabled)

  const { data: stripeStatus } = useStripeConnectStatus(isEnabled)

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
      <ChefPageHeader 
        title={mt("navRevenue")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {hasPaymentAccount && <Button variant="outline" size="sm" disabled={stripeDashboard.isPending} onClick={() => stripeDashboard.mutate()}>
              {stripeDashboard.isPending
                ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                : <SiStripe className="size-4 text-stripe" aria-hidden="true" />}
              {mt("viewStripeDashboard")}<ChevronRight className="size-4" aria-hidden="true" />
            </Button>}
            <label className="text-sm">{mt('r1Location')}
              <select className="ml-2 rounded-md border bg-background p-2" value={locationId || 'all'} onChange={event => { setLocationId(event.target.value === 'all' ? undefined : Number(event.target.value)); setKitchenId(undefined) }}>
                <option value="all">{mt('r1AllLocations')}</option>
                {(ledger.data?.filters.locations || locations).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label className="text-sm">{mt('r1Kitchen')}
              <select className="ml-2 rounded-md border bg-background p-2" value={kitchenId || 'all'} onChange={event => setKitchenId(event.target.value === 'all' ? undefined : Number(event.target.value))}>
                <option value="all">{mt('r1AllKitchens')}</option>
                {ledger.data?.filters.kitchens.filter(k => !locationId || k.locationId === locationId).map(kitchen => <option key={kitchen.id} value={kitchen.id}>{kitchen.name}</option>)}
              </select>
            </label>
            {/* Date Range Picker */}
            <DateRangePicker
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />

          </div>
        }
      />

      {showReconnectNotice && <Alert>
        <AlertTitle>{mt(hasPaymentAccount ? "revenueReconnectTitle" : "connectStripeAccount")}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{mt(hasPaymentAccount ? "revenueReconnectBody" : "connectStripeAccountDesc")}</span>
          <Button variant="outline" size="sm" onClick={handleNavigateToPayments}>{mt(hasPaymentAccount ? "navPayments" : "setUpStripeConnect")}</Button>
        </AlertDescription>
      </Alert>}

      {ledger.isLoading ? <Skeleton className="h-64 w-full" /> : ledger.isError ? <RevenueSectionError section={mt('navRevenue')} onRetry={() => void ledger.refetch()} />
        : ledger.data && <RevenueLedger data={ledger.data} dateRange={dateRange} documents={<div className="space-y-6">
          <details><summary className="cursor-pointer text-sm font-medium">{mt('r1PaymentDetails')}</summary>
            {isErrorTransactions ? <RevenueSectionError section={mt('transactionHistory')} onRetry={() => void refetchTransactions()} /> : <TransactionTable
              transactions={(transactionsData?.transactions || []).filter(t => !kitchenId || t.kitchenId === kitchenId)}
              isLoading={isLoadingTransactions} onDownloadInvoice={handleDownloadInvoice} />}
          </details>
      {/* Recent Invoices */}
      {isErrorInvoices ? <RevenueSectionError section={mt("recentInvoices")} onRetry={() => void refetchInvoices()} /> : invoices.length > 0 && (
        <Card>
          <CardHeader>
            <div>
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {generateInvoiceNumber(invoice.bookingId, new Date(invoice.bookingDate))}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatBookingDate(invoice.bookingDate)}</span>
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

          {isErrorPayouts ? (
            <div className="flex flex-wrap items-center justify-between gap-3 py-5">
              <p className="text-sm text-destructive">{mt("revenueSectionUnavailable", { section: mt("payoutHistory") })}</p>
              <Button variant="outline" size="sm" onClick={() => void refetchPayouts()}>{mt("retry")}</Button>
            </div>
          ) : isLoadingPayouts ? (
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
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
        </div>} />}
    </div>
  )
}
