/**
 * Revenue & payouts for kitchens, in two tabs. Payouts is the Stripe payout account's one home (owner, Oct 24): the
 * manager has one Stripe account, so it is set up and managed here, next to the money, not per location or in Profile.
 * Earnings is display only: one ledger read (shared with the dashboard card) drives the headline
 * numbers and the Upcoming / Paid / Reports tabs; Stripe bank deposits, payment details and invoices are the existing
 * reads, placed where a kitchen looks for them (deposits under Paid, documents under Reports).
 */

import { useState, useCallback, useEffect } from "react"
import { SiStripe } from "react-icons/si"
import { mt } from "@/i18n/manager"
import { useFirebaseAuth } from "@/hooks/use-auth"
import { CreditCard, ExternalLink, AlertCircle, FileText, Download, ChevronRight, Loader2 } from "@/components/ui/manager-icons"
import { useMutation } from "@tanstack/react-query"
import { getManagerStripeDashboardLink } from "@/lib/manager-stripe-dashboard"
import { Card, CardContent } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChefPageHeader } from "@/components/chef/ui"

// Import from our revenue module
import { useTransactions, useInvoices, usePayouts, useStripeConnectStatus, downloadInvoice, downloadPayoutStatement, type DateRange, type LocationOption } from "@/components/manager/revenue"

import { TransactionTable } from "@/components/manager/revenue/components/TransactionTable"
import { DateRangePicker } from "@/components/manager/revenue/components/DateRangePicker"
import { formatBookingDate, formatCurrency, generateInvoiceNumber } from "@/lib/formatters"
import { useToast } from "@/hooks/use-toast"
import StripeConnectSetup from "@/components/manager/StripeConnectSetup"
import { RevenueLedger } from "@/components/manager/revenue/components/RevenueLedger"
import { BankDeposits } from "@/components/manager/revenue/components/BankDeposits"
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

type RevenueTab = "earnings" | "payouts"
const TAB_TRIGGER =
  "group shrink-0 gap-2 rounded-none border-b-2 border-transparent px-0.5 py-2.5 font-normal text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none"
const urlTab = (): RevenueTab | null => new URLSearchParams(window.location.search).get("tab") === "payouts" ? "payouts" : null

