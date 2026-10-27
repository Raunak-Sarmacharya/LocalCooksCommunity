/**
 * Rent storage (WP-ST10, /storage/new?kitchenId&listingId): a two-step stepper — choose dates, then review and pay.
 * The price is the server's quote; it is re-quoted silently right before checkout, so reading the terms never expires it.
 */
import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useSearch } from "wouter"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StoragePageShell } from "@/components/storage/StoragePageShell"
import { CheckoutCancellationDisclosure, CheckoutConsentNotice } from "@/components/booking/CheckoutCancellationDisclosure"
import { PublishedCancellationPolicySummary, type PolicyResponse } from "@/components/booking/CancellationPolicySummary"
import { StorageListingDetails, StorageRentCta } from "@/components/storage/StorageRentCta"
import { SmartImage } from "@/components/ui/smart-image"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"
import { apiGet } from "@/lib/api"
import { newRequestKey } from "@/lib/session-extensions"
import { cad, quoteRental, requestRental, storageAvailability, storageDay, type StorageQuote } from "@/lib/storage-rentals"
import { addDays, localDayStart, localToday, MAX_LEAD_DAYS } from "@shared/storage-rental"
import { cn } from "@/lib/utils"

const QUICK_DAYS = [7, 14, 30] as const
type Failure = Error & { code?: string; fitsDays?: number; refusal?: { message?: string; actionUrl?: string; applicationStatus?: string } }

