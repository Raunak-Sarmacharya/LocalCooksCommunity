import { useState } from "react"
import { useChefSidebarHiddenItems } from "@/hooks/use-chef-sidebar-hidden-items"
import { ChefSectionTabs } from "@/components/chef/ChefSectionTabs"
/** "My storage" (WP-ST10): one card per rental: the unit, its kitchen, one plain status sentence, at most one action. */
import { Link, useLocation } from "wouter"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StoragePageShell } from "@/components/storage/StoragePageShell"
import { PendingOverstayPenalties } from "@/components/chef/PendingOverstayPenalties"
import { useChefKitchenApplications } from "@/hooks/use-chef-kitchen-applications"
import { CURRENT_STATES, TONE_CLASS, can, listRentals, rentalStatus, type StorageRental } from "@/lib/storage-rentals"
import { cn } from "@/lib/utils"

export const STORAGE_LIST_KEY = ["/api/chef/storage-rentals"] as const

export function RentalCard({ rental }: { rental: StorageRental }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as (key: string, options?: Record<string, unknown>) => string
  const status = rentalStatus(rental, t, i18n.language)
  const urgent = rental.state !== "removal_review" && !(rental.moveOutBy && rental.moveOutBy < rental.paidThrough) && can(rental, "extend") && (rental.phase === "grace" || rental.phase === "holdover" || rental.phase === "ending_soon")
  const photo = rental.listing.photos?.[0]
  const [photoFailed, setPhotoFailed] = useState(false)
  // The whole card opens the rental (the title link covers it); only an urgent Extend sits on top.
  return <article className="relative rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/30 sm:p-5" data-testid={`storage-card-${rental.id}`}>
    <div className="flex items-start gap-3 sm:gap-4">
      {photo && !photoFailed ? <img src={photo} alt="" onError={() => setPhotoFailed(true)} className="size-14 shrink-0 rounded-lg bg-muted object-cover sm:size-16" /> : <div className="size-14 shrink-0 rounded-lg bg-muted sm:size-16" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 line-clamp-2 text-[15px] font-semibold"><Link className="after:absolute after:inset-0 after:rounded-2xl focus-visible:underline" href={`/storage/${rental.id}`}>{t("stcListingUnit", { listing: rental.listing.name, unit: rental.unitLabel })}</Link></h3>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", TONE_CLASS[status.tone])}>{status.pill}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{rental.kitchen.name}</p>
        <p className="mt-2 text-sm leading-relaxed">{status.sentence}</p>
        {urgent && <Button asChild className="relative z-10 mt-3 min-h-11 w-full sm:w-auto"><Link href={`/storage/${rental.id}?extend=1`}>{t("stcExtend")}</Link></Button>}
      </div>
    </div>
  </article>
}

export default function ChefStoragePage() {
  const [, goTo] = useLocation()
  const shellHidden = useChefSidebarHiddenItems()
  const { t: tt } = useTranslation("storage")
  const t = tt as unknown as (key: string, options?: Record<string, unknown>) => string
  // Back from Stripe: the request lands with the webhook, a moment later — keep looking briefly.
  const [returned] = useState(() => new URLSearchParams(window.location.search).has("session_id"))
  const query = useQuery({ queryKey: STORAGE_LIST_KEY, queryFn: listRentals,
    refetchInterval: q => returned && (q.state.dataUpdateCount ?? 0) < 10 ? 3000 : false })
  const { applications } = useChefKitchenApplications()
  const rentals = query.data ?? []
  const current = rentals.filter(rental => CURRENT_STATES.includes(rental.state)).reverse()
  const past = rentals.filter(rental => !CURRENT_STATES.includes(rental.state)).reverse()
  const approved = applications.filter(app => app.status === "approved" && app.location)

  return <StoragePageShell>
    <ChefSectionTabs activeView="storage" hiddenItems={shellHidden} onSelect={view => view !== "storage" && goTo(view === "overview" ? "/dashboard" : `/dashboard?view=${view}`)} />
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t("stcTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("stcIntro")}</p>
    </header>
    {returned && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{t("stcReturned")}</p>}
    <PendingOverstayPenalties title={t("stcHoldoverTitle")} />
    {query.isPending ? <div className="space-y-3" role="status" aria-label={t("stcLoading")}>
      {[0, 1].map(index => <Skeleton key={index} className="h-[148px] w-full rounded-2xl" />)}
    </div> : query.error ? <div role="alert" className="space-y-3 rounded-2xl border p-5">
      <p className="text-sm">{t("stcLoadError")}</p>
      <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t("stcRetry")}</Button>
    </div> : !rentals.length ? <section className="space-y-4 rounded-2xl border border-dashed p-5">
      <p className="text-[15px] font-medium">{t("stcEmpty")}</p>
      <p className="text-sm text-muted-foreground">{t("stcEmptyHint")}</p>
      {approved.length > 0 && <ul className="space-y-2">
        {approved.map(app => <li key={app.id}><Button asChild variant="outline" className="min-h-11 w-full justify-between sm:w-auto">
          <Link href={`/kitchen-preview/${app.location!.id}`}>{t("stcSeeStorageAt", { kitchen: app.location!.name })}</Link></Button></li>)}
      </ul>}
      <Button asChild className="min-h-11 w-full sm:w-auto"><Link href="/dashboard?view=discover-kitchens">{t("stcFindKitchen")}</Link></Button>
    </section> : <>
      {current.length > 0 && <section className="space-y-3" aria-labelledby="storage-current"><h2 id="storage-current" className="text-base font-semibold">{t("stcCurrent")}</h2>
        <ul className="space-y-3">{current.map(rental => <li key={rental.id}><RentalCard rental={rental} /></li>)}</ul></section>}
      {past.length > 0 && <section className="space-y-3" aria-labelledby="storage-past"><h2 id="storage-past" className="text-base font-semibold">{t("stcPast")}</h2>
        <ul className="space-y-3">{past.map(rental => <li key={rental.id}><RentalCard rental={rental} /></li>)}</ul></section>}
      <p><Link className="text-sm underline underline-offset-2" href="/dashboard?view=discover-kitchens">{t("stcRentMore")}</Link></p>
    </>}
  </StoragePageShell>
}
