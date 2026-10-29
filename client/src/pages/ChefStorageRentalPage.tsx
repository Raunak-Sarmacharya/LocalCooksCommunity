/**
 * One storage rental (WP-ST10): status, dates, money and only the actions the server lists in `actions[]`.
 * Move in/out reuse the storage photo dialogs; problems use the shared report panel; extending opens the Extend sheet.
 */
import { useState } from "react"
import { Link, useRoute } from "wouter"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { StoragePageShell } from "@/components/storage/StoragePageShell"
import { StorageExtendSheet } from "@/components/storage/StorageExtendSheet"
import { StorageCancelDialog } from "@/components/storage/StorageCancelDialog"
import { StorageMessageButton } from "@/components/storage/StorageMessageButton"
import { StorageCheckinDialog } from "@/components/booking/StorageCheckinDialog"
import { StorageVisitRecord } from "@/components/storage/StorageVisitRecord"
import { formatStorageDate } from "@/lib/storage-board"
import { StorageCheckoutDialog } from "@/components/booking/StorageCheckoutDialog"
import { CommitmentProblems } from "@/components/support/CommitmentProblems"
import { PendingOverstayPenalties } from "@/components/chef/PendingOverstayPenalties"
import { StorageDamageClaims } from "@/components/booking/DamageClaimCards"
import { STORAGE_LIST_KEY } from "@/pages/ChefStoragePage"
import { TONE_CLASS, cad, can, readRental, rentalStatus, rentalTimezone, storageDay, withdrawRental, type StorageRental } from "@/lib/storage-rentals"
import { localDayStart, localToday } from "@shared/storage-rental"
import { cancellationDeadlineLabel } from "@/components/booking/CancellationPolicySummary"
import { cn } from "@/lib/utils"