export default function ManagerRevenueDashboard(props: ManagerRevenueDashboardProps) {
  const { user } = useFirebaseAuth()
  const { toast } = useToast()
  const { data: status, isLoading, isError, refetch } = useStripeConnectStatus(!!user)
  const ready = !!status?.accountId && status.hasAccount && status.status === "complete"
    && status.chargesEnabled === true && status.payoutsEnabled === true
  const stripeDashboard = useMutation({
    mutationFn: () => getManagerStripeDashboardLink(),
    onSuccess: ({ url }) => { window.open(url, "_blank", "noopener,noreferrer") },
    onError: (error: Error) => { toast({ title: mt("error"), description: error.message, variant: "destructive" }) },
  })
  // `null` = no explicit choice: open on Payouts while there is nothing to earn yet and payouts aren't on.
  const [chosen, setChosen] = useState<RevenueTab | null>(urlTab)
  useEffect(() => {
    const sync = () => setChosen(urlTab())
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])
  const nothingYet = !ready && props.hasRevenueHistory === false
  const tab: RevenueTab = chosen ?? (nothingYet ? "payouts" : "earnings")
  const openTab = (next: RevenueTab) => {
    setChosen(next)
    const url = new URL(window.location.href)
    if (next === "payouts") url.searchParams.set("tab", "payouts"); else url.searchParams.delete("tab")
    window.history.replaceState(window.history.state, "", url.toString())
  }
  const statusKnown = !!user && !isLoading && !isError

  return <div className="space-y-6">
    <ChefPageHeader
      title={mt("navRevenue")}
      description={mt("r1bPageDescription")}
      actions={status?.hasAccount && tab !== "payouts" && <Button variant="outline" size="sm" disabled={stripeDashboard.isPending} onClick={() => stripeDashboard.mutate()}>
        {stripeDashboard.isPending
          ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          : <SiStripe className="size-4 text-stripe" aria-hidden="true" />}
        {mt("viewStripeDashboard")}<ChevronRight className="size-4" aria-hidden="true" />
      </Button>}
    />
    <Tabs value={tab} onValueChange={value => openTab(value as RevenueTab)}>
      <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
        <TabsTrigger value="earnings" className={TAB_TRIGGER}>{mt("revenueTabEarnings")}</TabsTrigger>
        <TabsTrigger value="payouts" className={TAB_TRIGGER}>
          {mt("revenueTabPayouts")}
          {statusKnown && !ready && <span className="h-2 w-2 rounded-full bg-amber-500" role="img" aria-label={mt("revenuePayoutsNeedAttention")} />}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="earnings" className="mt-6">
        {props.isHistoryLoading && !ready ? <Skeleton className="h-40 w-full" />
          : nothingYet ? <Card className="mx-auto max-w-2xl"><CardContent className="flex flex-col items-start gap-3 p-6 md:p-8">
            <h2 className="text-base font-semibold">{mt("revenueNoEarningsTitle")}</h2>
            <p className="text-sm text-muted-foreground">{mt("revenueNoEarningsBody")}</p>
            <Button size="sm" onClick={() => openTab("payouts")}>{mt("revenueSetUpPayouts")}</Button>
          </CardContent></Card>
          : <RevenueAnalytics {...props} onOpenPayouts={() => openTab("payouts")} showReconnectNotice={statusKnown && !ready} hasPaymentAccount={!!status?.hasAccount} />}
      </TabsContent>
      <TabsContent value="payouts" className="mt-6">
        {!user || isLoading ? <Skeleton className="mx-auto h-40 w-full max-w-2xl" /> : isError ? <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertTitle>{mt("revenueConnectionUnavailable")}</AlertTitle>
          <AlertDescription><Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>{mt("retry")}</Button></AlertDescription>
        </Alert> : <Card className="mx-auto max-w-2xl"><CardContent className="p-6 md:p-8"><StripeConnectSetup /></CardContent></Card>}
      </TabsContent>
    </Tabs>
  </div>
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
  onOpenPayouts,
  showReconnectNotice = false,
  hasPaymentAccount = false,
}: ManagerRevenueDashboardProps & { onOpenPayouts: () => void; showReconnectNotice?: boolean; hasPaymentAccount?: boolean }) {
  const { user: firebaseUser } = useFirebaseAuth()
  const { toast } = useToast()
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

  const handleNavigateToPayments = onOpenPayouts

  const locationOptions = ledger.data?.filters.locations || locations
  const kitchenOptions = (ledger.data?.filters.kitchens || []).filter(k => !locationId || k.locationId === locationId)
  const setupAlert = stripeStatus && (!stripeStatus.hasAccount || stripeStatus.status !== "complete") ? (() => {
    const stage = stripeStatus?.verificationStage
    let alertTitle = mt("completeStripeSetup")
    let alertDesc = mt("completeStripeSetupDesc")
    let buttonLabel = mt("completeSetup")
    if (!stripeStatus.hasAccount) {
      alertTitle = mt("connectStripeAccount"); alertDesc = mt("connectStripeAccountDesc"); buttonLabel = mt("setUpStripeConnect")
    } else if (stage === 'pending_verification') {
      alertTitle = mt("verificationInProgress"); alertDesc = mt("verificationInProgressDesc"); buttonLabel = mt("checkStatus")
    } else if (stage === 'requires_additional_info') {
      alertTitle = mt("additionalInfoNeeded"); alertDesc = mt("additionalInfoNeededDesc"); buttonLabel = mt("provideInformation")
    } else if (stage === 'past_due') {
      alertTitle = mt("stripeActionRequired"); alertDesc = mt("stripeActionRequiredDesc"); buttonLabel = mt("updateInfo")
    } else if (stage === 'details_needed') {
      alertTitle = mt("startStripeSetup"); alertDesc = mt("startStripeSetupDesc"); buttonLabel = mt("completeSetup")
    } else if (stage === 'payouts_disabled') {
      alertTitle = mt("addBankAccount"); alertDesc = mt("addBankAccountDesc"); buttonLabel = mt("addBankAccount")
    }
    const urgent = stage === 'past_due'
    return <Alert className={urgent ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}>
      <AlertCircle className={`h-4 w-4 ${urgent ? 'text-red-600' : 'text-amber-600'}`} />
      <AlertTitle className={`${urgent ? 'text-red-900' : 'text-amber-900'} font-semibold`}>{alertTitle}</AlertTitle>
      <AlertDescription className={`${urgent ? 'text-red-800' : 'text-amber-800'} mt-2`}>
        <p className="mb-3">{alertDesc}</p>
        <Button onClick={handleNavigateToPayments} size="sm" className={`${urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'} text-white`}>
          <CreditCard className="mr-2 h-4 w-4" />{buttonLabel}<ExternalLink className="ml-2 h-3 w-3" />
        </Button>
      </AlertDescription>
    </Alert>
  })() : null

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* One quiet filter row: location and kitchen only appear when there is more than one to choose from. */}
      <div role="group" aria-label={mt("r1bFiltersLabel")} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" data-testid="revenue-filters">
        {locationOptions.length > 1 && <Select value={locationId ? String(locationId) : 'all'} onValueChange={value => { setLocationId(value === 'all' ? undefined : Number(value)); setKitchenId(undefined) }}>
          <SelectTrigger className="h-9 w-full rounded-full sm:w-52" aria-label={mt('r1Location')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{mt('r1AllLocations')}</SelectItem>
            {locationOptions.map(location => <SelectItem key={location.id} value={String(location.id)}>{location.name}</SelectItem>)}
          </SelectContent>
        </Select>}
        {(kitchenOptions.length > 1 || !!kitchenId) && <Select value={kitchenId ? String(kitchenId) : 'all'} onValueChange={value => setKitchenId(value === 'all' ? undefined : Number(value))}>
          <SelectTrigger className="h-9 w-full rounded-full sm:w-52" aria-label={mt('r1Kitchen')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{mt('r1AllKitchens')}</SelectItem>
            {kitchenOptions.map(kitchen => <SelectItem key={kitchen.id} value={String(kitchen.id)}>{kitchen.name}</SelectItem>)}
          </SelectContent>
        </Select>}
        <DateRangePicker className="h-9 w-full rounded-full sm:w-auto" dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      {showReconnectNotice && <Alert>
        <AlertTitle>{mt(hasPaymentAccount ? "revenueReconnectTitle" : "connectStripeAccount")}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{mt(hasPaymentAccount ? "revenueReconnectBody" : "connectStripeAccountDesc")}</span>
          <Button variant="outline" size="sm" onClick={handleNavigateToPayments}>{mt(hasPaymentAccount ? "revenueTabPayouts" : "setUpStripeConnect")}</Button>
        </AlertDescription>
      </Alert>}

      {ledger.isLoading ? <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div> : ledger.isError ? <RevenueSectionError section={mt('navRevenue')} onRetry={() => void ledger.refetch()} />
        : ledger.data && <RevenueLedger data={ledger.data} dateRange={dateRange} onOpenPaymentSettings={handleNavigateToPayments}
          deposits={<BankDeposits payouts={payouts} isLoading={isLoadingPayouts} isError={isErrorPayouts} onRetry={() => void refetchPayouts()}
            onDownloadStatement={handleDownloadPayoutStatement} setupAlert={setupAlert} />}
          documents={<Accordion type="multiple" className="rounded-2xl border border-border/70 px-4 sm:px-5">
            <AccordionItem value="payments">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline">
                <span className="text-left">{mt('r1PaymentDetails')}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{mt('r1bPaymentDetailsBody')}</span></span>
              </AccordionTrigger>
              <AccordionContent>
                {isErrorTransactions ? <RevenueSectionError section={mt('transactionHistory')} onRetry={() => void refetchTransactions()} /> : <TransactionTable
                  transactions={(transactionsData?.transactions || []).filter(t => !kitchenId || t.kitchenId === kitchenId)}
                  isLoading={isLoadingTransactions} onDownloadInvoice={handleDownloadInvoice} />}
              </AccordionContent>
            </AccordionItem>
            {(isErrorInvoices || isLoadingInvoices || invoices.length > 0) && <AccordionItem value="invoices" className="border-b-0">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline">
                <span className="text-left">{mt("recentInvoices")}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{mt("latestBookingInvoices")}</span></span>
              </AccordionTrigger>
              <AccordionContent>
                {isErrorInvoices ? <RevenueSectionError section={mt("recentInvoices")} onRetry={() => void refetchInvoices()} />
                  : isLoadingInvoices ? <Skeleton className="h-24 w-full rounded-xl" />
                  : <ul className="divide-y divide-border/60 rounded-xl border">
                    {invoices.slice(0, 5).map((invoice: any) => <li key={invoice.bookingId} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{generateInvoiceNumber(invoice.bookingId, new Date(invoice.bookingDate))}</p>
                          <p className="truncate text-xs text-muted-foreground">{formatBookingDate(invoice.bookingDate)} · {invoice.kitchenName} · {formatCurrency(invoice.totalPrice)}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => handleDownloadInvoice(invoice.bookingId, invoice.bookingType)}>
                        <Download className="size-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{mt("download")}</span>
                      </Button>
                    </li>)}
                  </ul>}
              </AccordionContent>
            </AccordionItem>}
          </Accordion>} />}
    </div>
  )
}
