import { ct } from '@/i18n/chef-ns';
import { EQUIPMENT_ICON_NAME } from "@/components/ui/inventory-icons";
import { logger } from "@/lib/logger";
import { useState, useEffect, useMemo, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from '@/lib/api';
import { CancellationPolicySummary, type PolicyResponse } from './CancellationPolicySummary';
import { CheckoutCancellationDisclosure, CheckoutConsentNotice } from './CheckoutCancellationDisclosure';
import { ChangeRequestBanner, ChangeRequestConsentLine, useReplacedRequest } from './ChangeRequestNotice';
import { CANCELLATION_DISCLOSURE_VERSION, DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { buildDatedDays, datedDayError, dateSelectionReason, localDateKey, readDatedDraft, type DayHours, type DayResources, type DateStatus } from './dated-booking-draft';
import { DatedCalendarDay, DatedCalendarContext } from './DatedCalendarDay';
import { useBookingEligibility } from "@/hooks/use-booking-eligibility";
import { BookingEligibilityBanner } from "./BookingEligibilityBanner";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import { useEmailVerificationGuard } from "@/hooks/use-email-verification-guard";
import { formatCurrency, formatHourSlotRange, formatTime as formatClockTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { BookingPriceSummary } from "./BookingPriceSummary";
import { useUnpaidPenaltiesCheck } from "@/hooks/use-unpaid-penalties";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { SmartImage } from "@/components/ui/smart-image";
import { Stepper, StepperDescription, StepperIndicator, StepperItem, StepperNav, StepperSeparator, StepperTitle, StepperTrigger } from "@/components/reui/stepper";
import { findPersistedBookingForKitchens, notifyBookingPrefsChanged } from "@/lib/persisted-booking-prefs";
import { resolveEquipmentIcon } from "@/lib/kitchen-inventory-icons";
import { chefOutlineCtaClass, chefPrimaryCtaClass } from "@/lib/chef-cta";
import { Icon } from "@iconify/react";
import { InfoChip } from "@/components/chef/info-chip";
import { tt } from "@/i18n/common-ns";
import { bt } from "@/i18n/booking-ns";
import { calculateKitchenBasePrice, type KitchenBookingRateMode } from "@shared/kitchen-booking-rate";
import { addHour, calendarDateForOperatingTime, sortTimesInOperatingWindow } from "@shared/operating-hours";
import { matchingLocalInstants } from '@shared/booking-dst';
import { bookingVisitBlocks } from '@shared/booking-visit-blocks';
import { validateKitchenSlotSelection, CONSECUTIVE_SLOTS_MESSAGE } from '@shared/consecutive-booking-slots';
import { DEFAULT_TIMEZONE } from '@/utils/timezone-utils';
import { firstBookingVisitStart, responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { formatResponseDeadline } from '@/lib/booking-response-deadline';

function kitchenCoverUrl(kitchen: {
  imageUrl?: string | null;
  image_url?: string | null;
  galleryImages?: string[] | null;
  gallery_images?: string[] | null;
  locationBrandImageUrl?: string | null;
  location_brand_image_url?: string | null;
} | null): string | null {
  if (!kitchen) return null;
  return (
    kitchen.imageUrl ||
    kitchen.image_url ||
    kitchen.galleryImages?.[0] ||
    kitchen.gallery_images?.[0] ||
    kitchen.locationBrandImageUrl ||
    kitchen.location_brand_image_url ||
    null
  );
}

/** Compact Airbnb-style kitchen thumb for confirm summary; Calendar if missing/broken. */
function ConfirmKitchenThumbnail({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-lg border border-[#E10939]/15 bg-white/80">
        <Icon icon="mdi:chef-hat" className="h-5 w-5 text-[#E10939]" aria-hidden />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }
  return (
    <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-lg border border-[#E10939]/15 bg-white/80">
      <SmartImage
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function equipmentName(equipment: any) {
  return String(equipment.equipmentType || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function InventoryPreviewList({
  title,
  subtitle,
  items,
  rental,
  columns = 2,
  selectedIds = [],
  onToggle,
}: {
  title: string;
  subtitle: string;
  items: any[];
  rental: boolean;
  /** Item grid columns within this list (default 2 for modals). */
  columns?: 1 | 2;
  selectedIds?: number[];
  onToggle?: (id: number) => void;
}) {
  const { t } = useTranslation("booking");
  return (
    <section className="min-w-0">
      <div className="mb-1">
        <h4 className="text-base font-semibold text-gray-900">{title}</h4>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <ul
        className={cn(
          "grid min-w-0 gap-x-6",
          columns === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
        )}
      >
        {items.map((equipment) => (
          <li key={equipment.id} className="flex min-w-0 items-center gap-2.5 border-b border-gray-100 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF3F5] text-[#E10939]">
              <Icon
                icon={resolveEquipmentIcon(equipment.equipmentType, equipment.category)}
                width={18}
                height={18}
                aria-hidden
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-900">
                {equipmentName(equipment)}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {rental ? `${formatCurrency(equipment.sessionRate || 0)} per session` : "Included"}
              </span>
            </span>
            {rental && onToggle && <Button type="button" variant="outline" className="min-h-11 shrink-0"
              aria-pressed={selectedIds.includes(equipment.id)}
              aria-label={`${t(selectedIds.includes(equipment.id) ? "wfbRemove" : "wfbAdd")} ${equipmentName(equipment)}`}
              onClick={() => onToggle(equipment.id)}>
              {t(selectedIds.includes(equipment.id) ? "wfbRemove" : "wfbAdd")}
            </Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Persistent place context carried from preview through every booking step. */
function BookingPlaceContext({
  kitchen,
  locationName,
  locationAddress,
  compact = false,
  onPolicyOpen,
}: {
  kitchen: any;
  locationName: string;
  locationAddress?: string;
  compact?: boolean;
  onPolicyOpen: () => void;
}) {
  const { t } = useTranslation(["booking", "kitchen"]);
  if (!kitchen) return null;

  const imageAlt = String(t("sheetKitchenImageAlt", {
    name: kitchen.name,
    defaultValue: `${kitchen.name} kitchen`,
  }));
  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <ConfirmKitchenThumbnail src={kitchenCoverUrl(kitchen)} alt={imageAlt} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold uppercase tracking-[0.12em] text-[#E10939]">
              {t("sheetBookingAtLabel", "Booking at")}
            </p>
            <h1 className="truncate text-base font-semibold text-gray-900">{kitchen.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{locationName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onPolicyOpen}
          className="flex w-full items-center gap-2 border-t border-gray-200/80 pt-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-[#E10939]"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Icon
              icon="mdi:shield-check-outline"
              className="h-3.5 w-3.5 shrink-0 text-[#E10939]"
              aria-hidden
            />
            <span className="truncate">{t("sheetCancellationPolicyTitle", "Cancellation policy")}</span>
          </span>
          <Icon icon="mdi:chevron-right" className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label={t("sheetSelectedKitchenSummary", "Selected kitchen summary")}
      className="overflow-hidden rounded-[1.35rem] border border-gray-200 bg-white shadow-sm"
    >
      <div className="grid gap-2 p-2">
        <div className="relative h-24 w-full overflow-hidden rounded-xl bg-gray-100">
            <div className="flex h-full w-full items-center justify-center bg-[#E10939]/5">
              <Icon icon="mdi:chef-hat" className="h-8 w-8 text-[#E10939]" aria-hidden />
            </div>
            <SmartImage
              src={kitchenCoverUrl(kitchen) || ""}
              alt={imageAlt}
              className="absolute inset-0 h-full w-full object-cover"
              hideOnError
            />
        </div>
        <div className="rounded-xl bg-gray-50/80 p-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#E10939]">
              {t("sheetBookingAtLabel", "Booking at")}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold leading-tight text-gray-900">
              {kitchen.name}
            </h2>
            <p className="mt-1 truncate text-sm font-medium text-muted-foreground">{locationName}</p>
            {locationAddress && (
              <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
                <Icon icon="mdi:map-marker-outline" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{locationAddress}</span>
              </p>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onPolicyOpen}
        className="flex w-full items-center gap-2.5 border-t border-gray-100 bg-gray-50/70 px-3.5 py-2.5 text-left transition-colors hover:bg-[#FFF7F8]"
      >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Icon
                icon="mdi:shield-check-outline"
                className="h-4 w-4 shrink-0 text-[#E10939]"
                aria-hidden
              />
              {t("sheetCancellationPolicyTitle", "Cancellation policy")}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {t("preConfirmationRefundTitle", "Free to cancel until the kitchen confirms your request — your card is only on hold.")}
            </p>
          </div>
          <Icon icon="mdi:chevron-right" className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>
    </section>
  );
}

export interface KitchenBookingFlowProps {
  locationId: number;
  locationName: string;
  locationAddress?: string;
  /** Prefer this kitchen (e.g. from kitchen preview). Skips kitchen picking. */
  kitchenId?: number | string;
  initialDateIso?: string;
  initialSlots?: string[];
  initialNotes?: string;
  initialEquipment?: string;
  /** "Change request": the chef's pending request that is withdrawn once this new one is sent. */
  replacesBookingId?: number;
  onCancel: () => void;
  onComplete?: (bookingId?: number) => void;
  /**
   * Lets the shell (sidebar / breadcrumbs) open the same cancel-confirm dialog.
   * Call `proceed` only after the user confirms cancel. Pass `null` on unmount.
   */
  registerLeaveGuard?: (
    requestLeave: ((proceed?: () => void) => void) | null
  ) => void;
}

type BookingStep = "calendar" | "slots" | "equipment" | "confirm";
type BookingRateMode = KitchenBookingRateMode;

type StepMeta = { key: BookingStep; label: string; subtext: string };

/** Matches kitchen preview / prefs panel — fixed 32px cells → true circular selection. */
const BOOKING_CALENDAR_CLASS_NAMES = {
  months: "flex w-full flex-col space-y-0",
  month: "w-full space-y-2",
  caption: "relative flex w-full items-center justify-center pt-0.5",
  caption_label: "text-sm font-medium",
  nav_button:
    "inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100",
  nav_button_previous: "absolute left-0",
  nav_button_next: "absolute right-0",
  table: "w-full table-fixed border-collapse",
  head_cell:
    "w-[14.28%] pb-0.5 text-center text-sm font-normal text-muted-foreground",
  row: "mt-0.5",
  cell: cn(
    "relative z-0 h-8 p-0 text-center text-sm",
    "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:border-2 [&:has([aria-selected])]:before:border-[#E10939]"
  ),
  day: "mx-auto flex h-8 w-8 max-w-[32px] items-center justify-center rounded-full bg-transparent p-0 text-sm font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100",
  day_selected:
    "bg-transparent text-gray-900 hover:bg-transparent focus:bg-transparent",
  day_disabled:
    "pointer-events-none text-gray-300 opacity-40 line-through decoration-gray-300/80",
};

/** Two-month booking picker — side-by-side from sm up. */
const BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES = {
  ...BOOKING_CALENDAR_CLASS_NAMES,
  months: "flex w-full flex-col gap-4 sm:flex-row sm:gap-6 sm:space-y-0",
  month: "w-full min-w-0 flex-1 space-y-2",
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** The server's own words for a refused checkout/booking, with a plain fallback per status so a failure is never silent. */
async function describeBookingFailure(response: Response, fallbackFor: (status: number) => string) {
  const body = await response.json().catch(() => null) as { error?: unknown; message?: unknown; eligibility?: unknown } | null;
  const text = [body?.error, body?.message].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return { message: text || fallbackFor(response.status), refusedAccess: response.status === 403 && !!body?.eligibility };
}

export default function KitchenBookingFlow({
  locationId,
  locationName,
  locationAddress,
  kitchenId: preferredKitchenId,
  initialDateIso,
  initialSlots,
  initialNotes,
  initialEquipment,
  replacesBookingId,
  onCancel,
  onComplete,
  registerLeaveGuard,
}: KitchenBookingFlowProps) {
  const { t, i18n } = useTranslation(["booking", "kitchen"]);
  const { kitchens, createBooking, isLoadingKitchens } = useKitchenBookings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { guard, gate } = useEmailVerificationGuard();
  // Read up front: a chef who cannot book is told why before they pick dates, not after checkout.
  const { eligibility } = useBookingEligibility(locationId);
  // "Change request": the earlier pending request this booking replaces (shown in the banner and the consent block).
  const { data: replacedRequest } = useReplacedRequest(replacesBookingId);
  // Its own hours are free for the chef while changing it (the server ignores `replaces` unless it is theirs and still pending).
  const replacesQuery = replacesBookingId ? `&replaces=${replacesBookingId}` : '';
  const bookingBlocked = !!eligibility && !eligibility.canBook;
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const failureFallback = (status: number) =>
    status === 403 ? t("bookingErrorForbidden", "You cannot book this kitchen right now. See the notice at the top of this page.")
    : status === 409 ? t("bookingErrorConflict", "Those hours were just taken or changed. Please choose your hours again.")
    : status === 422 || status === 400 ? t("bookingErrorInvalid", "Some booking details need attention. Please review them and try again.")
    : status >= 500 ? t("bookingErrorServer", "Something went wrong on our side. Your card was not charged. Please try again in a moment.")
    : t("toastCheckoutFailedDefaultDesc", "Failed to start checkout. Please try again.");

  // Filter kitchens to only those in this location
  const locationKitchens = useMemo(() => {
    return kitchens.filter((kitchen: any) => {
      const kitchenLocationId = kitchen.location?.id || kitchen.locationId || kitchen.location_id;
      return kitchenLocationId === locationId;
    });
  }, [kitchens, locationId]);

  // State
  const [selectedKitchen, setSelectedKitchen] = useState<any | null>(null);
  const [bookableThrough, setBookableThrough] = useState<string | null>(null);
  const [dayRules, setDayRules] = useState<{ allowMultiDayBookings?: boolean; multidayCreationEnabled?: boolean; maxBookingDays?: number; minimumBookingWindowHours?: number }>({});
  const multipleAllowed = dayRules.allowMultiDayBookings === true && dayRules.multidayCreationEnabled === true;
  useEffect(() => {
    setBookableThrough(null);
    if (!selectedKitchen?.id) return;
    let stale = false;
    void apiGet(`/chef/kitchens/${selectedKitchen.id}/policy`).then(policy => {
      if (!stale) {
        setDayRules(policy ?? {});
        if (typeof policy?.bookableThrough === 'string') setBookableThrough(policy.bookableThrough);
      }
    }).catch(() => {});
    return () => { stale = true; };
  }, [selectedKitchen?.id]);
  const { t: policyT } = useTranslation('booking');
  const { data: acceptedPolicy } = useQuery<PolicyResponse>({ queryKey: ['cancellation-policy', selectedKitchen?.id], enabled: !!selectedKitchen?.id,
    queryFn: async () => { const result = await apiGet(`/kitchens/${selectedKitchen.id}/cancellation-policy`); if (!result?.policy || !result?.settings) throw Error(policyT('cpError')); return result; } });
  // #52: no checkbox. Selecting Checkout under the consent line is the acceptance; the policy link opens these details.
  const [policyDetailsOpen, setPolicyDetailsOpen] = useState(false);
  useEffect(() => setPolicyDetailsOpen(false), [selectedKitchen?.id, acceptedPolicy?.policy.version]);
  const showPolicyDetails = () => {
    setPolicyDetailsOpen(true);
    requestAnimationFrame(() => document.getElementById('checkout-cancellation-details')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  };
  const [currentStep, setCurrentStep] = useState<BookingStep>("calendar");
  /** When true, date was prefilled — hide Date from the step rail and start after it. */
  const [hideDateStep, setHideDateStep] = useState(false);
  /** False until kitchen + any restored prefs settle — avoids date-step flash. */
  const [isFlowReady, setIsFlowReady] = useState(false);
  const initRef = useRef(false);

  // Payment state
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] = useState(false);
  const [isProcessingBooking, setIsProcessingBooking] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  
  // Penalty check
  const { data: penaltyData } = useUnpaidPenaltiesCheck(true);

  // Calendar state
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [dateStatuses, setDateStatuses] = useState<Record<string, DateStatus>>({});
  const [dateAnnouncement, setDateAnnouncement] = useState('');
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [dayHours, setDayHours] = useState<Record<string, DayHours>>({});
  const [dayEquipmentExcluded, setDayEquipmentExcluded] = useState<Record<string, number[]>>({});
  const [dayResources, setDayResources] = useState<Record<string, DayResources>>({});
  const [daysLoading, setDaysLoading] = useState(false);
  const isMultiDay = multipleAllowed && selectedDates.length > 1;
  const pickerDate = isMultiDay && editingDay ? new Date(`${editingDay}T12:00:00`) : selectedDate;
  const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);

  // Slots state
  const [singleSlots, setAllSlots] = useState<Array<{
    time: string;
    available: number;
    capacity: number;
    isFullyBooked: boolean;
  }>>([]);
  const [templateSlots, setTemplateSlots] = useState<string[]>([]);
  const currentHours = isMultiDay && editingDay ? dayHours[editingDay] : undefined;
  const selectedSlots = currentHours?.times ?? templateSlots;
  const setSelectedSlots: Dispatch<SetStateAction<string[]>> = (value) => {
    if (isMultiDay && editingDay) {
      const times = typeof value === 'function' ? value(selectedSlots) : value;
      setDayHours(current => ({ ...current, [editingDay]: { pricingMode: current[editingDay]?.pricingMode ?? templateRateMode, times } }));
    } else setTemplateSlots(value);
  };
  const selectedSlotsRef = useRef(selectedSlots);
  selectedSlotsRef.current = selectedSlots;
  const [singleFullDayBookable, setFullDayBookable] = useState(false);
  const [pendingTimeSlots, setPendingTimeSlots] = useState<string[]>([]);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  /** Null = no longest-booking hours cap (opening hours only). */
  const [maxSlotsPerChef, setMaxSlotsPerChef] = useState<number | null>(null);

  // Pricing state
  const [kitchenPricing, setKitchenPricing] = useState<{
    hourlyRate: number | null;
    dailyRate: number | null;
    currency: string;
    minimumBookingHours: number;
    platformCommissionRate: number;
    preparationReminderHours?: number;
    managerResponseBufferHours?: number;
    timezone?: string;
  } | null>(null);
  const [templateRateMode, setTemplateRateMode] = useState<BookingRateMode>("hourly");
  const bookingRateMode = isMultiDay && editingDay ? (dayHours[editingDay]?.pricingMode ?? templateRateMode) : templateRateMode;
  const setBookingRateMode = (pricingMode: BookingRateMode) => {
    if (isMultiDay && editingDay) setDayHours(current => ({ ...current, [editingDay]: { pricingMode, times: dayHours[editingDay]?.times ?? templateSlots } }));
    else setTemplateRateMode(pricingMode);
  };
  const pickerResource = dayResources[editingDay ?? selectedDates[0]];
  const allSlots = isMultiDay ? pickerResource?.slots ?? singleSlots : singleSlots;
  const fullDayBookable = isMultiDay ? !!pickerResource?.fullDay : singleFullDayBookable;
  const [estimatedPrice, setEstimatedPrice] = useState<{
    basePrice: number;
    tax: number;
    totalPrice: number;
    durationHours: number;
  } | null>(null);

  // Add-ons state
  const [equipmentListings, setEquipmentListings] = useState<{
    all: any[];
    included: any[];
    rental: any[];
  }>({ all: [], included: [], rental: [] });
  const [isLoadingAddons, setIsLoadingAddons] = useState(false);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<number[]>([]);
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [equipmentInventoryModal, setEquipmentInventoryModal] = useState<"included" | "rental" | null>(null);
  const [cancellationPolicyOpen, setCancellationPolicyOpen] = useState(false);
  const [pendingEquipmentIds, setPendingEquipmentIds] = useState<number[]>([]);
  const [discardModal, setDiscardModal] = useState<"equipment" | "time" | null>(null);
  const [confirmDatePopoverOpen, setConfirmDatePopoverOpen] = useState(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const restoredDaysFor = useRef<number | null>(null);
  const restoredReplacement = useRef<number | null>(null);
  useEffect(() => {
    const days = replacedRequest?.days;
    if (!multipleAllowed || !isFlowReady || !days?.length || !replacesBookingId || restoredReplacement.current === replacesBookingId) return;
    restoredReplacement.current = replacesBookingId;
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const equipment = Array.from(new Set(sorted.flatMap(day => day.equipmentIds)));
    setSelectedDates(sorted.map(day => day.date));
    setSelectedDate(new Date(`${sorted[0].date}T12:00:00`));
    setTemplateRateMode(sorted[0].pricingMode);
    setTemplateSlots(sorted[0].slots.map(slot => slot.startTime));
    setDayHours(Object.fromEntries(sorted.map(day => [day.date, { pricingMode: day.pricingMode, times: day.slots.map(slot => slot.startTime) }])));
    setSelectedEquipmentIds(equipment);
    setDayEquipmentExcluded(Object.fromEntries(sorted.map(day => [day.date, equipment.filter(id => !day.equipmentIds.includes(id))])));
    setHideDateStep(false);
    setCurrentStep('calendar');
  }, [multipleAllowed, isFlowReady, replacedRequest, replacesBookingId]);
  useEffect(() => {
    if (!multipleAllowed || !isFlowReady || !selectedKitchen || restoredDaysFor.current === selectedKitchen.id) return;
    restoredDaysFor.current = selectedKitchen.id;
    if (initialDateIso || replacesBookingId) return;
    const draft = readDatedDraft(selectedKitchen.id);
    if (!draft) return;
    setSelectedDates([...draft.dates].sort());
    setSelectedDate(new Date(`${[...draft.dates].sort()[0]}T12:00:00`));
    setCalendarMonth(new Date(`${[...draft.dates].sort()[0]}T12:00:00`));
    setTemplateSlots(draft.template.times);
    setTemplateRateMode(draft.template.pricingMode);
    setDayHours(draft.hours);
    setSelectedEquipmentIds(draft.equipmentIds);
    setDayEquipmentExcluded(draft.excluded);
    setNotes(draft.notes);
    setHideDateStep(false);
    setCurrentStep('calendar');
  }, [multipleAllowed, selectedKitchen?.id, isFlowReady, initialDateIso]);
  useEffect(() => {
    if (!selectedKitchen || !multipleAllowed || !isFlowReady || restoredDaysFor.current !== selectedKitchen.id) return;
    try {
      if (!isMultiDay) { sessionStorage.removeItem(`kitchen_booking_days_${selectedKitchen.id}`); return; }
      sessionStorage.setItem(`kitchen_booking_days_${selectedKitchen.id}`, JSON.stringify({ version: 1, dates: selectedDates,
        template: { pricingMode: templateRateMode, times: templateSlots }, hours: dayHours, equipmentIds: selectedEquipmentIds,
        excluded: dayEquipmentExcluded, notes }));
    } catch { /* A full/unavailable session store must not block booking. */ }
  }, [isMultiDay, multipleAllowed, isFlowReady, selectedKitchen?.id, selectedDates, templateSlots, templateRateMode, dayHours, selectedEquipmentIds, dayEquipmentExcluded, notes]);

  const datedDays = buildDatedDays(selectedDates, { pricingMode: templateRateMode, times: templateSlots }, dayHours,
    Array.from(new Set([...equipmentListings.included.map(item => item.id), ...selectedEquipmentIds])), dayEquipmentExcluded, dayResources);
  const datedPrices = datedDays.map(day => {
    const kitchenSubtotal = day.pricingMode === 'daily' ? kitchenPricing?.dailyRate ?? 0 : day.slots.length * (kitchenPricing?.hourlyRate ?? 0);
    const equipmentSubtotal = day.equipmentIds.reduce((sum, id) => sum + (equipmentListings.all.find(item => item.id === id)?.sessionRate ?? 0), 0);
    return { ...day, kitchenSubtotal, equipmentSubtotal };
  });
  const datedKitchenSubtotal = datedPrices.reduce((sum, day) => sum + day.kitchenSubtotal, 0);
  const datedEquipmentSubtotal = datedPrices.reduce((sum, day) => sum + day.equipmentSubtotal, 0);
  const invalidDay = isMultiDay ? datedDays.find(day => datedDayError(day, dayResources[day.date], kitchenPricing?.minimumBookingHours ?? 0, maxSlotsPerChef)) : undefined;
  const dateSetError = isMultiDay && (selectedDates.length > Math.min(dayRules.maxBookingDays ?? 7, 14) ? t('mdCountLimit', { count: dayRules.maxBookingDays ?? 7 })
    : dateSelectionReason(selectedDates[selectedDates.length - 1], selectedDates.slice(0, -1), 14) ? t('mdSpanLimit') : null);

  // Each operating date keeps its own opening window, notice filter and equipment inventory.
  useEffect(() => {
    if (!isMultiDay || !selectedKitchen) return;
    let stale = false;
    setDaysLoading(true);
    const kitchenId = selectedKitchen.id;
    void Promise.all(selectedDates.map(async date => {
      const [slots, equipment] = await Promise.all([
        apiGet(`/chef/kitchens/${kitchenId}/slots?date=${date}${replacesQuery}`),
        apiGet(`/chef/kitchens/${kitchenId}/equipment-listings?date=${date}`),
      ]);
      const zone = kitchenPricing?.timezone || DEFAULT_TIMEZONE;
      const notice = dayRules.minimumBookingWindowHours ?? selectedKitchen.location?.minimumBookingWindowHours ?? 0;
      const filtered = slots.filter((slot: any) => {
        const instant = matchingLocalInstants(calendarDateForOperatingTime(date, slot.time, slots[0]?.time || slot.time), slot.time, zone)[0];
        return instant !== undefined && instant > Date.now() + notice * 3_600_000;
      });
      return [date, { windowStartTime: slots[0]?.time, slots: filtered, fullDay: slots.length > 0 && filtered.length === slots.length && slots.every((slot: any) => !slot.isFullyBooked),
        equipmentIds: [...(equipment.included ?? []), ...(equipment.rental ?? [])].filter((item: any) => !item.archivedAt).map((item: any) => item.id) }] as const;
    })).then(entries => { if (!stale) setDayResources(Object.fromEntries(entries)); })
      .catch(() => { if (!stale) { setDayResources({}); setLoadError(t('mdLoadDays')); } })
      .finally(() => { if (!stale) setDaysLoading(false); });
    return () => { stale = true; };
  }, [isMultiDay, selectedDates.join(','), selectedKitchen?.id, kitchenPricing?.timezone, dayRules.minimumBookingWindowHours, replacesQuery]);

  // Equipment pricing
  const equipmentPricing = useMemo(() => {
    if (!selectedEquipmentIds.length || !equipmentListings.rental.length) {
      return { items: [], subtotal: 0 };
    }

    const items = selectedEquipmentIds
      .map((eqId) => {
        const eq = equipmentListings.rental.find((e: any) => e.id === eqId);
        if (!eq) return null;
        const rate = eq.sessionRate || 0;
        return { id: eq.id, name: `${eq.equipmentType}${eq.brand ? ` (${eq.brand})` : ''}`, rate };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return { items, subtotal: items.reduce((sum, item) => sum + item.rate, 0) };
  }, [selectedEquipmentIds, equipmentListings.rental]);

  const pendingEquipmentSubtotal = useMemo(
    () => pendingEquipmentIds.reduce((sum, id) => {
      const equipment = equipmentListings.rental.find((item: any) => item.id === id);
      const days = isMultiDay ? selectedDates.filter(date => dayResources[date]?.equipmentIds.includes(id) && !dayEquipmentExcluded[date]?.includes(id)).length : 1;
      return sum + (equipment?.sessionRate || 0) * days;
    }, 0),
    [pendingEquipmentIds, equipmentListings.rental, isMultiDay, selectedDates, dayResources, dayEquipmentExcluded]
  );

  // Combined pricing
  const combinedSubtotal = useMemo(() => {
    const kitchenBase = isMultiDay ? datedKitchenSubtotal : estimatedPrice?.basePrice || 0;
    const equipmentBaseCents = isMultiDay ? datedEquipmentSubtotal : equipmentPricing.subtotal || 0;
    return kitchenBase + equipmentBaseCents;
  }, [isMultiDay, datedKitchenSubtotal, datedEquipmentSubtotal, estimatedPrice?.basePrice, equipmentPricing.subtotal]);

  const tax = useMemo(() => {
    if (combinedSubtotal <= 0) return 0;
    const taxRatePercent = selectedKitchen?.taxRatePercent || 0;
    return Math.round((combinedSubtotal * taxRatePercent) / 100);
  }, [combinedSubtotal, selectedKitchen?.taxRatePercent]);

  const serviceFee = useMemo(() => {
    if (combinedSubtotal <= 0) return 0;
    return Math.round(combinedSubtotal * (kitchenPricing?.platformCommissionRate ?? 0));
  }, [combinedSubtotal, kitchenPricing?.platformCommissionRate]);

  const grandTotal = useMemo(() => combinedSubtotal + tax + serviceFee, [combinedSubtotal, tax, serviceFee]);

  const currentYear = calendarMonth.getFullYear();
  const currentMonth = calendarMonth.getMonth();

  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Initialize kitchen selection once kitchens are available
  useEffect(() => {
    if (initRef.current) return;
    if (locationKitchens.length === 0) return;

    const preferred =
      preferredKitchenId != null
        ? locationKitchens.find((k: any) => String(k.id) === String(preferredKitchenId))
        : null;
    const persisted = findPersistedBookingForKitchens(
      (preferred ? [preferred.id] : locationKitchens.map((k: any) => k.id)) as Array<string | number>
    );
    const kitchen =
      preferred ||
      (persisted
        ? locationKitchens.find((k: any) => String(k.id) === persisted.kitchenId)
        : null) ||
      locationKitchens[0];

    if (!kitchen) return;

    initRef.current = true;
    const restoreForKitchen = findPersistedBookingForKitchens([kitchen.id]);
    const legacyDate = initialDateIso && /^\d{4}-\d{2}-\d{2}$/.test(initialDateIso) ? initialDateIso : undefined;
    const legacySlots = initialSlots;
    const restore = legacyDate
      ? { dateIso: legacyDate, slots: legacySlots || [], step: 'slots' as BookingStep }
      : restoreForKitchen
        ? { dateIso: restoreForKitchen.dateIso, slots: restoreForKitchen.slots }
        : undefined;
    // Hide Date in the rail immediately when prefs exist so the stepper doesn't flash it.
    if (restore?.dateIso) {
      setHideDateStep(true);
    }
    void handleKitchenSelect(
      kitchen,
      restore
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / kitchens / preferredKitchenId gate only
  }, [locationKitchens, preferredKitchenId]);

  // Load slots when date changes
  useEffect(() => {
    if (selectedKitchen && selectedDate && !isMultiDay) {
      loadAvailableSlots(selectedKitchen.id, toLocalDateString(selectedDate));
    }
  }, [selectedKitchen, selectedDate, isMultiDay]);

  // Load month availability for the date step (two months) and confirm popover (one month)
  useEffect(() => {
    if (!selectedKitchen) return;
    if (currentStep === "calendar") {
      const next = new Date(currentYear, currentMonth + 1, 1);
      void loadMonthsAvailability(selectedKitchen.id, [
        { year: currentYear, month: currentMonth },
        { year: next.getFullYear(), month: next.getMonth() },
      ]);
      return;
    }
    if (confirmDatePopoverOpen) {
      void loadMonthsAvailability(selectedKitchen.id, [
        { year: currentYear, month: currentMonth },
      ]);
    }
  }, [selectedKitchen, currentYear, currentMonth, currentStep, confirmDatePopoverOpen, multipleAllowed]);

  const loadMonthsAvailability = async (
    kitchenId: number,
    months: Array<{ year: number; month: number }>
  ) => {
    setIsLoadingAvailability(true);
    // Clear so the loader shows and we never mix stale months into the new window
    setDateAvailability({});

    try {
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);

      const chunks = await Promise.all(
        months.map(async ({ year, month }) => {
          const response = await fetch(
            `/api/chef/kitchens/${kitchenId}/${multipleAllowed ? 'date-status' : 'month-availability'}?year=${year}&month=${month}${replacesQuery}`,
            {
              credentials: "include",
              headers,
              cache: "no-store",
            }
          );
          if (!response.ok) {
            throw new Error(`Failed to load month availability (status ${response.status})`);
          }
          const result = await response.json();
          if (multipleAllowed) setDateStatuses(current => ({ ...current, ...result }));
          const serverAvailability: Record<string, boolean> = multipleAllowed
            ? Object.fromEntries(Object.entries(result as Record<string, DateStatus>).map(([date, status]) => [date, status.hourly || status.fullDay])) : result;
          const availability: Record<string, boolean> = {};
          const daysInMonth = getDaysInMonth(year, month);
          for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = toLocalDateString(date);
            availability[dateStr] =
              date >= todayDate && serverAvailability[dateStr] === true;
          }
          return availability;
        })
      );

      setDateAvailability(Object.assign({}, ...chunks));
    } catch (error) {
      logger.error('Error loading month availability:', error);
      setDateAvailability({});
      setLoadError(t("bookingErrorLoadAvailability", "We could not load availability. Please check your connection and try again."));
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  // Calculate price when slots change
  useEffect(() => {
    if (!selectedSlots.length || !selectedKitchen || !kitchenPricing) {
      setEstimatedPrice(null);
      return;
    }

    const durationHours = bookingRateMode === 'daily'
      ? selectedSlots.length
      : Math.max(selectedSlots.length, kitchenPricing.minimumBookingHours ?? 0);
    const selectedRate = bookingRateMode === "daily"
      ? kitchenPricing.dailyRate
      : kitchenPricing.hourlyRate;

    if (selectedRate && selectedRate > 0) {
      const basePrice = calculateKitchenBasePrice(
        bookingRateMode,
        kitchenPricing.hourlyRate || 0,
        kitchenPricing.dailyRate || 0,
        durationHours,
      );
      const taxRatePercent = selectedKitchen?.taxRatePercent || 0;
      const taxAmount = Math.round((basePrice * taxRatePercent) / 100);
      const totalPrice = basePrice + taxAmount;

      setEstimatedPrice({ basePrice, tax: taxAmount, totalPrice, durationHours });
    } else {
      setEstimatedPrice({ basePrice: 0, tax: 0, totalPrice: 0, durationHours: 0 });
    }
  }, [selectedSlots, selectedKitchen, kitchenPricing, bookingRateMode]);

  useEffect(() => {
    if (bookingRateMode !== "daily" || isLoadingSlots) return;
    if (isMultiDay) return; // Dated full days use each date's complete opening window.
    setSelectedSlots(fullDayBookable
      ? allSlots.map((slot) => slot.time)
      : []);
  }, [allSlots, fullDayBookable, bookingRateMode, isLoadingSlots, isMultiDay]);

  const loadAvailableSlots = async (kitchenId: number, date: string) => {
    setIsLoadingSlots(true);
    try {
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      // Fetch policy
      try {
        const policyRes = await fetch(`/api/chef/kitchens/${kitchenId}/policy?date=${date}`, {
          credentials: "include",
          headers,
          cache: 'no-store',
        });
        if (policyRes.ok) {
          const policy = await policyRes.json();
          if (policy && typeof policy.maxSlotsPerChef === 'number' && policy.maxSlotsPerChef > 0) {
            setMaxSlotsPerChef(policy.maxSlotsPerChef);
          } else {
            // null / missing = no per-request hours cap
            setMaxSlotsPerChef(null);
          }
        } else {
          setMaxSlotsPerChef(null);
        }
      } catch {
        setMaxSlotsPerChef(null);
      }

      // Fetch slots
      const response = await fetch(`/api/chef/kitchens/${kitchenId}/slots?date=${date}${replacesQuery}`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(bt("failedToFetchSlots"));
      }

      const slots = await response.json();
      const now = new Date();
      // Get minimum booking window from location (0 = no restriction)
      const minimumBookingWindowHours = selectedKitchen?.location?.minimumBookingWindowHours ?? 0;

      const operatingStart = slots[0]?.time;
      const filteredSlots = slots.filter((slot: any) => {
        const calendarDate = calendarDateForOperatingTime(date, slot.time, operatingStart || slot.time);
        const slotInstant = matchingLocalInstants(calendarDate, slot.time, DEFAULT_TIMEZONE)[0];
        if (slotInstant === undefined) return false;

        // Filter out past times (applies to any date)
        if (slotInstant <= now.getTime()) return false;

        // Enforce minimum booking window across ALL dates (not just today)
        // e.g., a 48-hour window must also filter tomorrow's slots that are within range
        if (minimumBookingWindowHours > 0) {
          const hoursUntilSlot = (slotInstant - now.getTime()) / (1000 * 60 * 60);
          if (hoursUntilSlot < minimumBookingWindowHours) return false;
        }
        return true;
      });

      setAllSlots(filteredSlots);
      // A stale middle hour invalidates the draft; never silently leave two visits.
      if (selectedSlotsRef.current.length && validateKitchenSlotSelection(selectedSlotsRef.current, filteredSlots)) {
        toast({ title: ct('sweepText17'), description: ct('sweepText18'), variant: 'destructive' });
        setSelectedSlots([]);
        setCurrentStep('slots');
      }
      const canBookFullDay = slots.length > 0 && slots.every((slot: any) => !slot.isFullyBooked) && filteredSlots.length === slots.length;
      setFullDayBookable(canBookFullDay);
      // Don't auto-navigate - user clicks "Select Time Slots" button to proceed

      if (slots.length === 0) {
        toast({
          title: t("toastKitchenClosedTitle", "Kitchen closed"),
          description: t("toastKitchenClosedDesc", "This date has no operating hours set."),
          variant: "destructive",
        });
      }
    } catch (error) {
      logger.error("Error loading slots:", error);
      setAllSlots([]);
      setFullDayBookable(false);
      toast({
        title: t("toastGenericErrorTitle", "Error"),
        description: t("toastLoadSlotsFailedDesc", "Failed to load time slots. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const fetchKitchenAddons = async (kitchenId: number, authHeader?: string) => {
    setIsLoadingAddons(true);
    const empty = {
      equipment: { all: [] as any[], included: [] as any[], rental: [] as any[] },
    };
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      // Fetch equipment
      const equipmentRes = await fetch(`/api/chef/kitchens/${kitchenId}/equipment-listings`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      let equipment = empty.equipment;
      if (equipmentRes.ok) {
        const equipmentData = await equipmentRes.json();
        const normalizeEquipment = (eq: any) => ({
          ...eq,
          sessionRate: eq.sessionRate || 0,
          hourlyRate: eq.hourlyRate || 0,
          dailyRate: eq.dailyRate || 0,
        });

        equipment = {
          all: [...(equipmentData.included || []), ...(equipmentData.rental || [])].map(normalizeEquipment),
          included: (equipmentData.included || []).map(normalizeEquipment),
          rental: (equipmentData.rental || []).map(normalizeEquipment),
        };
        setEquipmentListings(equipment);
      } else {
        setEquipmentListings(empty.equipment);
      }

      return { equipment };
    } catch (error) {
      logger.error('Error fetching kitchen addons:', error);
      setLoadError(t("bookingErrorLoadOptions", "We could not load this kitchen's add-on options. Reload the page to try again."));
      setEquipmentListings(empty.equipment);
      return empty;
    } finally {
      setIsLoadingAddons(false);
    }
  };

  const handleKitchenSelect = async (
    kitchen: any,
    restore?: {
      dateIso: string;
      slots: string[];
      step?: BookingStep;
    }
  ) => {
    setIsFlowReady(false);
    setSelectedKitchen(kitchen);
    setSelectedDate(null);
    setSelectedDates([]);
    setDayHours({});
    setEditingDay(null);
    setDayResources({});
    setDateStatuses({});
    setDayEquipmentExcluded({});
    setSelectedSlots([]);
    setAllSlots([]);
    setSelectedEquipmentIds([]);

    // Fetch pricing
    try {
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const response = await fetch(`/api/chef/kitchens/${kitchen.id}/pricing`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      if (response.ok) {
        const pricing = await response.json();
        let hourlyRateCents = pricing.hourlyRate;
        let dailyRateCents = pricing.dailyRate;
        if (typeof hourlyRateCents === 'string') {
          hourlyRateCents = parseFloat(hourlyRateCents);
        }
        if (typeof dailyRateCents === 'string') {
          dailyRateCents = parseFloat(dailyRateCents);
        }
        const defaultRateMode: BookingRateMode =
          pricing.pricingModel === "daily" && dailyRateCents > 0
            ? "daily"
            : hourlyRateCents > 0
              ? "hourly"
              : "daily";
        setBookingRateMode(initialDateIso && initialSlots?.length && hourlyRateCents > 0 ? 'hourly' : defaultRateMode);
        setKitchenPricing({
          hourlyRate: hourlyRateCents,
          dailyRate: dailyRateCents,
          currency: pricing.currency || 'CAD',
          minimumBookingHours: pricing.minimumBookingHours ?? 0,
          platformCommissionRate: Math.max(0, Number(pricing.platformCommissionRate) || 0),
          preparationReminderHours: pricing.preparationReminderHours ?? 48,
          managerResponseBufferHours: pricing.managerResponseBufferHours ?? 1,
          timezone: pricing.timezone || DEFAULT_TIMEZONE,
        });
      } else {
        setLoadError(t("bookingErrorLoadKitchen", "We could not load this kitchen's pricing. Reload the page before booking."));
        setKitchenPricing({ hourlyRate: null, dailyRate: null, currency: 'CAD', minimumBookingHours: 0, platformCommissionRate: 0 });
      }

      // Fetch addons
      const addons = await fetchKitchenAddons(kitchen.id, authHeader);
      if (initialDateIso && initialEquipment) {
        const offered = new Set(addons.equipment.all.map((item: any) => item.id));
        setSelectedEquipmentIds(initialEquipment.split(',').map(Number).filter(id => Number.isSafeInteger(id) && offered.has(id)));
      }

      if (restore?.dateIso) {
        const [y, m, d] = restore.dateIso.split("-").map(Number);
        const restoredDate = new Date(y, m - 1, d);
        setSelectedDate(restoredDate);
        setSelectedDates([restore.dateIso]);
        setCalendarMonth(new Date(y, m - 1, 1));
        if (restore.slots?.length) {
          if (restore.slots.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
            toast({ title: ct('sweepText17'), description: ct('sweepText19'), variant: 'destructive' });
          } else {
            // Availability loading validates the complete draft before continuing.
            setSelectedSlots(restore.slots);
          }
        }
        setHideDateStep(true);
        // A restored draft is a fresh selection, not replay of its old checkout.
        setCurrentStep('slots');
      } else {
        setHideDateStep(false);
        setCurrentStep("calendar");
      }
    } catch (error) {
      logger.error('Error fetching kitchen data:', error);
      setLoadError(t("bookingErrorLoadKitchen", "We could not load this kitchen's pricing. Reload the page before booking."));
      setKitchenPricing({ hourlyRate: null, dailyRate: null, currency: 'CAD', minimumBookingHours: 0, platformCommissionRate: 0 });
      setHideDateStep(false);
      setCurrentStep("calendar");
    } finally {
      setIsFlowReady(true);
    }
  };

  const handleDateClick = (date: Date | undefined) => {
    if (!date) return;
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    if (normalized < today) return;
    if (!isDayAvailable(normalized)) return;
    setSelectedDate(normalized);
    setSelectedDates([localDateKey(normalized)]);
    setSelectedSlots([]);
  };

  const isDayAvailable = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (d < today || bookableThrough && toLocalDateString(d) > bookableThrough) return false;
    return dateAvailability[toLocalDateString(d)] === true;
  };

  const blockedDateReason = (date: Date) => {
    const key = localDateKey(date);
    const limitReason = dateSelectionReason(key, selectedDates, Math.min(dayRules.maxBookingDays ?? 7, 14));
    if (limitReason) return t(limitReason === 'count' ? 'mdCountLimit' : 'mdSpanLimit', { count: dayRules.maxBookingDays ?? 7 });
    if (date < today) return t('mdReasonPast');
    if (bookableThrough && key > bookableThrough) return t('mdReasonAdvance');
    const status = dateStatuses[key];
    if (selectedDates.includes(key)) return null;
    if (status?.hourly || status?.fullDay) return null;
    const reasons: Record<string, string> = { booked: 'mdReasonBooked', held: 'mdReasonBooked', closed: 'mdReasonClosed',
      notice: 'mdReasonNotice', beyond_advance_window: 'mdReasonAdvance', weekly_limit: 'mdReasonWeekly', buffer: 'mdReasonBuffer',
      clock_change: 'mdReasonClock', not_open_to_you: 'mdReasonAccess', maintenance: 'mdReasonMaintenance' };
    return t(reasons[status?.reason ?? ''] ?? 'mdReasonUnavailable');
  };
  const selectMultipleDates = (dates: Date[] | undefined) => {
    const keys = (dates ?? []).map(localDateKey).sort();
    setSelectedDates(keys);
    setSelectedDate(keys.length ? new Date(`${keys[0]}T12:00:00`) : null);
    setEditingDay(null);
    setDateAnnouncement(t('mdSelectedDays', { count: keys.length }));
  };

  const sortSelectedSlots = (slots: string[]) => {
    const windowStart = allSlots[0]?.time ?? slots[0];
    return windowStart ? sortTimesInOperatingWindow(slots, windowStart) : [...slots];
  };

  const updateSlotSelection = (
    setter: Dispatch<SetStateAction<string[]>>,
    slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }
  ) => {
    if (slot.isFullyBooked) {
      toast({
        title: t("toastSlotFullyBookedTitle", "Slot Fully Booked"),
        description: t("toastSlotFullyBookedDesc", "This time slot is already at maximum capacity."),
        variant: "destructive",
      });
      return;
    }

    setter(prev => {
      const next = prev.includes(slot.time) ? prev.filter(s => s !== slot.time) : [...prev, slot.time];
      if (maxSlotsPerChef != null && next.length > maxSlotsPerChef) {
        toast({
          title: t("toastLimitReachedTitle", "Limit reached"),
          description: t("toastLimitReachedDesc", { count: maxSlotsPerChef, defaultValue: `You can select up to ${maxSlotsPerChef} hour slot${maxSlotsPerChef > 1 ? 's' : ''} for this day.` }),
          variant: "destructive",
        });
        return prev;
      }
      if (next.length && validateKitchenSlotSelection(next, allSlots)) {
        toast({ title: ct('sweepText20'), description: CONSECUTIVE_SLOTS_MESSAGE, variant: 'destructive' });
        return prev;
      }
      return sortSelectedSlots(next);
    });
  };

  const handleSlotClick = (slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }) => {
    updateSlotSelection(setSelectedSlots, slot);
  };

  // Same locale-aware formatter as the slot buttons, so the summary reads "10:00 a.m." not "10:00 AM".
  const formatTime = (timeString: string) => formatClockTime(timeString, i18n.language);

  const formatSlotRange = (slotStartTime: string) => {
    return formatHourSlotRange(slotStartTime, i18n.language);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(i18n.language, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const hasEquipment = equipmentListings.all.length > 0;

  // Step configuration — date first; kitchen is auto-selected (not a step).
  // When a date was already chosen (preview), hide the Date step entirely.
  // Omit equipment when this kitchen has none.
  const steps = useMemo(() => {
    const all: StepMeta[] = [
      {
        key: "calendar",
        label: t("sheetStepDate", "Date"),
        subtext: t("sheetStepDateSubtext", "Pick your day"),
      },
      {
        key: "slots",
        label: t("sheetStepTime", "Time"),
        subtext: t("sheetStepTimeSubtext", "Choose hours"),
      },
      {
        key: "equipment",
        label: t("sheetStepEquipment", "Equipment"),
        subtext: t("sheetStepEquipmentSubtext", "Add gear"),
      },
      {
        key: "confirm",
        label: t("sheetStepConfirm", "Confirm"),
        subtext: t("sheetStepConfirmSubtext", "Review & pay"),
      },
    ];
    return all.filter((s) => {
      if (s.key === "calendar" && hideDateStep) return false;
      if (s.key === "equipment" && !hasEquipment) return false;
      return true;
    });
  }, [hideDateStep, hasEquipment, t]);

  const stepOrder = steps.map((s) => s.key);
  const currentStepIndex = Math.max(0, stepOrder.indexOf(currentStep));

  const goToStepRelative = (from: BookingStep, delta: 1 | -1): BookingStep | null => {
    const idx = stepOrder.indexOf(from);
    if (idx < 0) return null;
    return stepOrder[idx + delta] ?? null;
  };

  const orderedSelectedSlots = isMultiDay ? datedDays[0]?.slots.map(slot => slot.startTime) ?? []
    : bookingRateMode === 'daily' ? selectedSlots : sortSelectedSlots(selectedSlots);
  const firstWindowStart = isMultiDay ? dayResources[selectedDates[0]]?.windowStartTime : allSlots[0]?.time;
  const checkoutResponseDeadline = (() => {
    if (!selectedDate || !orderedSelectedSlots.length) return null;
    try {
      const zone = kitchenPricing?.timezone || DEFAULT_TIMEZONE;
      return formatResponseDeadline(responseDeadlineForBooking({ createdAt: new Date(), status: 'pending',
        bookingDate: toLocalDateString(selectedDate), startTime: orderedSelectedSlots[0], endTime: addHour(orderedSelectedSlots.at(-1)!),
        selectedSlots: orderedSelectedSlots, operatingWindowStartTime: firstWindowStart,
        // Same frozen policy the server uses: the kitchen must answer before the chef's free cancellation ends.
        cancellationPolicyHours: acceptedPolicy?.policy.noticeHours ?? null }, zone, kitchenPricing?.managerResponseBufferHours), i18n.language, zone);
    } catch { return null; }
  })();
  const hoursUntilVisit = (() => {
    if (!selectedDate || !orderedSelectedSlots.length) return null;
    try {
      const start = firstBookingVisitStart({ bookingDate: toLocalDateString(selectedDate), startTime: orderedSelectedSlots[0], endTime: addHour(orderedSelectedSlots.at(-1)!),
        selectedSlots: orderedSelectedSlots, operatingWindowStartTime: firstWindowStart, status: 'pending' } as any, kitchenPricing?.timezone || DEFAULT_TIMEZONE);
      return (start.getTime() - Date.now()) / 3_600_000;
    } catch { return null; }
  })();
  const preparationLeadHours = kitchenPricing?.preparationReminderHours ?? 48;
  const policyStartAt = (() => {
    if (!selectedDate || !orderedSelectedSlots.length || !acceptedPolicy) return undefined;
    try { return firstBookingVisitStart({ bookingDate: toLocalDateString(selectedDate), startTime: orderedSelectedSlots[0], endTime: addHour(orderedSelectedSlots.at(-1)!),
      selectedSlots: orderedSelectedSlots, operatingWindowStartTime: firstWindowStart, status: 'pending' } as any, acceptedPolicy.timezone).toISOString(); } catch { return undefined; }
  })();
  const selectionError = (times = selectedSlots) => validateKitchenSlotSelection(
    times, allSlots, bookingRateMode === 'hourly' ? Math.max(1, kitchenPricing?.minimumBookingHours ?? 0) : 1,
    bookingRateMode === 'hourly' ? (maxSlotsPerChef ?? Infinity) : Infinity,
  ) || (bookingRateMode === 'daily' && (!fullDayBookable || times.length !== allSlots.length)
    ? 'A daily booking must include the full available operating day.' : null);
  const requireValidSelection = () => {
    if (isMultiDay) {
      if (dateSetError) { setCheckoutError(dateSetError); setHideDateStep(false); setCurrentStep('calendar'); return false; }
      if (!daysLoading && !invalidDay) return true;
      const day = invalidDay?.date ?? selectedDates[0];
      setEditingDay(day);
      setCurrentStep('slots');
      setCheckoutError(t('mdReviewDay', { date: formatDate(new Date(`${day}T12:00:00`)) }));
      return false;
    }
    const error = selectionError();
    if (!error) return true;
    toast({ title: ct('sweepText21'), description: error, variant: 'destructive' });
    setCurrentStep('slots');
    return false;
  };
  const bookingTimeBlocks = bookingVisitBlocks(
    orderedSelectedSlots.map(startTime => ({ startTime, endTime: addHour(startTime) }))
  ).map(block => `${formatTime(block.startTime)} - ${formatTime(block.endTime)}`);
  const datedSummaryRows = isMultiDay ? datedPrices.map(day => ({
    date: formatDate(new Date(`${day.date}T12:00:00`)),
    hours: day.pricingMode === 'daily' ? t('sheetDailyRate') : day.slots.length
      ? `${formatTime(day.slots[0].startTime)} – ${formatTime(day.slots[day.slots.length - 1].endTime)}` : t('sheetChooseTime'),
    equipment: day.equipmentIds.map(id => equipmentName(equipmentListings.all.find(item => item.id === id) ?? {})).join(', '),
    subtotal: day.kitchenSubtotal + day.equipmentSubtotal,
  })) : undefined;

  // Redirect to Stripe Checkout
  const redirectToStripeCheckout = async () => {
    if (!selectedKitchen || !selectedDate || (!isMultiDay && selectedSlots.length === 0)) return;
    if (!acceptedPolicy) { setCheckoutError(policyT('cpError')); return; }
    if (bookingBlocked) return;
    if (!requireValidSelection()) return;
    setCheckoutError(null);

    // Enforce minimum booking hours (0 = no restriction)
    const minHours = kitchenPricing?.minimumBookingHours ?? 0;
    if (!isMultiDay && bookingRateMode === 'hourly' && minHours > 0 && selectedSlots.length < minHours) {
      toast({
        title: t("toastMinBookingRequiredTitle", "Minimum Booking Required"),
        description: t("toastMinBookingRequiredDesc", { minHours, selected: selectedSlots.length, defaultValue: `This kitchen requires a minimum of ${minHours} hour${minHours > 1 ? 's' : ''} per booking. You have selected ${selectedSlots.length}.` }),
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid penalties first
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast({
        title: t("toastUnpaidPenaltiesTitle", "Booking Blocked - Unpaid Penalties"),
        description: t("toastUnpaidPenaltiesDesc", { count: penaltyData.totalCount, amount: `$${totalOwed}`, defaultValue: `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.` }),
        variant: "destructive",
      });
      return;
    }

    setIsRedirectingToCheckout(true);
    try {
      const sortedSlots = bookingRateMode === 'daily'
        ? selectedSlots
        : sortSelectedSlots(selectedSlots);
      const startTime = sortedSlots[0];
      const lastSlot = sortedSlots[sortedSlots.length - 1];
      const endTime = addHour(lastSlot);

      const bookingDateStr = toLocalDateString(selectedDate);
      const [year, month, day] = bookingDateStr.split('-').map(Number);
      const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken() : '';

      const response = await fetch('/api/chef/bookings/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          kitchenId: selectedKitchen.id,
          // Selecting Checkout under the consent line is the acceptance (clickwrap); the server records the disclosure shown.
          cancellationPolicyAccepted: true,
          cancellationPolicyVersion: acceptedPolicy.policy.version,
          cancellationDisclosureVersion: isMultiDay ? DATED_DISCLOSURE_VERSION : CANCELLATION_DISCLOSURE_VERSION,
          ...(isMultiDay ? { days: datedDays } : {
          bookingDate: bookingDate.toISOString(),
          startTime,
          endTime,
          selectedSlots: sortedSlots.map(slot => ({
            startTime: slot,
            endTime: addHour(slot),
          })),
          pricingMode: bookingRateMode,
          selectedEquipmentIds: selectedEquipmentIds.length > 0 ? selectedEquipmentIds : undefined,
          }),
          specialNotes: notes,
          ...(replacesBookingId ? { replacesBookingId } : {}),
        }),
      });

      if (!response.ok) {
        const failure = await describeBookingFailure(response, failureFallback);
        // A refused eligibility (expired document, ended access) updates the notice at the top too.
        if (failure.refusedAccess) void queryClient.invalidateQueries({ queryKey: ['booking-eligibility', locationId] });
        throw new Error(failure.message);
      }

      const data = await response.json();
      
      // Redirect to Stripe Checkout
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl;
      } else {
        throw new Error(tt("noCheckoutUrl"));
      }
    } catch (error: any) {
      const message = error instanceof TypeError
        ? t("bookingErrorNetwork", "We could not reach Local Cooks. Check your connection and try again.")
        : error.message || t("toastCheckoutFailedDefaultDesc", "Failed to start checkout. Please try again.");
      setCheckoutError(message);
      toast({
        title: t("toastCheckoutFailedTitle", "Checkout Failed"),
        description: message,
        variant: "destructive",
      });
      setIsRedirectingToCheckout(false);
    }
  };


  // Handle free booking submission
  const handleFreeBookingSubmit = async () => {
    if (!selectedKitchen || !selectedDate || selectedSlots.length === 0) return;
    if (bookingBlocked) return;
    if (!requireValidSelection()) return;
    setCheckoutError(null);

    // Enforce minimum booking hours (0 = no restriction)
    const minHours = kitchenPricing?.minimumBookingHours ?? 0;
    if (bookingRateMode === 'hourly' && minHours > 0 && selectedSlots.length < minHours) {
      toast({
        title: t("toastMinBookingRequiredTitle", "Minimum Booking Required"),
        description: t("toastMinBookingRequiredDesc", { minHours, selected: selectedSlots.length, defaultValue: `This kitchen requires a minimum of ${minHours} hour${minHours > 1 ? 's' : ''} per booking. You have selected ${selectedSlots.length}.` }),
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid penalties first
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast({
        title: t("toastUnpaidPenaltiesTitle", "Booking Blocked - Unpaid Penalties"),
        description: t("toastUnpaidPenaltiesDesc", { count: penaltyData.totalCount, amount: `$${totalOwed}`, defaultValue: `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.` }),
        variant: "destructive",
      });
      return;
    }

    setIsProcessingBooking(true);

    const sortedSlots = bookingRateMode === 'daily'
      ? selectedSlots
      : sortSelectedSlots(selectedSlots);
    const startTime = sortedSlots[0];
    const lastSlot = sortedSlots[sortedSlots.length - 1];
    const endTime = addHour(lastSlot);

    const bookingDateStr = toLocalDateString(selectedDate);
    const [year, month, day] = bookingDateStr.split('-').map(Number);
    const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    createBooking.mutate(
      {
        kitchenId: selectedKitchen.id,
        bookingDate: bookingDate.toISOString(),
        startTime,
        endTime,
        pricingMode: bookingRateMode,
        selectedSlots: sortedSlots.map(slot => ({
          startTime: slot,
          endTime: addHour(slot),
        })),
        specialNotes: notes,
        selectedEquipmentIds: selectedEquipmentIds.length > 0 ? selectedEquipmentIds : undefined,
      },
      {
        onSuccess: (data: any) => {
          toast({
            title: t("toastBookingCreatedTitle", "Booking Created!"),
            description: t("toastBookingCreatedDesc", { count: selectedSlots.length, defaultValue: `Your ${selectedSlots.length} hour kitchen booking has been submitted successfully.` }),
          });
          setIsProcessingBooking(false);
          clearPersistedBookingPrefs();
          const bookingId = data?.id ?? data?.booking?.id;
          onComplete?.(typeof bookingId === "number" ? bookingId : undefined);
        },
        onError: (error: any) => {
          const message = error.message || t("toastBookingFailedDefaultDesc", "Failed to create booking. Please try again.");
          setCheckoutError(message);
          void queryClient.invalidateQueries({ queryKey: ['booking-eligibility', locationId] });
          toast({
            title: t("toastBookingFailedTitle", "Booking Failed"),
            description: message,
            variant: "destructive",
          });
          setIsProcessingBooking(false);
        },
      }
    );
  };

  // Content for each step - designed to fit without scrolling
  const renderStepContent = () => {
    // Loading State
    if (isLoadingKitchens) {
      return (
        <div className="grid flex-1 gap-4 p-4 sm:grid-cols-2" role="status" aria-label={t("sheetLoadingKitchens", "Loading kitchens...")}>
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 w-full rounded-xl" />)}
        </div>
      );
    }

    // No Kitchens
    if (locationKitchens.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Icon icon="mdi:office-building-outline" className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{t("sheetNoKitchensAtLocation", "No kitchens available at this location")}</p>
          </div>
        </div>
      );
    }

    // Waiting for kitchen auto-select + restore (date/slots) so we don't flash Date.
    if (!selectedKitchen || !isFlowReady) {
      return (
        <div className="grid flex-1 gap-4 p-4 sm:grid-cols-2" role="status" aria-label={t("sheetLoadingKitchens", "Loading kitchens...")}>
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 w-full rounded-xl" />)}
        </div>
      );
    }

    // Step: Date — kitchen-preview calendar (UICalendar + circular brand selection)
    if (currentStep === 'calendar' && selectedKitchen) {
      return (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Icon icon="mdi:calendar-month-outline" className="h-4 w-4 text-[#E10939]" aria-hidden />
                {t("sheetSelectDateTitle", "Select Date")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("sheetTapDateToContinue", "Tap an available date to continue")}
              </p>
            </div>
            {selectedDate && (
              <button
                type="button"
                className="shrink-0 text-sm font-medium text-muted-foreground hover:text-[#E10939]"
                onClick={() => {
                  setSelectedDate(null);
                  setSelectedDates([]);
                  setSelectedSlots([]);
                }}
              >
                {t("sheetClearButton", "Clear")}
              </button>
            )}
          </div>

          <div className="relative mx-auto w-full max-w-[640px] rounded-[1.35rem] border border-gray-100 bg-gray-50/40 p-2 sm:p-3">
            {isLoadingAvailability && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
                <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#E10939]" aria-hidden />
              </div>
            )}
            {bookableThrough && <p className="text-sm text-muted-foreground">{t("bookingBookableThrough", { defaultValue: "Bookable up to {date}", date: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || "en-CA", { dateStyle: "medium" }).format(new Date(`${bookableThrough}T12:00:00`)) })}</p>}
            {multipleAllowed ? <DatedCalendarContext.Provider value={{ reason: blockedDateReason, announce: setDateAnnouncement, locale: i18n.language }}>
              <p className="mb-2 text-sm text-muted-foreground">{t('mdSelectHelp', { count: Math.min(dayRules.maxBookingDays ?? 7, 14) })}</p>
              <UICalendar mode="multiple" numberOfMonths={2} pagedNavigation
                selected={selectedDates.map(date => new Date(`${date}T12:00:00`))} onSelect={selectMultipleDates}
                month={calendarMonth} onMonthChange={setCalendarMonth} disabled={date => !!blockedDateReason(date)}
                components={{ Day: DatedCalendarDay }}
                className="w-full bg-transparent p-1" classNames={{ ...BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES, day: `${BOOKING_CALENDAR_CLASS_NAMES.day} h-11 w-11 max-w-[44px]`, cell: 'relative h-11 p-0 text-center text-sm' }} />
              <p role="status" aria-live="polite" className="mt-2 text-sm">{dateAnnouncement || t('mdSelectedDays', { count: selectedDates.length })}</p>
              {dateSetError && <p role="alert" className="text-sm">{dateSetError}</p>}
            </DatedCalendarContext.Provider> : <UICalendar
              mode="single"
              numberOfMonths={2}
              pagedNavigation
              selected={selectedDate ?? undefined}
              onSelect={handleDateClick}
              month={calendarMonth}
              onMonthChange={(month) => {
                setCalendarMonth(new Date(month.getFullYear(), month.getMonth(), 1));
              }}
              disabled={(date) => !isDayAvailable(date)}
              className="w-full bg-transparent p-1"
              classNames={BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES}
            />}
          </div>

          {selectedDate && (
            <div className="mx-auto w-full max-w-[640px] rounded-[1.35rem] border border-[#E10939]/20 bg-[#E10939]/5 px-3 py-2.5">
              <p className="text-sm font-semibold text-gray-900">
                {isMultiDay ? selectedDates.map(date => formatDate(new Date(`${date}T12:00:00`))).join(' · ') : formatDate(selectedDate)}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isLoadingSlots
                  ? t("sheetLoadingSlotsText", "Loading time slots…")
                  : t("sheetSlotsAvailable", {
                      count: allSlots.length,
                      defaultValue: `${allSlots.length} time slot${allSlots.length !== 1 ? "s" : ""} available`,
                    })}
              </p>
            </div>
          )}
        </div>
      );
    }

    // Step: Time Slots
    if (currentStep === 'slots' && selectedKitchen && selectedDate) {
      const hasHourlyRate = Number(kitchenPricing?.hourlyRate || 0) > 0;
      const hasDailyRate = Number(kitchenPricing?.dailyRate || 0) > 0;
      const isFullDayAvailable = fullDayBookable;
      return (
        <div className="flex h-full min-h-[16rem] flex-col gap-4">
          {isMultiDay && <div className="space-y-2 rounded-xl border p-3">
            <Button variant="outline" aria-pressed={!editingDay} className="min-h-11" onClick={() => setEditingDay(null)}>{t('mdSameHours')}</Button>
            <label className="block text-sm font-medium" htmlFor="change-booking-day">{t('mdChangeOneDay')}</label>
            <select id="change-booking-day" className="min-h-11 w-full rounded-lg border bg-white px-3" value={editingDay ?? ''}
              onChange={event => setEditingDay(event.target.value || null)}>
              <option value="">{t('mdSameHours')}</option>
              {selectedDates.map(date => <option key={date} value={date}>{formatDate(new Date(`${date}T12:00:00`))}</option>)}
            </select>
            {editingDay && dayHours[editingDay] && <Button variant="ghost" onClick={() => setDayHours(current => { const next = { ...current }; delete next[editingDay]; return next; })}>{t('mdUseSameHours')}</Button>}
            {daysLoading && <p role="status">{t('sheetLoadingSlotsText')}</p>}
            {invalidDay && <p className="text-sm" role="status">{t('mdReviewDay', { date: formatDate(new Date(`${invalidDay.date}T12:00:00`)) })}</p>}
          </div>}
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Icon icon="mdi:clock-outline" className="h-4 w-4 text-[#E10939]" aria-hidden />
                {t("sheetSelectTimeTitle", "Select Time")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {formatDate(pickerDate ?? selectedDate)}
                {bookingRateMode === "hourly" && kitchenPricing?.minimumBookingHours && kitchenPricing.minimumBookingHours > 0
                  ? ` · ${t("sheetMinHourBadge", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Min ${kitchenPricing.minimumBookingHours}hr` })}`
                  : ""}
                {bookingRateMode === "hourly" && maxSlotsPerChef != null
                  ? ` · ${t("sheetMaxHoursBadge", { maxHours: maxSlotsPerChef, defaultValue: `Max ${maxSlotsPerChef} hours` })}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-1" data-testid="setup-cleanup-hint">{t("sxbSetupCleanupHint", "Include setup and cleanup in your booking time.")}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-muted-foreground hover:text-[#E10939]"
              onClick={() => {
                setHideDateStep(false);
                setCurrentStep("calendar");
              }}
            >
              {t("sheetChangeDate", "Change date")}
            </button>
          </div>

          {hasHourlyRate && hasDailyRate ? (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("sheetRateTypeLabel", "Booking rate")}>
              {(["hourly", "daily"] as const).map((mode) => {
                const selected = bookingRateMode === mode;
                const rate = mode === "hourly" ? kitchenPricing?.hourlyRate : kitchenPricing?.dailyRate;
                const disabled = mode === "daily" && !isFullDayAvailable;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => {
                      setBookingRateMode(mode);
                      setSelectedSlots(mode === "daily"
                        ? allSlots.map((slot) => slot.time)
                        : []);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-[#E10939] bg-[#FFF3F5] text-[#E10939]"
                        : "border-gray-200 bg-white text-gray-700 hover:border-[#E10939]/40",
                      disabled && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <span className="block text-sm font-semibold">
                      {mode === "hourly" ? t("sheetHourlyRate", "Hourly") : t("sheetDailyRate", "Full day")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatCurrency(rate || 0)}{mode === "hourly" ? t("sheetPerHour", "/hour") : t("sheetPerDay", "/day")}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {bookingRateMode === "daily" ? (
            <div className="rounded-xl border border-[#E10939]/20 bg-[#FFF8F9] px-3 py-3">
              <p className="text-sm font-semibold text-gray-900">{t("sheetFullDaySelected", "Full-day booking")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("sheetFullDaySelectedDesc", "All available operating hours for this date are included.")}
              </p>
            </div>
          ) : null}

          {isLoadingSlots ? (
            <div
              className="grid flex-1 content-center grid-cols-2 gap-2.5 sm:grid-cols-3"
              role="status"
              aria-label={t("sheetLoadingSlotsAria", "Loading available time slots")}
            >
              {Array.from({ length: 9 }).map((_, idx) => (
                <Skeleton key={idx} className="h-11 rounded-xl bg-muted/70" />
              ))}
            </div>
          ) : allSlots.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-[1.35rem] border border-dashed py-10 text-center">
              <div>
                <Icon icon="mdi:clock-outline" className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" aria-hidden />
                <p className="text-sm text-muted-foreground">{t("sheetNoAvailableHours", "No available hours on this day")}</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {bookingRateMode === "hourly" && <p className="text-sm text-muted-foreground">{ct('sweepLabel20')}</p>}
              {kitchenPricing?.minimumBookingHours && kitchenPricing.minimumBookingHours > 1 && selectedSlots.length === 0 && (
                <div className="shrink-0 rounded-lg border bg-muted/30 px-3 py-2 flex items-start gap-2">
                  <Icon icon="mdi:clock-outline" className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    <strong>{t("sheetMinBookingNoticeBold", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Minimum ${kitchenPricing.minimumBookingHours}-hour booking.` })}</strong>{" "}
                    {t("sheetMinBookingNoticeSelect", { minHours: kitchenPricing.minimumBookingHours })}
                  </p>
                </div>
              )}
              <div className={cn("grid flex-1 content-center grid-cols-2 gap-2.5 sm:grid-cols-3", bookingRateMode === "daily" && "pointer-events-none opacity-70")}>
                {allSlots.map((slot) => {
                  const isSelected = isMultiDay && bookingRateMode === 'daily' ? fullDayBookable : selectedSlots.includes(slot.time);
                  const isFullyBooked = slot.isFullyBooked;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => handleSlotClick(slot)}
                      disabled={isFullyBooked}
                      className={cn(
                        "flex min-h-[44px] w-full items-center justify-center rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition-colors",
                        isSelected && "bg-[#E10939] text-white border-[#E10939]",
                        !isSelected && !isFullyBooked && "bg-white text-gray-700 border-gray-200 hover:border-[#E10939]/40",
                        isFullyBooked && "bg-muted/50 text-muted-foreground cursor-not-allowed border-transparent"
                      )}
                    >
                      <span>
                        {formatSlotRange(slot.time)}{slot.isFullyBooked && <span className="ml-1 text-xs no-underline"> · {t("wfbBooked")}</span>}
                        {slot.capacity > 1 && !isFullyBooked ? (
                          <span className={cn("ml-1.5", isSelected ? "text-white/80" : "text-muted-foreground")}>
                            · {t("sheetSlotsLeft", { count: slot.available, defaultValue: `${slot.available} left` })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Step: Equipment
    if (currentStep === "equipment" && selectedKitchen) {
      const EQUIPMENT_PREVIEW = 5;
      const includedPreview = equipmentListings.included.slice(0, EQUIPMENT_PREVIEW);
      const rentalPreview = equipmentListings.rental.slice(0, EQUIPMENT_PREVIEW);
      const includedRemaining = Math.max(0, equipmentListings.included.length - includedPreview.length);
      const rentalRemaining = Math.max(0, equipmentListings.rental.length - rentalPreview.length);
      const showIncluded = equipmentListings.included.length > 0;
      const showRental = equipmentListings.rental.length > 0;

      return (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{t("sheetEquipmentTitle", "Equipment")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("sheetEquipmentBrowseDesc", "See what is included, then add any optional rentals you need.")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={chefOutlineCtaClass("min-h-11 shrink-0")}
              onClick={() => {
                setEquipmentInventoryModal(null);
                setPendingEquipmentIds(selectedEquipmentIds);
                setEquipmentModalOpen(true);
              }}
              disabled={equipmentListings.rental.length === 0}
            >
              <Icon icon={EQUIPMENT_ICON_NAME} width={17} height={17} className="mr-1.5" aria-hidden />
              {selectedEquipmentIds.length > 0 ? `Edit (${selectedEquipmentIds.length})` : t("sheetSelectEquipment", "Select equipment")}
            </Button>
          </div>

          {isLoadingAddons ? (
            <div className="flex justify-center py-12">
              <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#E10939]" aria-hidden />
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-6",
                showIncluded && showRental ? "sm:grid-cols-2" : "grid-cols-1"
              )}
            >
              {showIncluded ? (
                <div className="min-w-0">
                  <InventoryPreviewList
                    title={t("sheetIncludedLabel", "Included")}
                    subtitle={t("sheetIncludedEquipmentDesc", "Included at no extra charge.")}
                    items={includedPreview}
                    rental={false}
                    columns={1}
                  />
                  {includedRemaining > 0 ? (
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center pb-1 text-sm font-semibold text-[#E10939] hover:text-[#D40E38]"
                      onClick={() => {
                        setEquipmentModalOpen(false);
                        setEquipmentInventoryModal("included");
                      }}
                    >
                      {t("sheetShowAllButton", { defaultValue: "Show all" })}{" "}
                      <span className="ml-1">+{includedRemaining}</span>
                      <Icon icon="mdi:chevron-right" className="ml-1 h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {showRental ? (
                <div className="min-w-0">
                  <InventoryPreviewList
                    title={t("sheetOptionalRentalsLabel", "Optional rentals")}
                    subtitle={t("sheetRentalEquipmentDesc", "Optional rentals for this kitchen session.")}
                    items={rentalPreview}
                    selectedIds={selectedEquipmentIds}
                    onToggle={(id) => setSelectedEquipmentIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
                    rental
                    columns={1}
                  />
                  {rentalRemaining > 0 ? (
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center pb-1 text-sm font-semibold text-[#E10939] hover:text-[#D40E38]"
                      onClick={() => {
                        setEquipmentModalOpen(false);
                        setEquipmentInventoryModal("rental");
                      }}
                    >
                      {t("sheetShowAllButton", { defaultValue: "Show all" })}{" "}
                      <span className="ml-1">+{rentalRemaining}</span>
                      <Icon icon="mdi:chevron-right" className="ml-1 h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {isMultiDay && <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('mdEquipmentHelp')}</p>
            {datedDays.map(day => <fieldset key={day.date} className="space-y-2 rounded-xl border p-3">
              <legend className="px-1 text-sm font-semibold">{formatDate(new Date(`${day.date}T12:00:00`))}</legend>
              {equipmentListings.all.filter(item => dayResources[day.date]?.equipmentIds.includes(item.id)).map(item => {
                const chosen = selectedEquipmentIds.includes(item.id) || equipmentListings.included.some(included => included.id === item.id);
                return <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" checked={day.equipmentIds.includes(item.id)} onChange={event => {
                    if (!chosen) setSelectedEquipmentIds(current => [...current, item.id]);
                    setDayEquipmentExcluded(current => ({ ...current, [day.date]: event.target.checked
                      ? (current[day.date] ?? []).filter(id => id !== item.id) : [...(current[day.date] ?? []), item.id] }));
                  }} />
                  {equipmentName(item)} · {formatCurrency(item.sessionRate || 0)}
                </label>;
              })}
            </fieldset>)}
          </div>}
        </div>
      );
    }

    // Step: Confirm — editable choices only (kitchen + price live in the left rail)
    if (currentStep === 'confirm' && selectedKitchen && selectedDate && (isMultiDay || selectedSlots.length > 0)) {
      const editLinkClass =
        "inline-flex items-center gap-1 text-sm font-medium text-[#E10939] hover:text-[#c90832] shrink-0";

      return (
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {t("sheetStepConfirm", "Confirm")}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t("sheetStepConfirmSubtext", "Review and pay")}
            </p>
          </div>

          {isMultiDay && <div className="space-y-3 rounded-[1.35rem] border bg-white p-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { setHideDateStep(false); setCurrentStep('calendar'); }}>{t('sheetChangeDate')}</Button>
              <Button variant="outline" onClick={() => { setEditingDay(null); setCurrentStep('slots'); }}>{t('mdChangeHours')}</Button>
              {hasEquipment && <Button variant="outline" onClick={() => setCurrentStep('equipment')}>{t('sheetEquipmentTitle')}</Button>}
            </div>
            <BookingPriceSummary days={datedSummaryRows} kitchenSubtotal={datedKitchenSubtotal} equipmentSubtotal={datedEquipmentSubtotal}
              taxRatePercent={selectedKitchen?.taxRatePercent || 0} taxLabel={selectedKitchen?.taxLabel}
              serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0} currency={kitchenPricing?.currency || 'CAD'} />
          </div>}
          {!isMultiDay && <div className="overflow-hidden rounded-[1.35rem] border divide-y bg-white">
            <div className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon icon="mdi:calendar-month-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#E10939]" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("sheetDateLabel", "Date")}
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{formatDate(selectedDate)}</p>
                </div>
              </div>
              <Popover
                open={confirmDatePopoverOpen}
                onOpenChange={(open) => {
                  setConfirmDatePopoverOpen(open);
                  if (open && selectedDate) {
                    setCalendarMonth(
                      new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
                    );
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button type="button" className={editLinkClass} aria-label={t("sheetEditDate", "Edit date")}>
                    <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                    {t("sheetEdit", "Edit")}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
                  <div className="relative w-[300px] p-2">
                    {isLoadingAvailability && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/60">
                        <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#E10939]" aria-hidden />
                      </div>
                    )}
                    {bookableThrough && <p className="text-sm text-muted-foreground">{t("bookingBookableThrough", { defaultValue: "Bookable up to {date}", date: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || "en-CA", { dateStyle: "medium" }).format(new Date(`${bookableThrough}T12:00:00`)) })}</p>}
            <UICalendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        if (!date) return;
                        const normalized = new Date(date);
                        normalized.setHours(0, 0, 0, 0);
                        if (!isDayAvailable(normalized)) return;
                        setConfirmDatePopoverOpen(false);
                        if (selectedDate && selectedDate.getTime() === normalized.getTime()) return;
                        setSelectedDate(normalized);
                        setSelectedDates([localDateKey(normalized)]);
                        setSelectedSlots([]);
                        setCalendarMonth(new Date(normalized.getFullYear(), normalized.getMonth(), 1));
                        // New day needs new times — skip calendar step, go straight to slots
                        setCurrentStep("slots");
                      }}
                      month={calendarMonth}
                      onMonthChange={(month) => {
                        setCalendarMonth(new Date(month.getFullYear(), month.getMonth(), 1));
                      }}
                      disabled={(date) => !isDayAvailable(date)}
                      className="w-full bg-transparent p-1"
                      classNames={BOOKING_CALENDAR_CLASS_NAMES}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon icon="mdi:clock-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#E10939]" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("sheetBookingTimeLabel", "Booking Time")}
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{bookingTimeBlocks.join(', ')}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t("sheetHoursCount", { count: selectedSlots.length, defaultValue: `${selectedSlots.length} hours` })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={editLinkClass}
                onClick={() => {
                  setPendingTimeSlots(selectedSlots);
                  setTimeModalOpen(true);
                }}
              >
                <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                {t("sheetEdit", "Edit")}
              </button>
            </div>

            {hasEquipment && selectedEquipmentIds.length > 0 ? (
              <div className="flex items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{t("sheetEquipmentTitle", "Equipment")}</p>
                  <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {equipmentPricing.items.length ? equipmentPricing.items.map((item, index) => <div key={index} className="flex justify-between gap-4">
                      <span>{item.name}</span><span className="shrink-0 tabular-nums">{formatCurrency(item.rate)}</span>
                    </div>) : t("sheetNoRentalsSelected")}
                  </div>
                </div>
                <button
                  type="button"
                  className={editLinkClass}
                  onClick={() => {
                    setEquipmentInventoryModal(null);
                    setPendingEquipmentIds(selectedEquipmentIds);
                    setEquipmentModalOpen(true);
                  }}
                >
                  <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                  {t("sheetEdit", "Edit")}
                </button>
              </div>
            ) : null}
          </div>}

          <div>
            <label className="mb-2 block text-sm font-medium">
              {t("sheetSpecialNotesLabel", "Special Notes (Optional)")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("sheetSpecialNotesPlaceholder", "Any special requirements...")}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-[#E10939] focus:ring-2 focus:ring-[#E10939]/30"
            />
          </div>

          <section className="rounded-[1.35rem] border bg-muted/30 p-4" data-testid="what-happens-next">
            <h4 className="text-sm font-semibold text-gray-900">{t("sheetWhatNextTitle", "What happens next")}</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{checkoutResponseDeadline ? t("sheetResponseDeadline", { deadline: checkoutResponseDeadline, defaultValue: "The kitchen has until {deadline} to respond." }) : t("sheetResponseDeadlineOnPage", "Your booking page will show when the kitchen needs to respond.")}</li>
              <li>{isMultiDay ? t('mdCardHold') : t("sheetWhatNextCharge", "You are charged only if they accept. Until then your card is just on hold.")}</li>
              <li>{hoursUntilVisit !== null && hoursUntilVisit <= preparationLeadHours
                ? t("sheetPreparationLeadLate", "Arrival details are shared as soon as the kitchen accepts.")
                : t("sheetPreparationLead", { hours: preparationLeadHours, defaultValue: "Arrival details are shared {hours} hours before your visit, once the kitchen accepts." })}</li>
            </ol>

          </section>
        </div>
      );
    }

    return null;
  };

  // Sticky order summary for the left rail (desktop) + mobile footer strip
  const renderPriceBreakdown = (variant: "rail" | "mobile" = "rail") => {
    const hasAddons = selectedEquipmentIds.length > 0;
    const hasTimeSlots = selectedSlots.length > 0;
    const showDetails = selectedKitchen && (hasAddons || hasTimeSlots);

    if (variant === "mobile") {
      if (!showDetails) {
        if (!selectedKitchen) return null;
        return (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Icon icon="mdi:clock-outline" className="size-4 text-[#E10939]" aria-hidden />
            <span>{t("sheetPriceHint", "Select time to see your total")}</span>
          </div>
        );
      }
      return (
        <details className="mb-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span className="underline underline-offset-4">{t("bpsPriceBreakdown")}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(grandTotal)} {kitchenPricing?.currency || "CAD"}</span>
          </summary>
          <BookingPriceSummary days={datedSummaryRows} kitchenSubtotal={isMultiDay ? datedKitchenSubtotal : estimatedPrice?.basePrice || 0} equipmentSubtotal={isMultiDay ? datedEquipmentSubtotal : equipmentPricing.subtotal}
            taxRatePercent={selectedKitchen?.taxRatePercent || 0} taxLabel={selectedKitchen?.taxLabel}
            serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0} currency={kitchenPricing?.currency || "CAD"}
            equipmentItems={equipmentPricing.items.map(item => ({ name: item.name, priceCents: item.rate }))} />
        </details>
      );
    }

    // Desktop rail
    return (
      <div className="rounded-[1.35rem] border bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-base font-semibold text-muted-foreground">
            <Icon icon="mdi:receipt-text-outline" className="h-4 w-4 text-[#E10939]" aria-hidden />
            {t("sheetOrderSummaryLabel", "Booking Summary")}
          </span>
          {selectedKitchen && (bookingRateMode === "daily" ? kitchenPricing?.dailyRate : kitchenPricing?.hourlyRate) != null ? (
            <InfoChip variant="count" icon={<Icon icon="mdi:cash-clock" className="!text-black" />}>
              {formatCurrency((bookingRateMode === "daily" ? kitchenPricing?.dailyRate : kitchenPricing?.hourlyRate) || 0)}
              {bookingRateMode === "daily" ? t("sheetPerDay", "/day") : t("sheetPerHour", "/hour")}
            </InfoChip>
          ) : null}
        </div>

        {!showDetails ? (
          <div className="rounded-xl border border-dashed bg-muted/25 px-3 py-4 text-center">
            <span className="mx-auto flex size-8 items-center justify-center rounded-full bg-white text-[#E10939] shadow-sm">
              <Icon icon={selectedDate ? "mdi:clock-outline" : "mdi:calendar-month-outline"} className="size-4" aria-hidden />
            </span>
            <p className="mt-2 text-sm font-medium text-gray-900">
              {selectedDate ? t("sheetChooseTime", "Choose a time") : t("sheetChooseDate", "Choose a date")}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("sheetPriceHint", "Select time to see your total")}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {selectedDate && currentStep !== "confirm" && !isMultiDay && (
              <div className="mb-2 grid grid-cols-[0.78fr_1.22fr] gap-2 border-b pb-2">
                <div className="flex items-start gap-2.5">
                  <Icon icon="mdi:calendar-month-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#E10939]" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">
                      {t("sheetDateLabel", "Date")}
                    </p>
                    <p className="text-sm font-semibold text-gray-900">{formatDate(selectedDate)}</p>
                  </div>
                </div>
                {selectedSlots.length > 0 && (
                  <div className="flex items-start gap-2.5">
                    <Icon icon="mdi:clock-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#E10939]" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-muted-foreground">
                        {t("sheetTimeLabel", "Time")}
                      </p>
                      <p className="text-sm font-medium leading-snug text-gray-900">
                        {bookingTimeBlocks.slice(0, 2).join(", ")}
                        {bookingTimeBlocks.length > 2 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="ml-1 font-semibold text-[#E10939] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E10939]" aria-label={t("sheetShowAllTimeSlots", "Show all selected time slots")}>…</button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
                              <p className="mb-2 text-sm font-semibold">{t("sheetBookingTimeLabel", "Booking Time")}</p>
                              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                                {orderedSelectedSlots.map((slot) => <li key={slot}>{formatSlotRange(slot)}</li>)}
                              </ul>
                            </PopoverContent>
                          </Popover>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <BookingPriceSummary
              days={datedSummaryRows}
              kitchenSubtotal={isMultiDay ? datedKitchenSubtotal : estimatedPrice?.basePrice || 0}
              equipmentSubtotal={isMultiDay ? datedEquipmentSubtotal : equipmentPricing.subtotal}
              equipmentItems={equipmentPricing.items.map(item => ({ name: item.name, priceCents: item.rate }))}
              taxRatePercent={selectedKitchen?.taxRatePercent || 0}
              taxLabel={selectedKitchen?.taxLabel}
              serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0}
              currency={kitchenPricing?.currency || "CAD"}
            />
          </div>
        )}
      </div>
    );
  };

  const clearPersistedBookingPrefs = () => {
    for (const kitchen of locationKitchens) {
      const id = kitchen?.id;
      if (id == null) continue;
      try {
        sessionStorage.removeItem(`kitchen_dates_${id}`);
        sessionStorage.removeItem(`kitchen_booking_prefs_${id}`);
        sessionStorage.removeItem(`kitchen_booking_days_${id}`);
        notifyBookingPrefsChanged(String(id));
      } catch {
        /* ignore */
      }
    }
  };

  const confirmCancelBooking = () => {
    clearPersistedBookingPrefs();
    setCancelConfirmOpen(false);
    const proceed = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    if (proceed) proceed();
    else onCancel();
  };

  const requestLeave = useCallback((proceed?: () => void) => {
    pendingLeaveRef.current = proceed ?? null;
    setCancelConfirmOpen(true);
  }, []);

  useEffect(() => {
    registerLeaveGuard?.(requestLeave);
    return () => registerLeaveGuard?.(null);
  }, [registerLeaveGuard, requestLeave]);

  const confirmDiscardModalChanges = () => {
    if (discardModal === "equipment") {
      setPendingEquipmentIds(selectedEquipmentIds);
      setEquipmentModalOpen(false);
    } else if (discardModal === "time") {
      setPendingTimeSlots(selectedSlots);
      setTimeModalOpen(false);
    }
    setDiscardModal(null);
  };

  const goToPreviousStep = () => {
    const prev = goToStepRelative(currentStep, -1);
    if (prev) setCurrentStep(prev);
  };

  const goToNextStep = () => {
    if (currentStep !== 'calendar' && !requireValidSelection()) return;
    const next = goToStepRelative(currentStep, 1);
    if (next) setCurrentStep(next);
  };

  const canGoPrevious = currentStepIndex > 0;

  const previousButton = canGoPrevious ? (
    <Button
      type="button"
      variant="outline"
      className={chefOutlineCtaClass("min-h-[44px] min-w-0 flex-1 px-3 sm:px-5")}
      onClick={goToPreviousStep}
      disabled={isRedirectingToCheckout || isProcessingBooking || createBooking.isPending}
    >
      <Icon icon="mdi:arrow-left" className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" aria-hidden />
      {t("sheetPreviousButton", "Previous")}
    </Button>
  ) : null;

  const cancelButton = (
    <Button
      type="button"
      variant="ghost"
      className="min-h-[44px] shrink-0 rounded-xl"
      onClick={() => requestLeave()}
      disabled={isRedirectingToCheckout || isProcessingBooking || createBooking.isPending}
    >
      {t("sheetCancelButton", "Cancel")}
    </Button>
  );

  const continueButtonLabel = () => {
    if (currentStep === "calendar") {
      return selectedDate
        ? t("sheetSelectTimeSlotsButton", "Choose hours")
        : t("sheetSelectDateToContinueButton", "Choose a date");
    }
    if (currentStep === "slots") {
      return (isMultiDay ? !invalidDay : selectedSlots.length > 0)
        ? t("sheetContinueButton", "Continue")
        : t("sheetSelectTimeSlotsToContinueButton", "Choose your hours");
    }
    if (currentStep === "equipment") {
      const next = goToStepRelative(currentStep, 1);
      if (next === "confirm") return t("sheetContinueToConfirmButton", "Continue to confirm");
      return t("sheetContinueButton", "Continue");
    }
    return t("sheetContinueButton", "Continue");
  };

  const continueDisabled =
    (currentStep === "calendar" && (!selectedDate || !isDayAvailable(selectedDate) || !!dateSetError)) ||
    (currentStep === "slots" && (isMultiDay ? daysLoading : selectedSlots.length === 0)) ||
    (currentStep === "equipment" && isLoadingAddons) ||
    bookingBlocked;

  const renderStepActions = () => {
    if (!isFlowReady) {
      return <div className="flex gap-3">{cancelButton}</div>;
    }

    if (currentStep === "confirm") {
      return (
        <div className="space-y-3">
          {!isMultiDay && <div className="lg:hidden">{renderPriceBreakdown("mobile")}</div>}
          {(grandTotal > 0 || isMultiDay) && <CheckoutCancellationDisclosure multiDay={isMultiDay} policy={acceptedPolicy} startAt={policyStartAt} detailsOpen={policyDetailsOpen} onDetailsOpenChange={setPolicyDetailsOpen} detailsId="checkout-cancellation-details" />}
          <div className="grid grid-cols-2 gap-3 sm:flex [&>button:first-child]:col-span-2 [&>button:first-child]:sm:col-auto">
            {cancelButton}
            {previousButton}
            <Button
              className={chefPrimaryCtaClass("min-w-0 flex-1 min-h-[44px] px-3 sm:px-5")}
              // Guarded rather than disabled: an unverified chef gets the gate with
              // a way forward instead of a dead button.
              onClick={() =>
                guard(() =>
                  grandTotal > 0 || isMultiDay ? redirectToStripeCheckout() : handleFreeBookingSubmit()
                )
              }
              disabled={bookingBlocked || createBooking.isPending || isRedirectingToCheckout || isProcessingBooking || (grandTotal > 0 || isMultiDay) && !acceptedPolicy || isMultiDay && (daysLoading || !!invalidDay)}
            >
              {createBooking.isPending || isRedirectingToCheckout || isProcessingBooking ? (
                <>
                  <Icon icon="mdi:loading" className="mr-1.5 sm:mr-2 h-4 w-4 animate-spin flex-shrink-0" aria-hidden />
                  <span className="truncate">{isRedirectingToCheckout ? t("sheetRedirectingButton", "Redirecting...") : t("sheetBookingEllipsisButton", "Booking...")}</span>
                </>
              ) : grandTotal > 0 ? (
                <>
                  <Icon icon="mdi:credit-card-outline" className="mr-1.5 sm:mr-2 h-4 w-4 flex-shrink-0" aria-hidden />
                  <span className="truncate">{t("sheetCheckoutButton", "Checkout")}</span>
                </>
              ) : (
                <>
                  <Icon icon="mdi:check" className="mr-1.5 sm:mr-2 h-4 w-4 flex-shrink-0" aria-hidden />
                  <span className="truncate">{t("sheetConfirmBookingButton", "Confirm Booking")}</span>
                </>
              )}
            </Button>
          </div>
          {replacesBookingId && replacedRequest ? <ChangeRequestConsentLine request={replacedRequest} /> : null}
          {grandTotal > 0 && acceptedPolicy && <CheckoutConsentNotice buttonLabel={t("sheetCheckoutButton", "Checkout")} onShowPolicy={showPolicyDetails} />}
        </div>
      );
    }

    if (
      currentStep === "calendar" ||
      currentStep === "slots" ||
      currentStep === "equipment"
    ) {
      return (
        <>
          <div className="lg:hidden">{renderPriceBreakdown("mobile")}</div>
          <div className="grid grid-cols-2 gap-3 sm:flex [&>button:first-child]:col-span-2 [&>button:first-child]:sm:col-auto">
            {cancelButton}
            {previousButton}
            <Button
              className={chefPrimaryCtaClass(cn("h-auto min-h-[44px] min-w-0 flex-1 whitespace-normal px-3 py-2 text-center leading-tight sm:px-5", !canGoPrevious && "col-span-2 sm:col-auto"))}
              onClick={goToNextStep}
              disabled={continueDisabled}
            >
              {continueButtonLabel()}
              <Icon icon="mdi:arrow-right" className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          </div>
        </>
      );
    }

    return <div className="flex gap-3">{cancelButton}</div>;
  };

  return (
    <>
      <div className="space-y-4 lg:flex lg:h-[calc(100dvh-9rem)] lg:flex-col lg:space-y-0 lg:gap-4 lg:overflow-hidden">
        <BookingEligibilityBanner eligibility={eligibility} locationName={locationName} />
        {replacesBookingId && replacedRequest ? <ChangeRequestBanner request={replacedRequest} /> : null}
        {/* ReUI c-stepper-10 — equal columns, title + description, line separators */}
        {isFlowReady ? (
          <Stepper
            value={currentStepIndex + 1}
            indicators={{
              completed: <Icon icon="mdi:check" className="size-3.5" aria-hidden />,
              loading: <Icon icon="mdi:loading" className="size-3.5 animate-spin" aria-hidden />,
            }}
            className="w-full rounded-[1.35rem] border bg-white px-3 py-3 shadow-sm sm:px-5"
            aria-label={t("sheetBookingStepsAria", "Booking steps")}
            role="group"
            aria-orientation={undefined}
          >
            {/* Progress display only (steps aren't clickable); the caption below announces the current step. */}
            <StepperNav aria-hidden className="w-full flex-row items-start">
              {steps.map((step, index) => (
                <StepperItem
                  key={step.key}
                  step={index + 1}
                  className="relative flex-row items-start"
                >
                  <StepperTrigger
                    tabIndex={-1}
                    aria-label={step.label}
                    className="pointer-events-none flex shrink-0 items-start justify-start gap-1.5 rounded-none text-left"
                  >
                    <StepperIndicator className="mt-0.5 shrink-0">{index + 1}</StepperIndicator>
                    <div className="hidden min-w-0 text-left sm:block">
                      <StepperTitle className="text-base font-semibold">
                        {step.label}
                      </StepperTitle>
                      <StepperDescription className="mt-0.5 hidden leading-snug sm:block">
                        {step.subtext}
                      </StepperDescription>
                    </div>
                  </StepperTrigger>
                  {index < steps.length - 1 ? (
                    <StepperSeparator className="mx-2 mt-3 h-0.5 min-w-[0.75rem] flex-1 self-start sm:mx-2.5" />
                  ) : null}
                </StepperItem>
              ))}
            </StepperNav>
            <p className="mt-2 text-center text-sm font-medium sm:sr-only" aria-live="polite">{steps.find(step => step.key === currentStep)?.label}</p>
          </Stepper>
        ) : (
          <Skeleton className="h-[4.5rem] w-full rounded-xl" />
        )}

        <div className="flex flex-col gap-0 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch lg:gap-6">
          {/* Left rail: kitchen details + sticky price (desktop) */}
          <aside className="hidden w-[340px] shrink-0 flex-col lg:flex lg:h-full">
            <div className="mb-4">
              {selectedKitchen ? (
                <BookingPlaceContext
                  kitchen={selectedKitchen}
                  locationName={locationName}
                  locationAddress={locationAddress}
                  onPolicyOpen={() => setCancellationPolicyOpen(true)}
                />
              ) : (
                <Skeleton className="h-40 w-full rounded-2xl" />
              )}
            </div>
            <div className="mt-auto pt-2">{renderPriceBreakdown("rail")}</div>
          </aside>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.35rem] border bg-white shadow-sm lg:h-full lg:min-h-0">
            {/* Mobile kitchen context */}
            <div className="flex-shrink-0 border-b bg-gray-50/50 px-4 py-3 lg:hidden">
              {selectedKitchen ? (
                <BookingPlaceContext
                  kitchen={selectedKitchen}
                  locationName={locationName}
                  locationAddress={locationAddress}
                  compact
                  onPolicyOpen={() => setCancellationPolicyOpen(true)}
                />
              ) : (
                <Skeleton className="h-14 w-full rounded-xl" />
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
              {loadError ? <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{loadError}</p> : null}
              {/* Blocked chefs can still read the page; the steps are inert so nothing can be submitted. */}
              <div className={cn("mx-auto h-full w-full max-w-3xl lg:mx-0", bookingBlocked && "pointer-events-none opacity-60")} aria-disabled={bookingBlocked || undefined} {...(bookingBlocked ? { inert: "" } : {})}>{renderStepContent()}</div>
            </div>

            <div className="sticky bottom-0 flex-shrink-0 border-t bg-white px-4 py-4 sm:px-6 lg:px-8">
              {checkoutError ? (
                <p role="alert" className="mx-auto mb-3 w-full max-w-3xl rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive lg:mx-0">{checkoutError}</p>
              ) : null}
              <div className="mx-auto w-full max-w-3xl lg:mx-0">{renderStepActions()}</div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={timeModalOpen} onOpenChange={(open) => { if (open) setTimeModalOpen(true); }}>
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="flex max-h-[85vh] w-[min(100vw-1.5rem,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>{t("sheetSelectTimeTitle", "Select time")}</DialogTitle>
            <DialogDescription>
              {selectedDate ? formatDate(selectedDate) : ""}{bookingRateMode === "hourly" && maxSlotsPerChef != null
                ? ` · ${t("sheetMaxHoursBadge", { maxHours: maxSlotsPerChef, defaultValue: `Max ${maxSlotsPerChef} hours` })}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {allSlots.map((slot) => {
                const selected = pendingTimeSlots.includes(slot.time);
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={slot.isFullyBooked}
                    onClick={() => updateSlotSelection(setPendingTimeSlots, slot)}
                    className={cn(
                      "flex min-h-[44px] w-full items-center justify-center rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition-colors",
                      selected && "border-[#E10939] bg-[#E10939] text-white",
                      !selected && !slot.isFullyBooked && "border-gray-200 bg-white text-gray-700 hover:border-[#E10939]/40",
                      slot.isFullyBooked && "cursor-not-allowed border-transparent bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {formatSlotRange(slot.time)}{slot.isFullyBooked && <span className="ml-1 text-xs no-underline"> · {t("wfbBooked")}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t bg-white px-5 py-4">
            <Button variant="ghost" className="rounded-xl" onClick={() => setDiscardModal("time")}>{t("sheetCancelButton")}</Button>
            <p className="text-sm text-muted-foreground">{selectionError(pendingTimeSlots) || `${pendingTimeSlots.length} hours selected`}</p>
            <Button
              disabled={!!selectionError(pendingTimeSlots)}
              className={chefPrimaryCtaClass()}
              onClick={() => {
                if (selectionError(pendingTimeSlots)) return;
                setSelectedSlots(sortSelectedSlots(pendingTimeSlots));
                setTimeModalOpen(false);
              }}
            >
              <Icon icon="mdi:check" className="mr-2 h-4 w-4" aria-hidden />{ct('sweepLabel22')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={equipmentInventoryModal !== null}
        onOpenChange={(open) => {
          if (!open) setEquipmentInventoryModal(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>
              {equipmentInventoryModal === "included"
                ? t("sheetIncludedEquipmentTitle", "Included equipment")
                : t("sheetOptionalRentalsLabel", "Optional rentals")}
            </DialogTitle>
            <DialogDescription>
              {equipmentInventoryModal === "included"
                ? t("sheetIncludedEquipmentDesc", "Included at no extra charge.")
                : t("sheetRentalEquipmentDesc", "Optional rentals for this kitchen session.")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <InventoryPreviewList
              title={equipmentInventoryModal === "included"
                ? t("sheetIncludedLabel", "Included")
                : t("sheetOptionalRentalsLabel", "Optional rentals")}
              subtitle={equipmentInventoryModal === "included"
                ? t("sheetIncludedEquipmentDesc", "Included at no extra charge.")
                : t("sheetRentalEquipmentDesc", "Optional rentals for this session.")}
              items={equipmentInventoryModal === "included"
                ? equipmentListings.included
                : equipmentListings.rental}
              selectedIds={selectedEquipmentIds}
                    onToggle={(id) => setSelectedEquipmentIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
              rental={equipmentInventoryModal === "rental"}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={equipmentModalOpen}
        onOpenChange={(open) => {
          if (open) {
            setEquipmentModalOpen(true);
            setEquipmentInventoryModal(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>{t("sheetSelectEquipment", "Select equipment")}</DialogTitle>
            <DialogDescription>
              {t(
                "sheetSelectEquipmentDesc",
                "Choose any optional rental equipment you need for this session."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <section>
              <div className="mb-3">
                <h4 className="text-base font-semibold text-gray-900">{t("sheetOptionalRentalsLabel", "Optional rentals")}</h4>
                <p className="text-sm text-muted-foreground">{t("kbfSelectAsMany")}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {equipmentListings.rental.map((equipment: any) => {
                  const selected = pendingEquipmentIds.includes(equipment.id);
                  return (
                    <button
                      key={equipment.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPendingEquipmentIds((current) =>
                        selected
                          ? current.filter((id) => id !== equipment.id)
                          : [...current, equipment.id]
                      )}
                      className={cn(
                        "flex items-center gap-3 rounded-[1.35rem] border p-3 text-left transition-all",
                        selected
                          ? "border-[#E10939] bg-[#E10939]/[0.04] ring-1 ring-[#E10939]/20"
                          : "border-gray-200 hover:border-[#E10939]/40"
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF3F5] text-[#E10939]">
                        <Icon icon={resolveEquipmentIcon(equipment.equipmentType, equipment.category)} width={20} height={20} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-900">{equipmentName(equipment)}</span>
                        <span className="block text-sm text-muted-foreground">{formatCurrency(equipment.sessionRate || 0)}{' '}{ct('sweepLabel23')}</span>
                      </span>
                      <span className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-[#E10939] bg-[#E10939] text-white" : "border-gray-300"
                      )}>
                        {selected ? <Icon icon="mdi:check" className="h-3 w-3" aria-hidden /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
          <div className="space-y-3 border-t bg-white px-5 py-3">
            <BookingPriceSummary
              kitchenSubtotal={isMultiDay ? datedKitchenSubtotal : estimatedPrice?.basePrice || 0}
              equipmentSubtotal={pendingEquipmentSubtotal}
              taxRatePercent={selectedKitchen?.taxRatePercent || 0}
              serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0}
              currency={kitchenPricing?.currency || "CAD"}
              equipmentItems={pendingEquipmentIds.flatMap(id => {
                const item = equipmentListings.rental.find((equipment: any) => equipment.id === id);
                const days = isMultiDay ? selectedDates.filter(date => dayResources[date]?.equipmentIds.includes(id) && !dayEquipmentExcluded[date]?.includes(id)).length : 1;
                return item ? [{ name: equipmentName(item), priceCents: (item.sessionRate || 0) * days }] : [];
              })}
              taxLabel={selectedKitchen?.taxLabel}
              focusAddon="equipment"
            />
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Button variant="ghost" className="rounded-xl" onClick={() => setDiscardModal("equipment")}>{t("sheetCancelButton")}</Button>
              <p className="text-sm text-muted-foreground">
                {pendingEquipmentIds.length
                  ? `${pendingEquipmentIds.length} rental${pendingEquipmentIds.length === 1 ? "" : "s"} selected`
                  : t("sheetNoRentalsSelected", "No rentals selected")}
              </p>
              <Button
                className={chefPrimaryCtaClass()}
                onClick={() => {
                  setSelectedEquipmentIds(pendingEquipmentIds);
                  setEquipmentModalOpen(false);
                }}
              >
                <Icon icon="mdi:check" className="mr-2 h-4 w-4" aria-hidden /> {t("sheetSaveSelection", "Save selection")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancellationPolicyOpen} onOpenChange={setCancellationPolicyOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[min(100vw-1.5rem,34rem)] sm:max-w-lg"
        >
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2">
              <Icon
                icon="mdi:shield-check-outline"
                className="h-4 w-4 shrink-0 text-[#E10939]"
                aria-hidden
              />
              {t("sheetCancellationPolicyTitle", "Cancellation policy")}
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
              {acceptedPolicy ? <CancellationPolicySummary policy={acceptedPolicy.policy} timezone={acceptedPolicy.timezone} startAt={policyStartAt} /> : policyT('cpError')}
            </DialogDescription>
          </DialogHeader>
          <Button className="mt-2 w-full" variant="outline" onClick={() => setCancellationPolicyOpen(false)}>
            {t("sheetClosePolicy", "Got it")}
          </Button>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardModal !== null} onOpenChange={(open) => { if (!open) setDiscardModal(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kbfDiscardUnsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("kbfDiscardUnsavedDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("kbfKeepEditing")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscardModalChanges}>{t("kbfDiscardChanges")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelConfirmOpen}
        onOpenChange={(open) => {
          setCancelConfirmOpen(open);
          if (!open) pendingLeaveRef.current = null;
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sheetCancelConfirmTitle", "Cancel this booking?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "sheetCancelConfirmDesc",
                "Your booking progress will be cleared and you’ll start over next time."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("sheetKeepBookingButton", "Keep booking")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelBooking}>
              {t("sheetConfirmCancelButton", "Yes, cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {gate}
    </>
  );
}