export default function ChefStorageRentalPage() {
  const [, params] = useRoute("/storage/:id")
  const id = Number(params?.id)
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as (key: string, options?: Record<string, unknown>) => string
  const locale = i18n.language
  const queryClient = useQueryClient()
  const key = ["/api/chef/storage-rentals", id]
  const query = useQuery({ queryKey: key, queryFn: () => readRental(id), enabled: Number.isSafeInteger(id) && id > 0 })
  const [extendOpen, setExtendOpen] = useState(() => new URLSearchParams(window.location.search).get("extend") === "1")
  const [dialog, setDialog] = useState<"move_in" | "move_out" | "withdraw" | "cancel" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = (next?: StorageRental) => {
    if (next) queryClient.setQueryData(key, next)
    void queryClient.invalidateQueries({ queryKey: STORAGE_LIST_KEY })
  }
  const withdraw = useMutation({ mutationFn: () => withdrawRental(id), onSuccess: next => { refresh(next); setDialog(null); setNotice(t("stcWithdrawDone")) } })
  const rental = query.data
  const status = rental && rentalStatus(rental, t, locale)
  const takenBack = !!rental?.moveOutBy && rental.moveOutBy < rental.paidThrough
  // A cancellation shows its own refund line; otherwise one line for what went back to the card.
  const refundedCents = rental && !rental.cancellation ? rental.terms.reduce((sum, term) => sum + (term.refundedCents ?? 0), 0) : 0

  return <StoragePageShell crumb={rental ? rental.listing.name : t("stcDetail")}>
    {query.isPending ? <div className="space-y-3" role="status" aria-label={t("stcLoading")}><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-48 w-full rounded-2xl" /></div>
      : query.error || !rental || !status ? <div role="alert" className="space-y-3 rounded-2xl border p-5">
        <p className="text-sm">{query.error?.message || t("stcNotFound")}</p>
        <Button asChild variant="outline" className="min-h-11"><Link href="/storage">{t("stcBackToStorage")}</Link></Button>
      </div> : <>
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", TONE_CLASS[status.tone])}>{status.pill}</span>
            {rental.ref && <span className="text-xs text-muted-foreground">{t("stcRef", { ref: rental.ref })}</span>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{rental.listing.name}</h1>
          <p className="text-sm text-muted-foreground">{t("stcKitchenUnit", { kitchen: rental.kitchen.name, unit: rental.unitLabel })}</p>
          <p className="text-[15px] leading-relaxed" data-testid="rental-status">{status.sentence}</p>
        </header>
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="rental-actions">
          {["requested", "reserved", "active", "move_out_requested", "removal_review", "ended"].includes(rental.state) && <StorageMessageButton rentalId={rental.id} />}
          {can(rental, "extend") && <Button className="min-h-12 sm:min-h-11" onClick={() => setExtendOpen(true)}>{t("stcExtend")}</Button>}
          {can(rental, "move_in") && <Button variant={can(rental, "extend") ? "outline" : "default"} className="min-h-12 sm:min-h-11" onClick={() => setDialog("move_in")}>{t("stcMoveIn")}</Button>}
          {can(rental, "move_out") && <Button variant="outline" className="min-h-12 sm:min-h-11" onClick={() => setDialog("move_out")}>{t("stcMoveOut")}</Button>}
          {can(rental, "withdraw") && <Button variant="outline" className="min-h-12 sm:min-h-11" onClick={() => setDialog("withdraw")}>{t("stcWithdraw")}</Button>}
          {can(rental, "cancel") && <Button variant="outline" className="min-h-12 sm:min-h-11" onClick={() => setDialog("cancel")}>{t("stcCancel")}</Button>}
        </div>

        <section className="rounded-2xl border p-4 sm:p-5" aria-labelledby="rental-dates">
          <h2 id="rental-dates" className="mb-3 text-base font-semibold">{t("stcDates")}</h2>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("stcStarts")}</dt><dd>{storageDay(rental.startOn, locale, true)}</dd>
            <dt className="text-muted-foreground">{t("stcPaidThroughLabel")}</dt><dd>{storageDay(rental.paidThrough, locale, true)}</dd>
            {takenBack ? <><dt className="text-muted-foreground">{t("stcNeededBackBy")}</dt><dd>{storageDay(rental.moveOutBy!, locale, true)}</dd></>
              : ["reserved", "active"].includes(rental.state) && <><dt className="text-muted-foreground">{t("stcExtendBy")}</dt><dd>{storageDay(rental.graceEndsOn, locale, true)}</dd></>}
            {rental.rentalTerms && <><dt className="text-muted-foreground">{t("stcDailyPrice")}</dt><dd>{t("stcPerDay", { amount: cad(rental.rentalTerms.dailyPriceCents, locale) })}</dd></>}
          </dl>
          {["reserved", "active"].includes(rental.state) && !takenBack && !["grace", "holdover"].includes(rental.phase ?? "") && rental.rentalTerms && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t("stcDiscExtend", { end: storageDay(rental.paidThrough, locale), kitchen: rental.kitchen.name, daily: cad(rental.rentalTerms.dailyPriceCents, locale) })}</p>}
          {rental.declineReason && <p className="mt-3 text-sm">{t("stcDeclineReason", { reason: rental.declineReason })}</p>}
        </section>

        {/* The chef sees what they recorded at each end, the same record the kitchen reads (owner Oct 29). */}
        {rental.timeline?.movedInAt && rental.evidence && <section className="rounded-2xl border p-4 sm:p-5" aria-labelledby="rental-record">
          <h2 id="rental-record" className="mb-3 text-base font-semibold">{tt("stYourRecord")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <StorageVisitRecord title={tt("stEvidenceMoveIn")} at={formatStorageDate(rental.timeline.movedInAt, locale, rentalTimezone(rental))}
              record={rental.evidence.moveIn} photos={rental.evidence.checkinPhotoUrls ?? []} />
            {rental.timeline.movingOutAt && <StorageVisitRecord title={tt("stEvidenceMoveOut")} at={formatStorageDate(rental.timeline.movingOutAt, locale, rentalTimezone(rental))}
              record={rental.evidence.moveOut} photos={rental.evidence.checkoutPhotoUrls ?? []} />}
          </div>
        </section>}

        {/* Like a session booking's Policies card: the lines that still apply, then the full rules. */}
        {["requested", "reserved", "active", "move_out_requested"].includes(rental.state) && <section className="rounded-2xl border p-4 sm:p-5" aria-labelledby="rental-policies" data-testid="rental-policies">
          <h2 id="rental-policies" className="mb-2 text-base font-semibold">{t("stcPoliciesTitle")}</h2>
          <ul className="space-y-1.5 text-sm leading-relaxed">
            {rental.state === "reserved" && rental.startOn > localToday(new Date(), rentalTimezone(rental)) && rental.rentalTerms?.cancellationPolicySnapshot?.noticeHours != null
              && <li>{t("stcCancelBy", { deadline: cancellationDeadlineLabel(localDayStart(rental.startOn, rentalTimezone(rental)).toISOString(), rental.rentalTerms.cancellationPolicySnapshot.noticeHours, rentalTimezone(rental), locale) })}</li>}
            <li>{t("stcDiscEarly")}</li>
          </ul>
          <a href="/terms#storage-and-equipment" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-medium underline underline-offset-4">{t("stcPoliciesLink")}</a>
        </section>}

        {rental.phase === "holdover" && <PendingOverstayPenalties title={t("stcHoldoverTitle")} />}

        <section className="rounded-2xl border p-4 sm:p-5" aria-labelledby="rental-money">
          <h2 id="rental-money" className="mb-3 text-base font-semibold">{t("stcMoneyTitle")}</h2>
          <ul className="divide-y">
            {rental.terms.map(term => <li key={term.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{t(term.kind === "first" ? "stcTermFirst" : "stcTermExtension")} · {t("stcDays", { count: term.days })}</p>
                <p className="text-muted-foreground">{storageDay(term.startsOn, locale)} – {storageDay(term.endsOn, locale)} · {t(`stcTermStatus_${term.status}`, { defaultValue: term.status })}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-medium tabular-nums">{cad(term.totalCents, locale)}</p>
                <p className="text-xs text-muted-foreground">{t("stcTermBreakdown", { days: cad(term.subtotalCents, locale), tax: cad(term.taxCents, locale), fee: cad(term.serviceFeeCents, locale) })}</p>
              </div>
            </li>)}
            {rental.cancellation && rental.cancellation.refundCents > 0 && <li className="flex items-start justify-between gap-3 py-2.5 text-sm" data-testid="rental-refund">
              <div className="min-w-0">
                <p className="font-medium">{t("stcRefundLine")}</p>
                <p className="text-muted-foreground">{t("stcRefundLineDate", { date: storageDay(localToday(new Date(rental.cancellation.cancelledAt), rentalTimezone(rental)), locale) })}</p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">−{cad(rental.cancellation.refundCents, locale)}</p>
            </li>}
            {refundedCents > 0 && <li className="flex items-start justify-between gap-3 py-2.5 text-sm" data-testid="rental-refunded">
              <div className="min-w-0">
                <p className="font-medium">{t("stcRefundLine")}</p>
                <p className="text-muted-foreground">{t(takenBack ? "stcRefundTakenBack" : "stcRefundToCard", { kitchen: rental.kitchen.name })}</p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">−{cad(refundedCents, locale)}</p>
            </li>}
          </ul>
        </section>

        <StorageDamageClaims storageRentalId={rental.id} heading={t("stcClaimsTitle")} />

        {can(rental, "report_problem") && <CommitmentProblems kind="storage" id={rental.id} canReport />}
        <p><Link className="text-sm underline underline-offset-2" href="/storage">{t("stcBackToStorage")}</Link></p>

        <StorageExtendSheet rental={rental} open={extendOpen && can(rental, "extend")} onOpenChange={setExtendOpen}
          onExtended={next => { refresh(next); void query.refetch(); setNotice(t("stcExtended", { date: storageDay((next ?? rental).paidThrough, locale, true) })) }} />
        {can(rental, "move_in") && <StorageCheckinDialog open={dialog === "move_in"} onOpenChange={open => setDialog(open ? "move_in" : null)}
          storageBooking={{ id: rental.id, storageName: rental.listing.name, startDate: rental.startOn }} onSuccess={() => void query.refetch()} />}
        {can(rental, "move_out") && <StorageCheckoutDialog open={dialog === "move_out"} onOpenChange={open => setDialog(open ? "move_out" : null)}
          storageBooking={{ id: rental.id, storageName: rental.listing.name, endDate: rental.paidThrough }} onSuccess={() => void query.refetch()} />}
        {dialog === "cancel" && <StorageCancelDialog rental={rental} open onOpenChange={open => setDialog(open ? "cancel" : null)} onCancelled={next => refresh(next)} />}
        <AlertDialog open={dialog === "withdraw"} onOpenChange={open => setDialog(open ? "withdraw" : null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("stcWithdrawTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("stcWithdrawBody", { amount: cad(rental.terms[0]?.totalCents ?? 0, locale) })}</AlertDialogDescription>
            </AlertDialogHeader>
            {withdraw.error && <p role="alert" className="text-sm text-red-800">{withdraw.error.message}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">{t("stcKeepRequest")}</AlertDialogCancel>
              <AlertDialogAction className="min-h-11" disabled={withdraw.isPending} onClick={event => { event.preventDefault(); withdraw.mutate() }}>
                {withdraw.isPending ? t("stcWithdrawing") : t("stcWithdraw")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>}
  </StoragePageShell>
}
