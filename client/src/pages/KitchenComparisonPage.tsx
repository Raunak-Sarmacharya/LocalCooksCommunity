import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationsStatus } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import SEOHead from "@/components/SEO/SEOHead";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@iconify/react";
import { Building2, ArrowRight, ArrowLeft, Search, Lock, Map as MapIcon, X } from "lucide-react";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FadeInSection from "@/components/ui/FadeInSection";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/ui/smart-image";
import { KitchenPhotoPlaceholder } from "@/components/kitchen/KitchenPhotoPlaceholder";
import KitchensMap, { type KitchenMapMarker } from "@/components/kitchen/KitchensMap";
import { tt } from "@/i18n/common-ns";

/**
 * One PUBLISHED KITCHEN, from `/api/public/kitchens`.
 *
 * This page used to read `/api/public/locations`, which returns one row per LOCATION. A location
 * is an address that can hold several kitchens, so a location with two published kitchens showed
 * ONE card (the "featured" kitchen won) and the other was unreachable from here - measured on dev:
 * 4 published kitchens across 3 locations, so one kitchen had no card at all.
 *
 * A page called Compare Kitchens compares kitchens, so it reads the endpoint that lists kitchens.
 */
interface PublicKitchen {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  galleryImages?: string[];
  /** Equipment names, from `equipment_listings` - the kitchen's real kit. */
  equipment?: string[];
  hourlyRate?: number | null;
  currency?: string;
  locationId: number;
  locationName?: string;
  locationSlug?: string | null;
  address?: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
  canAcceptBookings?: boolean;
  isLocationApproved?: boolean;
  /** Geocoded by the server from the location address; null when unplaceable (no marker). */
  latitude?: number | null;
  longitude?: number | null;
}

type LocationAction =
  | { kind: "book" }
  | { kind: "continue" }
  | { kind: "pending" }
  | { kind: "apply" }
  | { kind: "reapply" }
  | { kind: "guest" };

function kitchenImage(k: PublicKitchen): string | null {
  const raw = (k.imageUrl || k.brandImageUrl || "").trim();
  if (!raw) return null;
  return getR2ProxyUrl(raw) || raw;
}

function formatFromRate(cents: number | null | undefined): string | null {
  if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0) return null;
  return `${formatCurrency(Number(cents))}/hr`;
}

