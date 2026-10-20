import { useState } from "react"
/** Storage entry points outside "My storage": the kitchen page's Storage section and the prompt after a session booking. */
import { Link, useLocation } from "wouter"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Icon } from "@iconify/react"
import { ChevronRight } from "lucide-react"
import { SmartImage } from "@/components/ui/smart-image"
import { getR2ProxyUrl } from "@/utils/r2-url-helper"
import { resolveStorageIcon } from "@/lib/kitchen-inventory-icons"
import { Dialog } from "@/components/ui/dialog"
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@/components/ui/app-dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
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

function StorageThumb({ row, size = "sm" }: { row: StorageAvailability; size?: "sm" | "lg" }) {
  const photo = row.photos?.[0]
  // "lg": a 4:3 photo that shows the space (option cards), not a tiny thumbnail.
  const box = size === "lg" ? "h-[72px] w-24 rounded-lg sm:h-[84px] sm:w-28" : "h-8 w-8 rounded-lg"
  return photo ? <SmartImage src={getR2ProxyUrl(photo)} alt="" hideOnError className={`${box} shrink-0 object-cover`} />
    : <span className={`${box} flex shrink-0 items-center justify-center bg-[#FFF8F5] text-[#E10939]`} aria-hidden="true">
      <Icon icon={resolveStorageIcon(row.storageType, row.name)} width={size === "lg" ? 24 : 16} height={size === "lg" ? 24 : 16} /></span>
}

/**
 * What the chef rents, in plain words: kind, units, size, access, temperature, the kitchen's notes and a photo.
 * Every detail is optional (older listings lack some); missing ones are simply left out.
 */
export function StorageListingDetails({ row, compact = false, showName = true, showPhoto = true }: { row: StorageAvailability; compact?: boolean; showName?: boolean; showPhoto?: boolean }) {
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
    {showPhoto && <StorageThumb row={row} size="lg" />}
    <div className="min-w-0 space-y-0.5 text-sm">
      {showName && <p className="font-medium text-gray-900">{row.name}</p>}
      <p className="text-gray-700">{t("stcPerDay", { amount: cad(row.dailyPriceCents, i18n.language) })} · {availabilityText(row, t, i18n.language)}</p>
      {facts.length > 0 && <p className="text-gray-600">{facts.join(" · ")}</p>}
      {row.notes?.trim() && !compact && <p className="whitespace-pre-line text-gray-600">{t("stcNotes", { notes: row.notes.trim() })}</p>}
    </div>
  </div>
}

/**
 * One storage option on the kitchen page, in the Equipment card's row style (line icon, name + one muted line, price
 * on the right). The whole row opens the rental, as listing pages do for add-ons; no per-row primary button.
 */
