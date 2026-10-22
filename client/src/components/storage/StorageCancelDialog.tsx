/**
 * Chef cancels an approved storage rental before its start (policy §5b), in the booking cancel dialog's shape:
 * what comes back first, the deductions one tap away, an optional reason, then the server's own refund.
 */
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { newRequestKey } from "@/lib/session-extensions"
import { cad, cancelRental, kitchenMoment, previewCancellation, rentalTimezone, storageDay, type StorageRental } from "@/lib/storage-rentals"

export function StorageCancelDialog({ rental, open, onOpenChange, onCancelled }: { rental: StorageRental; open: boolean
  onOpenChange: (open: boolean) => void; onCancelled: (next: StorageRental) => void }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as (key: string, options?: Record<string, unknown>) => string
  const { t: chefT } = useTranslation("chef")
  const { t: policyT } = useTranslation("booking")
  const locale = i18n.language
  const money = (cents: number) => cad(cents, locale)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [operationKey, setOperationKey] = useState(newRequestKey)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<{ refundCents: number; pending: boolean } | null>(null)
  // One key per opening: a retry after a lost response resumes the same cancellation, never a second refund.
  useEffect(() => { if (open) { setOperationKey(newRequestKey()); setReason(""); setError(""); setDone(null) } }, [open])
  const quote = useQuery({ queryKey: ["/api/chef/storage-rentals", rental.id, "cancel-preview"], queryFn: () => previewCancellation(rental.id),
    enabled: open && !done, staleTime: 0, gcTime: 0, retry: false })
  const q = quote.data
  const late = !!q && Date.now() >= Date.parse(q.freeUntil)
  const deadline = q ? kitchenMoment(q.freeUntil, q.timezone || rentalTimezone(rental), locale) : ""
  const kitchen = rental.kitchen.name
  const breakdown = q ? [{ key: "paid", label: policyT("cpPaidLine"), cents: q.paidCents },
    ...(q.alreadyRefundedCents ? [{ key: "already", label: policyT("cpAlreadyRefundedLine"), cents: -q.alreadyRefundedCents }] : []),
    ...(q.lateChargeCents ? [{ key: "kept", label: policyT("cpPolicyKeptLine"), cents: -q.lateChargeCents }] : []),
    ...(q.cardFeeCents ? [{ key: "fee", label: policyT("cpFeeLine"), cents: -q.cardFeeCents }] : []),
    { key: "refund", label: policyT("cpRefundLine"), cents: q.refundCents, total: true }] : []

  async function submit() {
    if (!q) return
    setBusy(true); setError("")
    try {
      const next = await cancelRental(rental.id, { operationKey, reason: reason.trim() || undefined, expectedRefundCents: q.refundCents })
      setDone({ refundCents: next.cancellation?.refundCents ?? q.refundCents, pending: !!next.refundPending })
      onCancelled(next)
    } catch (caught) {
      setError((caught as Error).message)
      // A changed refund shows the fresh amount before the chef tries again.
      if ((caught as { code?: string }).code === "refund_changed") void quote.refetch()
    } finally { setBusy(false) }
  }

  const description = !done ? policyT("cpReviewBeforeCancel") : done.pending ? t("stcCancelRefundPending", { refund: money(done.refundCents) })
    : done.refundCents ? `${t("stcCancelDone")} ${policyT("cpRefundOnWay", { refund: money(done.refundCents) })}` : t("stcCancelNoRefundDone")
  const first = rental.terms[0]
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus() }}>
      <DialogHeader className="shrink-0 border-b px-5 py-5 text-left sm:px-6">
        <DialogTitle ref={titleRef} tabIndex={-1} className="text-xl outline-none">{done ? t("stcCancelledTitle") : t("stcCancel")}</DialogTitle>
        <DialogDescription className="pt-1" data-testid="storage-cancel-outcome">{description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <section className="rounded-xl border p-4" data-testid="storage-cancel-summary">
          {rental.ref && <p className="text-xs text-muted-foreground">{rental.ref}</p>}
          <p className="mt-1 font-semibold">{rental.listing.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("stcKitchenUnit", { kitchen, unit: rental.unitLabel })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{storageDay(rental.startOn, locale, true)} – {storageDay(rental.paidThrough, locale, true)}</p>
          {first && <p className="mt-3 flex justify-between gap-3 border-t pt-3 text-sm"><span className="text-muted-foreground">{t("stcCancelPaid")}</span>
            <span className="font-medium tabular-nums">{money(rental.terms.reduce((sum, term) => sum + (term.status === "paid" ? term.totalCents : 0), 0))}</span></p>}
        </section>
        {!done && <section className="space-y-3">
          <h3 className="text-sm font-medium">{chefT("cancelCopy15")}</h3>
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm" aria-live="polite">
            {q ? <>
              {q.refundCents ? <p className="text-lg font-semibold" data-testid="storage-cancel-refund">{policyT("cpRefundHeadline", { refund: money(q.refundCents) })}</p>
                : <p>{t("stcCancelNoRefund", { kitchen })}</p>}
              <p className="text-muted-foreground">{late ? t("stcCancelLate", { deadline, percent: q.lateChargePercent, kitchen })
                : t(q.lateChargePercent ? "stcCancelFreeUntilCharge" : "stcCancelFreeUntil", { deadline, percent: q.lateChargePercent, kitchen })}</p>
              <details className="group" data-testid="storage-cancel-breakdown">
                <summary className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline">{policyT("cpSeeBreakdown")}</summary>
                <dl className="mt-2 space-y-1">
                  {breakdown.map(line => <div key={line.key} className={"flex justify-between gap-3" + ("total" in line ? " border-t pt-1 font-medium" : "")}>
                    <dt>{line.label}</dt><dd className="tabular-nums">{line.cents < 0 ? "−" : ""}{money(Math.abs(line.cents))}</dd></div>)}
                </dl>
              </details>
            </> : quote.error ? <p role="alert" className="text-destructive">{quote.error.message}</p>
              : <Loader2 className="h-4 w-4 animate-spin" aria-label={t("stcLoading")} />}
          </div>
        </section>}
        {!done && <div className="space-y-2">
          <label htmlFor={`storage-cancel-reason-${rental.id}`} className="text-sm font-medium">{chefT("cancelReason")} <span className="font-normal text-muted-foreground">{chefT("cancelCopy33")}</span></label>
          <Textarea id={`storage-cancel-reason-${rental.id}`} className="min-h-20 resize-none" placeholder={chefT("cancelCopy34")} value={reason} maxLength={500} disabled={busy}
            onChange={event => setReason(event.target.value)} />
        </div>}
        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 rounded-b-2xl border-t bg-background px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{done ? chefT("cancelCopy36") : t("stcCancelKeep")}</Button>
        {!done && <Button className="min-h-11" disabled={!q || busy} onClick={() => void submit()}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("stcCancelling")}</> : t("stcCancel")}</Button>}
      </div>
    </DialogContent>
  </Dialog>
}
