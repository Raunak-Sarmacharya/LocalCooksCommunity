/** Storage entry points outside "My storage": the kitchen page's Storage section and the prompt after a session booking. */
import { Link } from "wouter"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { PublishedCancellationPolicySummary } from "@/components/booking/CancellationPolicySummary"
import { cad, storageAvailability, storageDay, type StorageAvailability } from "@/lib/storage-rentals"

type T = (key: string, options?: Record<string, unknown>) => string
const rentHref = (kitchenId: number, row: StorageAvailability) => `/storage/new?kitchenId=${kitchenId}&listingId=${row.listingId}`
function availabilityText(row: StorageAvailability, t: T, locale: string) {
  if (row.availability.state === "now") return t("stcAvailNow")
  if (row.availability.state === "from" && row.availability.from) return t("stcAvailFrom", { date: storageDay(row.availability.from, locale) })
  return t("stcAvailFull")
}

/**
 * Approved chefs get "Rent storage" per listing with its availability; everyone else sees the same rules and
 * "Apply to this kitchen first", which goes into the existing application flow.
 */
export function StorageRentCta({ kitchenId, canBook, onApply }: { kitchenId: number; canBook: boolean; onApply: () => void }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as T
  const rows = useQuery({ queryKey: ["storage-availability", kitchenId], queryFn: () => storageAvailability(kitchenId), enabled: canBook })
  if (!canBook) return <div className="mt-3 space-y-2 border-t border-gray-100 pt-3" data-testid="storage-apply-first">
    <p className="text-sm leading-relaxed text-gray-700">{t("stcKitchenApplyHint")}</p>
    <PublishedCancellationPolicySummary kitchenId={kitchenId} />
    <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onApply}>{t("stcApply")}</Button>
  </div>
  if (!rows.data?.length) return null
  return <div className="mt-3 space-y-2 border-t border-gray-100 pt-3" data-testid="storage-rent">
    <p className="text-xs text-gray-600">{t("stcKitchenRentHint")}</p>
    <ul className="space-y-2">
      {rows.data.map(row => <li key={row.listingId} className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium text-gray-900">{row.name}</p>
          <p className="text-gray-600">{t("stcPerDay", { amount: cad(row.dailyPriceCents, i18n.language) })} · {availabilityText(row, t, i18n.language)}</p>
        </div>
        {row.availability.state === "full" ? null
          : <Button asChild size="sm" className="min-h-11 shrink-0"><Link href={rentHref(kitchenId, row)} aria-label={t("stcRentNamed", { listing: row.name })}>{t("stcRent")}</Link></Button>}
      </li>)}
    </ul>
  </div>
}

/** After a session booking: "Need storage too?" when the kitchen has a unit free, with the lowest daily price. */
export function StorageAddPrompt({ kitchenId }: { kitchenId: number }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as T
  const rows = useQuery({ queryKey: ["storage-availability", kitchenId], queryFn: () => storageAvailability(kitchenId), retry: false })
  const open = (rows.data ?? []).filter(row => row.availability.state !== "full").sort((a, b) => a.dailyPriceCents - b.dailyPriceCents)
  if (!open.length) return null
  return <section className="space-y-2 rounded-xl border p-4 text-left" data-testid="storage-add-prompt">
    <h2 className="text-base font-semibold">{t("stcAddTitle")}</h2>
    <p className="text-sm">{t("stcAddBody", { kitchen: open[0].kitchenName || t("stcTheKitchen"), amount: cad(open[0].dailyPriceCents, i18n.language) })}</p>
    <Button asChild variant="outline" className="min-h-11"><Link href={rentHref(kitchenId, open[0])}>{t("stcAdd")}</Link></Button>
  </section>
}