function StorageRow({ row, onOpen }: { row: StorageAvailability; onOpen: () => void }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as T
  // Availability first: it's what decides the rental, and the line truncates in the narrow card.
  const when = row.availability.state === "from" && row.availability.from
    ? t("stcFromShort", { date: new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${row.availability.from}T12:00:00Z`)) })
    : availabilityText(row, t, i18n.language)
  const detail = [when, t(`stcKind_${row.storageType}`, { defaultValue: "" }),
    row.temperatureRange?.trim() || row.sizeLabel?.trim() || ""].filter(Boolean).join(" · ")
  const body = <>
    <span className="flex min-w-0 items-center gap-2.5">
      <StorageThumb row={row} />
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm text-gray-900">{row.name}</span>
        <span className="block truncate text-xs text-gray-500">{detail}</span>
      </span>
    </span>
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-sm text-gray-900">{cad(row.dailyPriceCents, i18n.language)}<span className="ml-1 text-xs font-normal text-gray-400">{t("stcPerDayUnit")}</span></span>
      <ChevronRight className="h-4 w-4 text-gray-400 transition-colors group-hover:text-gray-700" aria-hidden="true" />
    </span>
  </>
  return <button type="button" onClick={onOpen} aria-label={t("stcRentNamed", { listing: row.name })}
    className="group -mx-2 flex min-h-12 w-[calc(100%+1rem)] min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</button>
}

/**
 * Kitchen page Storage section. Approved chefs get "Rent storage" per listing; everyone else sees the same listings,
 * prices and rules plus "Apply to this kitchen first", which goes into the existing application flow.
 */
export function StorageRentCta({ kitchenId, canBook, onApply, compact = false, listings }: { kitchenId: number; canBook: boolean; onApply: () => void; compact?: boolean; listings?: StorageAvailability[] }) {
  const { t: tt } = useTranslation("storage")
  const t = tt as unknown as T
  const [showAll, setShowAll] = useState(false)
  const [, navigate] = useLocation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const rows = useQuery({ queryKey: ["storage-availability", kitchenId], queryFn: () => storageAvailability(kitchenId), retry: false, enabled: !listings })
  const list = listings ?? rows.data ?? []
  if (!list.length && canBook) return null
  const firstOpen = list.find(row => row.availability.state !== "full")?.listingId ?? null
  const openDialog = (listingId?: number) => {
    const pick = listingId ?? firstOpen
    setSelected(pick != null && list.find(row => row.listingId === pick)?.availability.state !== "full" ? pick : firstOpen)
    setDialogOpen(true)
  }
  return <div className="space-y-3" data-testid={canBook ? "storage-rent" : "storage-apply-first"}>
    {/* The kitchen card's info icon already says this; the full view and the rent dialog keep it. */}
    {!compact && <p className="text-xs text-gray-600">{t("stcKitchenRentHint")}</p>}
    <ul className="divide-y divide-gray-100">
      {(showAll ? list : list.slice(0, 3)).map(row => <li key={row.listingId}>
        {compact ? <StorageRow row={row} onOpen={() => openDialog(row.listingId)} />
          : <div className="flex items-center justify-between gap-3 py-3">
            <StorageListingDetails row={row} compact />
            {canBook && row.availability.state !== "full"
              ? <Button asChild size="sm" className="min-h-11 shrink-0"><Link href={rentHref(kitchenId, row)} aria-label={t("stcRentNamed", { listing: row.name })}>{t("stcRent")}</Link></Button> : null}
          </div>}
      </li>)}
    </ul>
    {compact ? <div className="border-t border-gray-100 pt-2">
      <button type="button" onClick={() => openDialog()}
        className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-[#E10939] hover:text-[#c90832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E10939]">
        {list.length > 3 ? t("stcRentStorageCount", { count: list.length }) : t("stcRentStorage")}<ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div> : list.length > 3 && !showAll && <Button variant="link" className="p-0" onClick={() => setShowAll(true)}>{t("stcShowAllStorage", { count: list.length })}</Button>}
    {compact && <StorageRentDialog open={dialogOpen} onOpenChange={setDialogOpen} list={list} selected={selected} onSelect={setSelected}
      canBook={canBook} onApply={() => { setDialogOpen(false); onApply() }}
      onContinue={row => { setDialogOpen(false); navigate(rentHref(kitchenId, row)) }} />}
    {!canBook && <div className="space-y-3">
      <p className="text-sm leading-relaxed text-gray-700">{t("stcKitchenApplyHint")}</p>
      {!compact && <PublishedCancellationPolicySummary kitchenId={kitchenId} />}
      <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onApply}>{t("stcApply")}</Button>
    </div>}
  </div>
}

/** The middle step: all options, scrollable, each with its full details; one "Continue" at the end (Turo/Peerspace add-ons). */
function StorageRentDialog({ open, onOpenChange, list, selected, onSelect, canBook, onApply, onContinue }: {
  open: boolean; onOpenChange: (open: boolean) => void; list: StorageAvailability[]; selected: number | null
  onSelect: (id: number) => void; canBook: boolean; onApply: () => void; onContinue?: (row: StorageAvailability) => void
}) {
  // No onContinue: a look at the options from inside the kitchen booking (rented separately, after it).
  const choose = canBook && !!onContinue
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as T
  const chosen = list.find(row => row.listingId === selected) ?? null
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl sm:p-0">
      <AppDialogHeader icon={<Icon icon="mdi:warehouse" width={18} height={18} />} title={t("stcRentStorage")} description={t("stcKitchenRentHint")} />
      <AppDialogBody>
        <RadioGroup value={selected != null ? String(selected) : ""} onValueChange={value => onSelect(Number(value))} aria-label={t("stcRentStorage")} className="space-y-2">
          {list.map(row => {
            const full = row.availability.state === "full", active = row.listingId === selected
            return <label key={row.listingId} htmlFor={`storage-option-${row.listingId}`}
              className={cn("flex gap-3 rounded-xl border p-3 transition-colors", full || !choose ? "cursor-default" : "cursor-pointer hover:border-gray-300",
                active && choose ? "border-[#E10939] bg-[#FFF8F5]/60 ring-1 ring-[#E10939]/20" : "border-gray-200", full && "opacity-60")}>
              {choose && <RadioGroupItem id={`storage-option-${row.listingId}`} value={String(row.listingId)} disabled={full} className="mt-1 shrink-0" />}
              <StorageListingDetails row={row} />
            </label>
          })}
        </RadioGroup>
      </AppDialogBody>
      <AppDialogFooter>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>{t("stcClose")}</Button>
        {!onContinue ? null : canBook ? <Button type="button" className="min-h-11" disabled={!chosen} onClick={() => chosen && onContinue(chosen)}>
          {chosen ? t("stcContinueWith", { price: cad(chosen.dailyPriceCents, i18n.language) }) : t("stcChooseStorage")}</Button>
          : <Button type="button" className="min-h-11" onClick={onApply}>{t("stcApply")}</Button>}
      </AppDialogFooter>
    </AppDialogContent>
  </Dialog>
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

/**
 * In the kitchen booking's Equipment step: this kitchen also rents storage. As on The Food Corridor, storage is its own
 * rental (by the day, separate from kitchen time), so this only says so and shows the options; it's booked afterwards.
 */
export function StorageBookingNote({ kitchenId }: { kitchenId: number }) {
  const { t: tt, i18n } = useTranslation("storage")
  const t = tt as unknown as T
  const [open, setOpen] = useState(false)
  const rows = useQuery({ queryKey: ["storage-availability", kitchenId], queryFn: () => storageAvailability(kitchenId), retry: false })
  const list = rows.data ?? []
  if (!list.length) return null
  const from = Math.min(...list.map(row => row.dailyPriceCents))
  const kinds = Array.from(new Set(list.map(row => t(`stcKind_${row.storageType}`, { defaultValue: "" }).toLowerCase()).filter(Boolean)))
  return <section className="flex items-start gap-3 rounded-2xl border border-dashed border-gray-300 p-4" data-testid="storage-booking-note">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF8F5] text-[#E10939]" aria-hidden="true"><Icon icon="mdi:warehouse" width={18} height={18} /></span>
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-sm font-semibold text-gray-900">{t("stcNoteTitle")}</p>
      <p className="text-sm text-gray-600">{t("stcNoteBody", { kinds: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(kinds), amount: cad(from, i18n.language) })}</p>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-[#E10939] hover:text-[#c90832]">
        {t("stcNoteSee", { count: list.length })}<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
    </div>
    <StorageRentDialog open={open} onOpenChange={setOpen} list={list} selected={null} onSelect={() => {}} canBook onApply={() => {}} />
  </section>
}
