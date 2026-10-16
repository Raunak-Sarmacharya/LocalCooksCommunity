/**
 * Extend storage (WP-ST5 contract): one-tap lengths 7/14/30 clipped to what the server allows, plus a stepper for any
 * other length; the new end date and total are always on screen. Pays on-session only — never an automatic charge.
 */
import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { newRequestKey } from "@/lib/session-extensions"
import { cad, payExtension, quoteExtension, storageDay, type StorageRental } from "@/lib/storage-rentals"
import { cn } from "@/lib/utils"

const QUICK_DAYS = [7, 14, 30] as const
const brandName = (brand: string) => brand === "amex" ? "Amex" : brand.charAt(0).toUpperCase() + brand.slice(1)

export function StorageExtendSheet({ rental, open, onOpenChange, onExtended }: {
  rental: StorageRental; open: boolean; onOpenChange: (open: boolean) => void; onExtended: (rental?: StorageRental) => void
}) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as (key: string, options?: Record<string, unknown>) => string
  const locale = i18n.language
  const [days, setDays] = useState<number | null>(null)
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [paying, setPaying] = useState<"saved" | "other" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Before a length is chosen, a 1-day quote tells us how many days are allowed and which card is saved.
  const quote = useQuery({ queryKey: ["storage-extend-quote", rental.id, days ?? 1], queryFn: () => quoteExtension(rental.id, days ?? 1),
    enabled: open, placeholderData: keepPreviousData, staleTime: 0 })
  const maxDays = quote.data?.maxDays ?? 0
  useEffect(() => { if (days === null && quote.data && quote.data.maxDays > 0) setDays(Math.min(7, quote.data.maxDays)) }, [days, quote.data])
  useEffect(() => { if (!open) { setDays(null); setMessage(null); setPaying(null) } }, [open])
  const choose = (next: number) => { setDays(Math.max(1, Math.min(maxDays, next))); setRequestKey(newRequestKey()); setMessage(null) }
  const ready = !!quote.data && days !== null && quote.data.days === days && !quote.isFetching

  const pay = async (useSavedCard: boolean) => {
    if (!ready || !quote.data || paying) return
    setPaying(useSavedCard ? "saved" : "other"); setMessage(null)
    try {
      const result = await payExtension(rental.id, { days: days!, expectedTotalCents: quote.data.totalCents, requestKey, useSavedCard })
      if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); return }
      if (result.cardFailed) { setMessage(t("stcCardFailed")); setRequestKey(newRequestKey()); return }
      if (result.paid) { onExtended(result.rental); onOpenChange(false); return }
      setMessage(t("stcPaymentChecking"))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("stcCardFailed"))
    } finally { setPaying(null) }
  }

  const q = quote.data
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
      <SheetHeader className="text-left">
        <SheetTitle>{t("stcExtendTitle")}</SheetTitle>
        <SheetDescription>{t("stcExtendDesc", { daily: cad(rental.rentalTerms?.dailyPriceCents ?? q?.dailyPriceCents ?? 0, locale), end: storageDay(rental.paidThrough, locale) })}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-5">
        {quote.error && !q ? <p role="alert" className="text-sm">{quote.error.message} <button type="button" className="underline" onClick={() => void quote.refetch()}>{t("stcRetry")}</button></p>
          : !q ? <p role="status" className="text-sm text-muted-foreground">{t("stcQuoting")}</p>
          : maxDays < 1 ? <p className="rounded-xl bg-muted p-3 text-sm" data-testid="extend-limit">{t(`stcLimit_${q.limitReason}`, { kitchen: rental.kitchen.name })}</p>
          : <>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("stcExtendDaysLabel")}</legend>
              <div className="flex flex-wrap gap-2">
                {QUICK_DAYS.filter(n => n <= maxDays).map(n => <Button key={n} type="button" variant="outline" aria-pressed={days === n}
                  className={cn("min-h-11 min-w-[5.5rem]", days === n && "border-foreground bg-muted font-semibold")} onClick={() => choose(n)}>{t("stcDays", { count: n })}</Button>)}
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={t("stcFewer")} disabled={!days || days <= 1} onClick={() => choose((days ?? 1) - 1)}><Minus className="h-4 w-4" aria-hidden /></Button>
                <output className="min-w-[5rem] text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="extend-days">{days ? t("stcDays", { count: days }) : ""}</output>
                <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={t("stcMore")} disabled={!days || days >= maxDays} onClick={() => choose((days ?? 0) + 1)}><Plus className="h-4 w-4" aria-hidden /></Button>
              </div>
              {maxDays < 30 && <p className="text-xs text-muted-foreground">{t("stcLimitUpTo", { count: maxDays })}</p>}
            </fieldset>
            <p className="rounded-xl border p-3 text-[15px] font-medium" aria-live="polite" data-testid="extend-summary">
              {ready ? t("stcNewEnd", { date: storageDay(q.newPaidThrough, locale, true), amount: cad(q.totalCents, locale) }) : t("stcQuoting")}
            </p>
            {message && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{message}</p>}
            <div className="space-y-2">
              {q.card && <Button type="button" className="min-h-12 w-full text-base" disabled={!ready || !!paying} onClick={() => void pay(true)}>
                {paying === "saved" ? t("stcPaying") : t("stcPaySaved", { amount: cad(q.totalCents, locale), brand: brandName(q.card.brand), last4: q.card.last4 })}</Button>}
              <Button type="button" variant={q.card ? "outline" : "default"} className="min-h-12 w-full" disabled={!ready || !!paying} onClick={() => void pay(false)}>
                {paying === "other" ? t("stcPaying") : q.card ? t("stcPayOther") : t("stcPayCard", { amount: cad(q.totalCents, locale) })}</Button>
              <p className="text-xs leading-relaxed text-muted-foreground">{t("stcExtendFinePrint")}</p>
            </div>
          </>}
      </div>
    </SheetContent>
  </Sheet>
}
