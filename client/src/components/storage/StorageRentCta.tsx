import { useState } from "react"
import { StoragePhoto } from "./StoragePhoto"
/** Storage entry points outside "My storage": the kitchen page's Storage section and the prompt after a session booking. */
import { Link } from "wouter"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { PublishedCancellationPolicySummary } from "@/components/booking/CancellationPolicySummary"
import { cad, storageAvailability, storageDay, type StorageAvailability } from "@/lib/storage-rentals"

type T = (key: string, options?: Record<string, unknown>) => string
const ACCESS = ["kitchen_hours", "anytime", "by_arrangement"]
const rentHref = (kitchenId: number, row: StorageAvailability) => `/storage/new?kitchenId=${kitchenId}&listingId=${row.listingId}`
function availabilityText(row: StorageAvailability, t: T, locale: string) {
  if (row.availability.state === "now") return t("stcAvailNow")
  if (row.availability.state === "from" && row.availability.from) return t("stcAvailFrom", { date: storageDay(row.availability.from, locale) })
  return t("stcAvailFull")
}

/**
 * What the chef rents, in plain words: kind, units, size, access, temperature, the kitchen's notes and a photo.
 * Every detail is optional (older listings lack some); missing ones are simply left out.
 */
export function StorageListingDetails({ row, compact = false, showName = true }: { row: StorageAvailability; compact?: boolean; showName?: boolean }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as T
  const facts = compact ? [t(`stcKind_${row.storageType}`, { defaultValue: "" }), row.temperatureRange?.trim() || row.sizeLabel?.trim() || ""].filter(Boolean) : [
    t(`stcKind_${row.storageType}`, { defaultValue: "" }),
    row.unitCount && row.unitCount > 1 ? t("stcUnits", { count: row.unitCount }) : "",
    row.sizeLabel?.trim() ?? "",
    row.accessType && ACCESS.includes(row.accessType) ? t(`stcAccess_${row.accessType}`) : "",
    row.temperatureRange?.trim() && row.storageType !== "dry" ? t("stcTemperature", { range: row.temperatureRange.trim() }) : "",
  ].filter(Boolean)
  return <div className="flex min-w-0 gap-3">
    <StoragePhoto storageType={row.storageType} photos={row.photos} className={compact ? "h-12 w-12" : undefined} />
    <div className="min-w-0 space-y-0.5 text-sm">
      {showName && <p className="font-medium text-gray-900">{row.name}</p>}
      <p className="text-gray-700">{t("stcPerDay", { amount: cad(row.dailyPriceCents, i18n.language) })} · {availabilityText(row, t, i18n.language)}</p>
      {facts.length > 0 && <p className="text-gray-600">{facts.join(" · ")}</p>}
      {row.notes?.trim() && !compact && <p className="whitespace-pre-line text-gray-600">{t("stcNotes", { notes: row.notes.trim() })}</p>}
    </div>
  </div>
}

/**
 * Kitchen page Storage section. Approved chefs get "Rent storage" per listing; everyone else sees the same listings,
 * prices and rules plus "Apply to this kitchen first", which goes into the existing application flow.
 */
export function StorageRentCta({ kitchenId, canBook, onApply, compact = false, listings }: { kitchenId: number; canBook: boolean; onApply: () => void; compact?: boolean; listings?: StorageAvailability[] }) {
  const { t: tt } = useTranslation("storage")
  const t = tt as unknown as T
  const [showAll, setShowAll] = useState(false)
  const rows = useQuery({ queryKey: ["storage-availability", kitchenId], queryFn: () => storageAvailability(kitchenId), retry: false, enabled: !listings })
  const list = listings ?? rows.data ?? []
  if (!list.length && canBook) return null
  return <div className="space-y-3" data-testid={canBook ? "storage-rent" : "storage-apply-first"}>
    <p className="text-xs text-gray-600">{t("stcKitchenRentHint")}</p>
    <ul className="divide-y">
      {(showAll ? list : list.slice(0, 3)).map(row => <li key={row.listingId} className="flex items-center justify-between gap-3 py-3">
        <StorageListingDetails row={row} compact />
        {canBook && row.availability.state !== "full"
          ? <Button asChild size="sm" className="min-h-11 shrink-0"><Link href={rentHref(kitchenId, row)} aria-label={t("stcRentNamed", { listing: row.name })}>{t("stcRent")}</Link></Button> : null}
      </li>)}
    </ul>
    {list.length > 3 && !showAll && <Button variant="link" className="p-0" onClick={() => setShowAll(true)}>{t("stcShowAllStorage", { count: list.length })}</Button>}
    {!canBook && <div className="space-y-3">
      <p className="text-sm leading-relaxed text-gray-700">{t("stcKitchenApplyHint")}</p>
      {!compact && <PublishedCancellationPolicySummary kitchenId={kitchenId} />}
      <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onApply}>{t("stcApply")}</Button>
    </div>}
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