export default function ChefStorageRequestPage() {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as (key: string, options?: Record<string, unknown>) => string
  const locale = i18n.language
  const { t: tc } = useTranslation("chef")
  const [, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const kitchenId = Number(params.get("kitchenId")), listingId = Number(params.get("listingId"))
  const validKitchen = Number.isSafeInteger(kitchenId) && kitchenId > 0
  const valid = validKitchen && Number.isSafeInteger(listingId) && listingId > 0
  // A kitchen without a listing (an older link, or the kitchen page's general entry): let the chef pick one instead of a dead end.
  const pickListing = validKitchen && !params.get("listingId")

  const listings = useQuery({ queryKey: ["storage-availability", kitchenId], queryFn: () => storageAvailability(kitchenId), enabled: validKitchen })
  const listing = listings.data?.find(row => row.listingId === listingId)
  const timezone = listing?.timezone || "America/St_Johns"
  const today = localToday(new Date(), timezone)
  const startOptions = useMemo(() => Array.from({ length: MAX_LEAD_DAYS + 1 }, (_, n) => addDays(today, n)), [today])
  const firstFree = listing?.availability.state === "from" && listing.availability.from && listing.availability.from > today ? listing.availability.from : today
  const maxDays = listing?.maxTermDays ?? 30
  // No start the chef can pick (next opening is past the request window, or none): say when, instead of greyed-out dates.
  const nextOpening = listing?.availability.state === "from" ? listing.availability.from ?? null : null
  const noStartInWindow = !!listing && (listing.availability.state === "full" || (!!nextOpening && nextOpening > startOptions[startOptions.length - 1]))

  const [step, setStep] = useState<1 | 2>(1)
  const [startOn, setStartOn] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  // One key per accepted request: Stripe dedupes retries; any change of dates or price starts a new one.
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [policyOpen, setPolicyOpen] = useState(false)
  useEffect(() => { if (listing && !startOn) { setStartOn(startOptions.includes(firstFree) ? firstFree : today); setDays(d => Math.min(d, listing.maxTermDays)) } }, [listing, startOn, firstFree, startOptions, today])

  const quote = useQuery<StorageQuote, Failure>({ queryKey: ["storage-quote", listingId, startOn, days], queryFn: () => quoteRental({ listingId, startOn: startOn!, days }),
    enabled: !!listing && !!startOn, placeholderData: keepPreviousData, retry: false, staleTime: 30_000 })
  const policy = useQuery<PolicyResponse>({ queryKey: ["cancellation-policy", kitchenId], queryFn: () => apiGet(`/kitchens/${kitchenId}/cancellation-policy`, false), enabled: valid })
  const q = quote.data && quote.data.startOn === startOn && quote.data.days === days && !quote.isFetching ? quote.data : null
  const approvalNeeded = quote.error?.code === "approval_required"
  // Approved before, but something blocks new bookings now (a document to renew, the kitchen paused): say that, not "apply".
  const refusal = approvalNeeded && quote.error?.refusal?.applicationStatus && quote.error.refusal.applicationStatus !== "application_required" ? quote.error.refusal : null
  const kitchen = listing?.kitchenName || t("stcTheKitchen")
  const payLabel = q ? t("stcRequestPay", { amount: cad(q.totalCents, locale) }) : t("stcRequest")

  const choose = (next: number) => { setDays(Math.max(1, Math.min(maxDays, next))); setPayError(null); setRequestKey(newRequestKey()) }
  const pay = async () => {
    if (!q || paying) return
    setPaying(true); setPayError(null)
    try {
      const result = await requestRental({ listingId, startOn: q.startOn, days: q.days, requestKey, acceptedTotalCents: q.totalCents })
      if ("priceChanged" in result && result.priceChanged) {
        setPayError(t("stcPriceChanged", { amount: cad(result.priceChanged.totalCents, locale) }))
        setRequestKey(newRequestKey())
        await quote.refetch()
        setPaying(false)
        return
      }
      window.location.assign(result.checkoutUrl!)
    } catch (error) {
      setPayError(error instanceof Error ? error.message : t("stcLoadError"))
      setPaying(false)
    }
  }

  const summary = q && <dl className="grid grid-cols-[1fr,auto] gap-x-4 gap-y-1.5 text-sm" data-testid="storage-price">
    <dt>{t("stcPriceLine", { amount: cad(q.dailyPriceCents, locale), days: t("stcDays", { count: q.days }) })}</dt><dd className="text-right tabular-nums">{cad(q.subtotalCents, locale)}</dd>
    {q.taxCents > 0 && <><dt className="text-muted-foreground">{t("stcTax")}</dt><dd className="text-right tabular-nums">{cad(q.taxCents, locale)}</dd></>}
    {q.serviceFeeCents > 0 && <><dt className="text-muted-foreground">{t("stcServiceFee")}</dt><dd className="text-right tabular-nums">{cad(q.serviceFeeCents, locale)}</dd></>}
    <dt className="border-t pt-2 font-semibold">{t("stcTotal")}</dt><dd className="border-t pt-2 text-right font-semibold tabular-nums">{cad(q.totalCents, locale)}</dd>
  </dl>

  // Renting starts on a kitchen's page: keep that place in the nav and breadcrumbs, not "My storage".
  const parent = useMemo(() => ({ activeView: "discover-kitchens", trail: [
    { label: tc("shellDiscoverKitchens"), navId: "discover-kitchens", onClick: () => navigate("/dashboard?view=discover-kitchens") },
    ...(listing?.locationId ? [{ label: kitchen, onClick: () => navigate(`/kitchen-preview/${listing.locationId}?kitchenId=${kitchenId}`) }] : []),
  ] }), [tc, navigate, listing?.locationId, kitchen, kitchenId])
  return <StoragePageShell crumb={t("stcRequestTitle")} parent={parent}>
    {pickListing && listings.data?.some(row => row.availability.state !== "full") ? <section className="space-y-3" data-testid="storage-pick">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("stcRentStorage")}</h1>
        <p className="text-sm text-muted-foreground">{t("stcPickListing", { kitchen: listings.data[0].kitchenName || t("stcTheKitchen") })}</p>
      </header>
      <div className="rounded-2xl border bg-background px-4 pt-4 sm:px-5 sm:pt-5">
        <StorageRentCta kitchenId={kitchenId} canBook listings={listings.data} onApply={() => navigate("/dashboard?view=discover-kitchens")} />
      </div>
    </section> : pickListing && !listings.data && !listings.error ? <div role="status" aria-label={t("stcLoading")}><Skeleton className="h-64 w-full rounded-2xl" /></div>
    : !valid || listings.error || (listings.data && !listing) ? <div role="alert" className="space-y-3 rounded-2xl border p-5">
      <p className="text-sm">{t("stcNoListing")}</p>
      <Button asChild variant="outline" className="min-h-11"><Link href="/storage">{t("stcBackToStorage")}</Link></Button>
    </div> : !listing ? <div role="status" aria-label={t("stcLoading")} className="space-y-3"><Skeleton className="h-20 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div> : <>
      <header className="space-y-1">
        {!approvalNeeded && !noStartInWindow && <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("stcStep", { step, label: t(step === 1 ? "stcStepDates" : "stcStepReview") })}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{listing.name}</h1>
        <p className="text-sm text-muted-foreground">{t("stcAtKitchenPrice", { kitchen, amount: cad(listing.dailyPriceCents, locale) })}</p>
      </header>
      {/* The space itself first, as listing request pages do: the kitchen's photo across the top of the card. */}
      <section className="overflow-hidden rounded-2xl border" aria-label={t("stcAboutListing")}>
        {listing.photos?.[0] && <SmartImage src={getR2ProxyUrl(listing.photos[0])} alt={listing.name} hideOnError className="aspect-[16/9] max-h-72 w-full object-cover" />}
        <div className="p-4 sm:p-5"><StorageListingDetails row={listing} showName={false} showPhoto={!listing.photos?.[0]} /></div>
      </section>

      {approvalNeeded ? <section className="space-y-3 rounded-2xl border p-5" data-testid="storage-apply-first">
        <h2 className="text-base font-semibold">{refusal ? t("stcBlockedTitle") : t("stcApplyTitle")}</h2>
        <p className="text-sm leading-relaxed">{refusal?.message || t("stcApplyBody", { kitchen })}</p>
        <p className="text-sm text-muted-foreground">{t("stcDiscNoAuto")} {t("stcDiscDays")}</p>
        <PublishedCancellationPolicySummary kitchenId={kitchenId} />
        {refusal ? (refusal.actionUrl && <Button className="min-h-12 w-full sm:w-auto" onClick={() => navigate(refusal.actionUrl!)}>{t("stcBlockedAction")}</Button>)
          : <Button className="min-h-12 w-full sm:w-auto" onClick={() => navigate(listing.locationId ? `/apply-kitchen/${listing.locationId}?kitchenId=${kitchenId}` : "/dashboard?view=discover-kitchens")}>{t("stcApply")}</Button>}
      </section> : noStartInWindow ? <section className="space-y-3 rounded-2xl border p-5" data-testid="storage-not-yet">
        <h2 className="text-base font-semibold">{t("stcNotYetTitle", { count: MAX_LEAD_DAYS })}</h2>
        <p className="text-sm leading-relaxed">{nextOpening ? t("stcNotYetFrom", { date: storageDay(nextOpening, locale), opens: storageDay(addDays(nextOpening, -MAX_LEAD_DAYS), locale) }) : t("stcNotYetFull")}</p>
        <Button asChild variant="outline" className="min-h-11"><Link href={`/storage/new?kitchenId=${kitchenId}`}>{t("stcOtherStorageHere")}</Link></Button>
      </section> : step === 1 ? <>
        <fieldset className="space-y-3 rounded-2xl border p-4 sm:p-5">
          <legend className="px-1 text-base font-semibold">{t("stcStartLabel")}</legend>
          <p className="text-sm text-muted-foreground">{t("stcStartHint")}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="group" aria-label={t("stcStartLabel")}>
            {startOptions.map(day => <Button key={day} type="button" variant="outline" aria-pressed={startOn === day} disabled={day < firstFree}
              className={cn("min-h-11 px-1 text-[13px]", startOn === day && "border-foreground bg-muted font-semibold")}
              onClick={() => { setStartOn(day); setPayError(null); setRequestKey(newRequestKey()) }}>{storageDay(day, locale)}</Button>)}
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-2xl border p-4 sm:p-5">
          <legend className="px-1 text-base font-semibold">{t("stcDaysLabel")}</legend>
          <div className="flex flex-wrap gap-2">
            {QUICK_DAYS.filter(n => n <= maxDays).map(n => <Button key={n} type="button" variant="outline" aria-pressed={days === n}
              className={cn("min-h-11 min-w-[5.5rem]", days === n && "border-foreground bg-muted font-semibold")} onClick={() => choose(n)}>{t("stcDays", { count: n })}</Button>)}
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={t("stcFewer")} disabled={days <= 1} onClick={() => choose(days - 1)}><Minus className="h-4 w-4" aria-hidden /></Button>
            <output className="min-w-[5rem] text-center text-base font-semibold tabular-nums" aria-live="polite">{t("stcDays", { count: days })}</output>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={t("stcMore")} disabled={days >= maxDays} onClick={() => choose(days + 1)}><Plus className="h-4 w-4" aria-hidden /></Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("stcDaysHint", { max: maxDays })}</p>
        </fieldset>
        <section className="space-y-3 rounded-2xl border p-4 sm:p-5" aria-live="polite">
          {startOn && <p className="text-[15px] font-medium">{storageDay(startOn, locale)} – {storageDay(addDays(startOn, days - 1), locale, true)}</p>}
          {quote.error?.code === "full" ? <div role="alert" className="space-y-3">
              {/* Full for the whole span: say what does fit from this start, or to pick a later one. */}
              <p className="text-sm">{quote.error.fitsDays ? t("stcFitsDays", { count: quote.error.fitsDays, end: storageDay(addDays(startOn!, quote.error.fitsDays - 1), locale) }) : t("stcFullFromStart")}</p>
              {!!quote.error.fitsDays && <Button type="button" variant="outline" className="min-h-11" onClick={() => choose(quote.error!.fitsDays!)}>{t("stcUseFitsDays", { count: quote.error.fitsDays })}</Button>}
            </div>
            : quote.error ? <p role="alert" className="text-sm">{quote.error.message}</p> : q ? summary : <p role="status" className="text-sm text-muted-foreground">{t("stcQuoting")}</p>}
        </section>
        <div className="sticky bottom-0 -mx-1 bg-background/95 px-1 py-3 backdrop-blur sm:static sm:p-0">
          <Button className="min-h-12 w-full text-base sm:w-auto sm:min-w-[12rem]" disabled={!q} onClick={() => { setStep(2); window.scrollTo?.({ top: 0 }) }}>{t("stcContinue")}</Button>
        </div>
      </> : <>
        <section className="space-y-3 rounded-2xl border p-4 sm:p-5">
          <h2 className="text-base font-semibold">{t("stcYourRequest")}</h2>
          {q ? <><p className="text-[15px] font-medium">{storageDay(q.startOn, locale)} – {storageDay(q.endOn, locale, true)} · {t("stcDays", { count: q.days })}</p>{summary}</>
            : quote.error ? <p role="alert" className="text-sm">{quote.error.message}</p> : <p role="status" className="text-sm text-muted-foreground">{t("stcQuoting")}</p>}
          <button type="button" className="min-h-11 text-sm font-medium underline underline-offset-2" onClick={() => setStep(1)}>{t("stcChangeDates")}</button>
        </section>
        <section className="space-y-2 rounded-2xl border p-4 sm:p-5" aria-labelledby="storage-how" data-testid="storage-disclosure">
          <h2 id="storage-how" className="text-base font-semibold">{t("stcDisclosureTitle")}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>{t("stcDiscNoAuto")}</li>
            <li>{t("stcDiscHold", { kitchen })}</li>
            <li>{t("stcDiscDays")}</li>
            {q && <li>{t("stcDiscExtend", { end: storageDay(q.endOn, locale), kitchen, daily: cad(q.dailyPriceCents, locale) })}</li>}
            <li>{t("stcDiscEarly")}</li>
            <li>{t("stcDiscCancel", { kitchen })}</li>
            <li>{t("stcDiscCardSaved")}</li>
          </ul>
          {/* The full rules (extra days, removal, damage, take-back, own risk) live on the policies page, as top platforms do. */}
          <a href="/terms#storage-and-equipment" target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium underline underline-offset-4">{t("stcPoliciesLink")}</a>
        </section>
        <CheckoutCancellationDisclosure policy={policy.data} startAt={startOn ? localDayStart(startOn, timezone).toISOString() : undefined}
          detailsOpen={policyOpen} onDetailsOpenChange={setPolicyOpen} detailsId="storage-cancellation-details" storage />
        {payError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{payError}</p>}
        <div className="space-y-3">
          <div className="grid grid-cols-[auto,1fr] gap-2 sm:flex">
            <Button variant="outline" className="min-h-12" onClick={() => setStep(1)}>{t("stcBack")}</Button>
            <Button className="min-h-12 text-base" disabled={!q || paying} onClick={() => void pay()}>{paying ? t("stcRedirecting") : payLabel}</Button>
          </div>
          <CheckoutConsentNotice buttonLabel={payLabel} onShowPolicy={() => setPolicyOpen(true)} />
        </div>
      </>}
    </>}
  </StoragePageShell>
}