/** Compact rate for map pills ("$25/hr" instead of "$25.00/hr") so pills stay short. */
function compactRateLabel(cents: number | null | undefined): string | null {
  if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0) return null;
  const dollars = Number(cents) / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}/hr`;
}

/** The mdi glyph each card action carries in its primary button. */
const ACTION_ICON: Record<LocationAction["kind"], string> = {
  book: "mdi:calendar-month-outline",
  continue: "mdi:arrow-right-bold-circle-outline",
  pending: "mdi:clock-outline",
  apply: "mdi:file-document-edit-outline",
  reapply: "mdi:refresh",
  guest: "mdi:arrow-right",
};

/**
 * One kitchen card, in the same design language as the landing page's KitchenLocationCard:
 * 26px shell with an inset 20px photo, warm layered shadows, reserved line heights so a row
 * of cards always lines up, and a single strong pill CTA per action. `highlighted` is the
 * map's hover state mirrored onto the card (the reverse of the card's own mouse hover).
 */
function BrowseKitchenCard({
  kitchen,
  action,
  onViewDetails,
  onPrimaryAction,
  onHover,
  highlighted,
  index,
}: {
  kitchen: PublicKitchen;
  action: LocationAction;
  onViewDetails: () => void;
  onPrimaryAction: () => void;
  onHover: (locationId: number | null) => void;
  highlighted: boolean;
  index: number;
}) {
  const { t } = useTranslation("kitchen");
  const [imageError, setImageError] = useState(false);
  const img = kitchenImage(kitchen);
  const showImage = !!img && !imageError;
  const rateLabel = formatFromRate(kitchen.hourlyRate ?? null);
  const equipment = (kitchen.equipment || []).slice(0, 3);

  const primaryLabel = (() => {
    switch (action.kind) {
      case "book":
        return t("bookNow", "Book Now");
      case "continue":
        return t("continueApplication", "Continue Application");
      case "pending":
        return t("underReview", "Under Review");
      case "reapply":
        return t("applyAgain", "Apply Again");
      case "apply":
        return t("requestToApply", "Request to apply");
      case "guest":
        return t("viewDetails", "View Details");
    }
  })();

  const primaryDisabled = action.kind === "pending";
  // Book / Apply / Reapply already open preview — don't also show View Details.
  const primaryOpensPreview =
    action.kind === "book" || action.kind === "apply" || action.kind === "reapply";

  return (
    <motion.article
      data-kc-card
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, delay: Math.min(index * 0.1, 0.4), ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => onHover(kitchen.locationId)}
      onMouseLeave={() => onHover(null)}
      className="group/card h-full"
    >
      <div
        className={cn(
          "flex h-full flex-col rounded-[26px] bg-white p-2 shadow-[0_1px_2px_rgba(80,0,20,0.08),0_24px_48px_-24px_rgba(80,0,20,0.45)] ring-1 ring-black/[0.04] transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:-translate-y-1.5 group-hover/card:shadow-[0_1px_2px_rgba(80,0,20,0.08),0_36px_60px_-24px_rgba(80,0,20,0.55)]",
          highlighted &&
            "-translate-y-1.5 shadow-[0_1px_2px_rgba(80,0,20,0.08),0_36px_60px_-24px_rgba(245,16,66,0.4)] ring-2 ring-[#F51042]/60"
        )}
      >
        {/* Photo — inset, same radius family as the landing card */}
        <button
          type="button"
          onClick={onViewDetails}
          className="relative block aspect-[16/11] w-full overflow-hidden rounded-[20px] bg-[#F3F1EF] text-left"
          aria-label={t("viewKitchenAria", { name: kitchen.name, defaultValue: `View ${kitchen.name}` })}
        >
          {showImage ? (
            <>
              <SmartImage
                src={img!}
                alt={kitchen.name}
                className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:scale-[1.04]"
                loading="lazy"
                onError={() => setImageError(true)}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-transparent" />
            </>
          ) : (
            <KitchenPhotoPlaceholder />
          )}

          {kitchen.logoUrl && (
            <div className="absolute left-3 top-3 z-10">
              {/* SmartImage splits classes between the wrapper span and the img: `rounded-xl`
                  lands on the chip, but the IMG's own corners stay sharp inside it (most logo
                  files have a baked opaque background), so round the img itself via `style` -
                  the same fix the landing page's card already carries. */}
              <SmartImage
                src={kitchen.logoUrl}
                alt=""
                className="h-10 w-auto rounded-xl bg-white/95 object-contain p-1.5 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.3)]"
                style={{ borderRadius: 8 }}
                hideOnError
              />
            </div>
          )}

          {rateLabel && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.3)] backdrop-blur">
              <span className="text-[0.72rem] font-medium text-[#5F5F5F]">{t("fromPrefix", "From")}</span>
              <span className="text-[0.72rem] font-semibold text-[#F51042]">{rateLabel}</span>
            </span>
          )}
        </button>

        {/* Details. Every line reserves its height whether or not it has content, and the
            actions sit on `mt-auto`, so a row of cards always lines up. */}
        <div className="flex flex-1 flex-col px-3 pb-3 pt-4 sm:px-4">
          <h3 className="truncate text-[1.1rem] font-semibold tracking-[-0.01em] text-[#1F1F1F] transition-colors duration-300 group-hover/card:text-[#F51042]">
            {kitchen.name}
          </h3>

          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <Icon icon="mdi:map-marker-outline" className="h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
            <p className="min-w-0 truncate text-[0.86rem] text-[#5F5F5F]">
              {kitchen.address?.trim() || "\u00a0"}
            </p>
          </div>

          <p className="mb-3 mt-2 truncate text-[0.8rem] text-[#8A8A8A]">
            {kitchen.description?.trim() || "\u00a0"}
          </p>

          <div className="mb-4 flex min-h-[26px] flex-wrap items-start gap-1.5">
            {equipment.map((item) => (
              <span
                key={item}
                className="rounded-full bg-[#F3F1EF] px-2.5 py-1 text-[0.7rem] font-medium text-[#5F5F5F]"
              >
                {item}
              </span>
            ))}
          </div>

          <div className="mt-auto flex flex-col gap-0.5">
            {/* Guests: View Details only — sign-in happens on preview / book flow */}
            {action.kind !== "guest" && (
              <button
                type="button"
                disabled={primaryDisabled}
                onClick={onPrimaryAction}
                className={cn(
                  "group/btn inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[0.9rem] font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2",
                  primaryDisabled
                    ? "cursor-not-allowed bg-[#2C2C2C]/10 text-[#6B6B6B]"
                    : "bg-[#F51042] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_18px_-10px_rgba(245,16,66,0.8)] hover:bg-[#E30D3C]"
                )}
              >
                <Icon icon={ACTION_ICON[action.kind]} className="h-4 w-4" aria-hidden />
                {primaryLabel}
                {!primaryDisabled && (
                  <Icon
                    icon="mdi:arrow-right"
                    className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-0.5"
                    aria-hidden
                  />
                )}
              </button>
            )}
            {!primaryOpensPreview && (
              <button
                type="button"
                onClick={onViewDetails}
                className={cn(
                  "group/btn inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[0.9rem] font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2",
                  action.kind === "guest"
                    ? "bg-[#F51042] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_18px_-10px_rgba(245,16,66,0.8)] hover:bg-[#E30D3C]"
                    : "text-[#5F5F5F] hover:text-[#F51042]"
                )}
              >
                {t("viewDetails", "View Details")}
                <Icon
                  icon="mdi:arrow-right"
                  className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-0.5"
                  aria-hidden
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-[26px] bg-white p-2 shadow-[0_1px_2px_rgba(80,0,20,0.08),0_24px_48px_-24px_rgba(80,0,20,0.25)] ring-1 ring-black/[0.04]">
      <div className="aspect-[16/11] animate-pulse rounded-[20px] bg-[#F3F1EF]" />
      <div className="space-y-3 px-3 pb-3 pt-4 sm:px-4">
        <div className="h-5 w-2/3 animate-pulse rounded bg-[#2C2C2C]/8" />
        <div className="h-4 w-full animate-pulse rounded bg-[#2C2C2C]/6" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[#2C2C2C]/6" />
        <div className="h-11 w-full animate-pulse rounded-full bg-[#F51042]/12 pt-2" />
      </div>
    </div>
  );
}

function MapPanelSkeleton() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[26px] bg-[#F3F1EF] ring-1 ring-black/[0.04]">
      <div className="absolute inset-0 animate-pulse bg-[#2C2C2C]/4" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[#2C2C2C]/8">
          <MapIcon className="h-5 w-5 animate-pulse text-[#F51042]" />
        </div>
      </div>
    </div>
  );
}

export default function KitchenComparisonPage() {
  const { t } = useTranslation("kitchen");
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredLocationId, setHoveredLocationId] = useState<number | null>(null);
  const [mobileMapOpen, setMobileMapOpen] = useState(false);
  const [headerSearchVisible, setHeaderSearchVisible] = useState(false);
  const searchSentinelRef = useRef<HTMLDivElement | null>(null);

  const { applications, isLoading: applicationsLoading } = useChefKitchenApplicationsStatus();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  /**
   * The search handoff. The in-flow search card scrolls away with the hero on desktop; the
   * moment its top edge passes under the fixed header (64px + a small margin), the compact
   * search pill fades into the header's centre slot. Both inputs are always mounted and bound
   * to the same query, so the handoff never loses focus or text. Below `lg` the header slot is
   * hidden and the in-flow card stays sticky under the bar instead.
   */
  useEffect(() => {
    const sentinel = searchSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderSearchVisible(!entry.isIntersecting),
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const { data: publicKitchens = [], isLoading: kitchensLoading } = useQuery<PublicKitchen[]>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error(tt("failedToFetchLocations"));
      return response.json();
    },
    staleTime: 60_000,
  });

  const applicationsByLocation = useMemo(() => {
    const map = new Map<number, (typeof applications)[number]>();
    for (const app of applications) {
      map.set(app.locationId, app);
    }
    return map;
  }, [applications]);

  const getActionForLocation = (locationId: number): LocationAction => {
    if (!user) return { kind: "guest" };

    const app = applicationsByLocation.get(locationId);
    if (!app) return { kind: "apply" };

    if (app.status === "inReview") return { kind: "pending" };
    if (app.status === "rejected" || app.status === "cancelled") return { kind: "reapply" };

    if (app.status === "approved") {
      const tier = (app as { current_tier?: number }).current_tier ?? 1;
      if (tier >= 3) return { kind: "book" };
      return { kind: "continue" };
    }

    return { kind: "apply" };
  };

  const filteredKitchens = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return publicKitchens.filter((k) => {
      if (!query) return true;
      return (
        k.name.toLowerCase().includes(query) ||
        (k.locationName || "").toLowerCase().includes(query) ||
        (k.address || "").toLowerCase().includes(query) ||
        (k.description || "").toLowerCase().includes(query) ||
        (k.equipment || []).some((item) => item.toLowerCase().includes(query))
      );
    });
  }, [publicKitchens, searchQuery]);

  /**
   * One marker per ADDRESS. Kitchens at the same location share identical coordinates, so
   * per-kitchen pins would stack invisibly; the pill shows the address's lowest rate and its
   * popover lists each kitchen individually, each navigating to its own ?kitchenId= preview.
   */
  const mapMarkers = useMemo<KitchenMapMarker[]>(() => {
    const byLocation = new Map<number, KitchenMapMarker & { minCents: number | null }>();
    for (const kitchen of filteredKitchens) {
      if (typeof kitchen.latitude !== "number" || typeof kitchen.longitude !== "number") continue;
      let marker = byLocation.get(kitchen.locationId);
      if (!marker) {
        marker = {
          locationId: kitchen.locationId,
          locationName: kitchen.locationName || kitchen.name,
          address: kitchen.address || "",
          lat: kitchen.latitude,
          lng: kitchen.longitude,
          minRateLabel: null,
          showFromPrefix: false,
          kitchens: [],
          minCents: null,
        };
        byLocation.set(kitchen.locationId, marker);
      }
      marker.kitchens.push({
        id: kitchen.id,
        name: kitchen.name,
        imageUrl: kitchenImage(kitchen),
        rateLabel: compactRateLabel(kitchen.hourlyRate),
      });
      const cents = kitchen.hourlyRate != null ? Number(kitchen.hourlyRate) : null;
      if (cents != null && cents > 0 && (marker.minCents == null || cents < marker.minCents)) {
        marker.minCents = cents;
      }
    }
    return Array.from(byLocation.values()).map(({ minCents, ...marker }) => {
      const distinctRates = new Set(
        marker.kitchens.map((k) => k.rateLabel).filter((label) => label != null),
      );
      return {
        ...marker,
        minRateLabel: compactRateLabel(minCents),
        showFromPrefix: distinctRates.size > 1,
      };
    });
  }, [filteredKitchens]);

  const kitchenPreviewHref = (kitchen: PublicKitchen) =>
    `/kitchen-preview/${kitchen.locationSlug || kitchen.locationId}?kitchenId=${kitchen.id}`;

  const handleViewDetails = (kitchen: PublicKitchen) => {
    // `?kitchenId=` is what the preview page reads to open on a SPECIFIC kitchen; without it the
    // preview falls back to the location's first kitchen. A card that names a kitchen must open
    // on that kitchen, or two cards at one address would both open the same room.
    navigate(kitchenPreviewHref(kitchen));
  };

  const handleMapViewKitchen = (kitchenId: number) => {
    const kitchen = publicKitchens.find((k) => k.id === kitchenId);
    if (kitchen) handleViewDetails(kitchen);
  };

  const handlePrimaryAction = (kitchen: PublicKitchen, action: LocationAction) => {
    const redirectPreview = kitchenPreviewHref(kitchen);
    switch (action.kind) {
      case "book":
      case "apply":
        navigate(redirectPreview);
        break;
      case "reapply":
        navigate(`/apply-kitchen/${kitchen.locationId}`);
        break;
      case "continue":
        navigate(`/kitchen-requirements/${kitchen.locationId}`);
        break;
      case "guest":
        navigate(`/auth?redirect=${encodeURIComponent(redirectPreview)}`);
        break;
      case "pending":
        break;
    }
  };

  // The mobile map sheet owns the viewport while open: lock page scroll and let Escape close it.
  useEffect(() => {
    if (!mobileMapOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMapOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMapOpen]);

  const isLoading = kitchensLoading || authLoading || (!!user && applicationsLoading);
  const showMap = !isLoading && mapMarkers.length > 0;
  const showMapToggle = showMap && filteredKitchens.length > 0 && !mobileMapOpen;

  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-b from-[#FFF8F5] via-white to-[#FFF8F5]">
      <SEOHead
        title={t("seoBrowseKitchensTitle", "Browse Kitchens | Commercial Kitchen Access")}
        description={t("seoBrowseKitchensDesc", "Browse certified commercial kitchens in St. John's, Newfoundland. Compare amenities, pricing, and availability, then book by the hour.")}
        canonicalUrl="/compare-kitchens"
        breadcrumbs={[
          { name: "LocalCooks", url: "https://chef.localcooks.ca/" },
          { name: t("browseKitchens", "Browse Kitchens"), url: "https://chef.localcooks.ca/compare-kitchens" },
        ]}
      />

      {/* Soft atmospheric wash — brand cream, not rainbow orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -right-32 -top-24 h-[420px] w-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(245,16,66,0.06) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -left-24 top-1/3 h-[360px] w-[360px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255,215,0,0.08) 0%, transparent 70%)" }}
        />
      </div>
      {/* `hideHowItWorks` matches the chef landing page. This page has no `how-it-works`
          section, so the item could not scroll - it fell through to a navigation back to the
          landing page, which reads as an extra, broken item in the bar. */}
      <Header
        hideHowItWorks
        centerContent={
          <AnimatePresence initial={false}>
            {headerSearchVisible && (
              <motion.div
                key="header-search"
                initial={{ opacity: 0, y: -10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-md"
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6B6B]" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("searchKitchensPlaceholder", "Search by name, address, or amenity…")}
                    className="h-10 rounded-full border-[#2C2C2C]/12 bg-white pl-10 pr-4 text-sm shadow-[0_2px_12px_rgba(44,44,44,0.06)] focus-visible:ring-[#F51042]/30"
                    aria-label={t("searchKitchensAria", "Search kitchens")}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        }
      />

      <main className="relative z-10 flex-1 pb-16 pt-[calc(var(--header-height)+2.5rem)]">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          {/* No items-start: the aside must STRETCH to the row's height or the sticky map has
              zero travel room and scrolls away with the page (the "stagnant map" bug). */}
          <div className={cn(showMap || isLoading ? "lg:flex lg:gap-6 xl:gap-8" : "")}>
            {/* Left column: hero, search, cards */}
            <div className="min-w-0 flex-1">
              {user && (
                <FadeInSection>
                  <div className="mb-6">
                    <Button
                      variant="ghost"
                      onClick={() => navigate("/dashboard")}
                      className="px-0 text-[#6B6B6B] hover:bg-transparent hover:text-[#F51042]"
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      {t("backToDashboard")}
                    </Button>
                  </div>
                </FadeInSection>
              )}

              {/* Page hero */}
              <FadeInSection>
                <div className="mb-6 max-w-2xl sm:mb-8">
                  <h1 className="mb-3 text-3xl font-bold leading-tight text-[#1A1A1A] sm:text-4xl">
                    {t("findYour", "Find your")}{" "}
                    <span className="relative inline-block">
                      <span className="bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A] bg-clip-text text-transparent">
                        {t("kitchenWord", "kitchen")}
                      </span>
                    </span>
                  </h1>
                  <p className="max-w-xl text-sm leading-relaxed text-[#6B6B6B] sm:text-base">
                    {t("browseKitchensHeroDesc", "Browse certified commercial kitchens in St. John's. Explore spaces freely and sign in when you are ready to book.")}
                  </p>
                </div>
              </FadeInSection>

              {/* Below lg this docks flush under the fixed 64px header; on desktop it scrolls
                  away with the hero and the compact search in the header takes over. */}
              <div ref={searchSentinelRef} className="sticky top-[var(--header-height)] z-30 mb-8 lg:static">
                <div className="rounded-2xl border border-[#2C2C2C]/8 bg-white p-3 shadow-[0_8px_30px_rgba(44,44,44,0.08)] sm:p-4">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6B6B]" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t("searchKitchensPlaceholder", "Search by name, address, or amenity…")}
                      className="h-12 rounded-xl border-[#2C2C2C]/10 bg-[#FFF8F5]/50 pl-10 text-sm focus-visible:ring-[#F51042]/30"
                      aria-label={t("searchKitchensAria", "Search kitchens")}
                    />
                  </div>
                  {!isLoading && (
                    <p className="mt-2 px-1 font-mono text-[10px] uppercase tracking-wider text-[#6B6B6B]">
                      {filteredKitchens.length} {filteredKitchens.length === 1 ? t("kitchenSingular", "kitchen") : t("kitchenPlural", "kitchens")}
                      {searchQuery.trim() ? (" " + t("matchingYourSearch", "matching your search")) : (" " + t("availableWord", "available"))}
                    </p>
                  )}
                </div>
              </div>

              {/* Grid */}
              {isLoading ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              ) : filteredKitchens.length > 0 ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {filteredKitchens.map((kitchen, index) => {
                    // Applications are per LOCATION, so the action still resolves from `locationId`.
                    const action = getActionForLocation(kitchen.locationId);
                    return (
                      <BrowseKitchenCard
                        key={kitchen.id}
                        kitchen={kitchen}
                        action={action}
                        index={index}
                        highlighted={hoveredLocationId === kitchen.locationId}
                        onHover={setHoveredLocationId}
                        onViewDetails={() => handleViewDetails(kitchen)}
                        onPrimaryAction={() => handlePrimaryAction(kitchen, action)}
                      />
                    );
                  })}
                </div>
              ) : (
                <FadeInSection>
                  <div className="mx-auto max-w-md rounded-2xl border border-[#2C2C2C]/8 bg-white px-8 py-14 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F51042]/10">
                      <Building2 className="h-7 w-7 text-[#F51042]" />
                    </div>
                    <h2 className="mb-2 text-xl font-bold text-[#1A1A1A]">
                      {searchQuery.trim() ? t("noMatchesFound", "No matches found") : t("kitchensComingSoon", "Kitchens coming soon")}
                    </h2>
                    <p className="text-sm leading-relaxed text-[#6B6B6B]">
                      {searchQuery.trim() ? t("tryDifferentSearch", "Try a different search, or clear the filter to see all spaces.") : t("kitchensOnboardingNotice", "We're onboarding certified commercial kitchens in St. John's. Check back soon.")}
                    </p>
                    {searchQuery.trim() && (
                      <Button
                        variant="outline"
                        className="mt-6 rounded-full border-[#F51042]/30 text-[#F51042] hover:bg-[#F51042]/5"
                        onClick={() => setSearchQuery("")}
                      >
                        {t("clearSearch")}
                      </Button>
                    )}
                  </div>
                </FadeInSection>
              )}

              {/* Soft auth — minimal, preview-style */}
              {!authLoading && !user && filteredKitchens.length > 0 && (
                <FadeInSection delay={1}>
                  <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-[#2C2C2C]/8 bg-white p-6 text-center shadow-[0_8px_30px_rgba(44,44,44,0.05)] sm:p-8">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#F51042]/10">
                      <Lock className="h-4 w-4 text-[#F51042]" />
                    </div>
                    <p className="mb-1 text-sm font-semibold text-[#1A1A1A]">{t("readyToBookKitchen", "Ready to book a kitchen?")}</p>
                    <p className="mb-5 text-pretty text-xs leading-relaxed text-[#6B6B6B] sm:text-sm">
                      {t("readyToBookKitchenDesc", "Create a free account to reserve your slot.")}
                    </p>
                    <Button
                      className="w-full rounded-full bg-[#F51042] font-semibold text-white hover:bg-[#D90E3A] sm:w-auto sm:px-8"
                      onClick={() => navigate("/auth?redirect=/compare-kitchens")}
                    >
                      {t("createFreeAccount", "Create Free Account")}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <p className="mt-3 text-xs text-[#6B6B6B]">
                      {t("alreadyHaveAccount", "Already have an account?")}{" "}
                      <button
                        type="button"
                        onClick={() => navigate("/auth?redirect=/compare-kitchens")}
                        className="font-medium text-[#F51042] hover:underline"
                      >
                        {t("logIn")}
                      </button>
                    </p>
                  </div>
                </FadeInSection>
              )}
            </div>

            {/* Right column: sticky discovery map (desktop only). One marker per address,
                hover-synced with the cards; clicking a pill previews the kitchens there. */}
            {isLoading ? (
              <aside className="hidden lg:block lg:w-[42%] lg:shrink-0 xl:w-[40%]">
                <div className="sticky top-[calc(var(--header-height)+1rem)] h-[calc(100vh-var(--header-height)-2rem)]">
                  <MapPanelSkeleton />
                </div>
              </aside>
            ) : showMap ? (
              <aside className="hidden lg:block lg:w-[42%] lg:shrink-0 xl:w-[40%]">
                <div className="sticky top-[calc(var(--header-height)+1rem)] h-[calc(100vh-var(--header-height)-2rem)]">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="h-full w-full overflow-hidden rounded-[26px] shadow-[0_1px_2px_rgba(80,0,20,0.08),0_24px_48px_-24px_rgba(80,0,20,0.35)] ring-1 ring-black/[0.04]"
                  >
                    <KitchensMap
                      markers={mapMarkers}
                      hoveredLocationId={hoveredLocationId}
                      onHoverLocation={setHoveredLocationId}
                      onViewKitchen={handleMapViewKitchen}
                      className="h-full w-full"
                    />
                  </motion.div>
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </main>

      {/* Mobile: floating Map toggle (Airbnb pattern) opening a full-screen map sheet */}
      {showMapToggle && (
        <button
          type="button"
          onClick={() => setMobileMapOpen(true)}
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#2C2C2C] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(44,44,44,0.35)] transition-transform duration-200 hover:scale-[1.04] lg:hidden"
        >
          <MapIcon className="h-4 w-4" />
          {t("mapLabel", "Map")}
        </button>
      )}

      <AnimatePresence>
        {mobileMapOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed inset-0 z-[70] flex flex-col bg-white lg:hidden"
          >
            <div className="flex items-center justify-between border-b border-[#2C2C2C]/8 px-4 py-3">
              <span className="text-sm font-semibold text-[#1A1A1A]">{t("mapLabel", "Map")}</span>
              <button
                type="button"
                onClick={() => setMobileMapOpen(false)}
                aria-label={t("closeMapAria", "Close map")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3F1EF] text-[#2C2C2C] transition-colors hover:bg-[#EAE6E3]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative flex-1">
              <KitchensMap
                markers={mapMarkers}
                hoveredLocationId={hoveredLocationId}
                onHoverLocation={setHoveredLocationId}
                onViewKitchen={(kitchenId) => {
                  setMobileMapOpen(false);
                  handleMapViewKitchen(kitchenId);
                }}
                scrollWheelZoom
                active={mobileMapOpen}
                className="absolute inset-0"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
