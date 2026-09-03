import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationsStatus } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import SEOHead from "@/components/SEO/SEOHead";
import { motion } from "framer-motion";
import {
  Building2,
  MapPin,
  Calendar,
  ArrowRight,
  ArrowLeft,
  Search,
  ChefHat,
  Lock,
} from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FadeInSection from "@/components/ui/FadeInSection";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/ui/smart-image";
import { tt } from "@/i18n/common-ns";

interface PublicLocation {
  id: number;
  slug?: string;
  name: string;
  address: string;
  description?: string | null;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
  featuredKitchenImage?: string | null;
  kitchenCount?: number;
  amenities?: string[];
  minHourlyRate?: number | null;
  maxHourlyRate?: number | null;
  canAcceptBookings?: boolean;
  isApproved?: boolean;
}

type LocationAction =
  | { kind: "book" }
  | { kind: "continue" }
  | { kind: "pending" }
  | { kind: "apply" }
  | { kind: "reapply" }
  | { kind: "guest" };

function locationImage(loc: PublicLocation): string | null {
  const raw = (loc.featuredKitchenImage || loc.brandImageUrl || "").trim();
  if (!raw) return null;
  return getR2ProxyUrl(raw) || raw;
}

function formatFromRate(cents: number | null | undefined): string | null {
  if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0) return null;
  return `${formatCurrency(Number(cents))}/hr`;
}

function BrowseLocationCard({
  location,
  action,
  onViewDetails,
  onPrimaryAction,
  index,
}: {
  location: PublicLocation;
  action: LocationAction;
  onViewDetails: () => void;
  onPrimaryAction: () => void;
  index: number;
}) {
  const { t } = useTranslation("kitchen");
  const [imageError, setImageError] = useState(false);
  const img = locationImage(location);
  const showImage = !!img && !imageError;
  const rateLabel = formatFromRate(location.minHourlyRate ?? null);
  const amenities = (location.amenities || []).slice(0, 3);

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
        return t("applyToBook", "Apply to Book");
      case "guest":
        return t("viewDetails", "View Details");
    }
  })();

  const primaryDisabled = action.kind === "pending";

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.06, 0.3), ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgba(44,44,44,0.06)] ring-1 ring-[#2C2C2C]/6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(245,16,66,0.12)]"
    >
      <button
        type="button"
        onClick={onViewDetails}
        className="relative block aspect-[4/3] w-full overflow-hidden text-left"
        aria-label={t("viewLocationAria", { name: location.name, defaultValue: `View ${location.name}` })}
      >
        {showImage ? (
          <SmartImage
            src={img!}
            alt={location.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FFE8DD] via-[#FFF8F5] to-white">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F51042]/10">
              <Building2 className="h-8 w-8 text-[#F51042]" />
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />

        {location.logoUrl && (
          <SmartImage
            src={location.logoUrl}
            alt=""
            className="absolute left-3 top-3 h-10 w-auto rounded-lg bg-white/95 p-1.5 shadow-md"
            hideOnError
          />
        )}

        {(location.kitchenCount ?? 0) > 1 && (
          <span className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#F51042] shadow-sm">
            {location.kitchenCount} {location.kitchenCount === 1 ? t("kitchenSingular", "kitchen") : t("kitchenPlural", "kitchens")}
          </span>
        )}

        {rateLabel && (
          <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#2C2C2C] shadow-sm backdrop-blur-sm">
            {t("fromPrefix", "From")} <span className="text-[#F51042]">{rateLabel}</span>
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-4 flex-1">
          <h3 className="mb-1.5 text-lg font-bold leading-tight text-[#1A1A1A] transition-colors group-hover:text-[#F51042]">
            {location.name}
          </h3>
          {location.address && (
            <p className="mb-3 flex items-start gap-1.5 text-sm text-[#6B6B6B]">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F51042]" />
              <span className="line-clamp-2">{location.address}</span>
            </p>
          )}
          {location.description && (
            <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-[#828282]">
              {location.description}
            </p>
          )}
          {amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {amenities.map((amenity) => (
                <span
                  key={amenity}
                  className="rounded-full bg-[#FFF8F5] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#6B4A4F] ring-1 ring-[#F51042]/10"
                >
                  {amenity}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          {/* Guests: View Details only — sign-in happens on preview / book flow */}
          {action.kind !== "guest" && (
            <Button
              disabled={primaryDisabled}
              className={cn(
                "min-h-[44px] flex-1 rounded-full font-semibold",
                primaryDisabled
                  ? "bg-[#2C2C2C]/10 text-[#6B6B6B] hover:bg-[#2C2C2C]/10"
                  : "bg-[#F51042] text-white hover:bg-[#D90E3A]"
              )}
              onClick={onPrimaryAction}
            >
              {action.kind === "book" && <Calendar className="mr-1.5 h-3.5 w-3.5" />}
              {primaryLabel}
              {!primaryDisabled && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant={action.kind === "guest" ? "default" : "outline"}
            className={cn(
              "min-h-[44px] flex-1 rounded-full font-semibold",
              action.kind === "guest"
                ? "bg-[#F51042] text-white hover:bg-[#D90E3A]"
                : "border-[#2C2C2C]/15 text-[#2C2C2C] hover:border-[#F51042] hover:bg-[#F51042]/5 hover:text-[#F51042]"
            )}
            onClick={onViewDetails}
          >
            {t("viewDetails", "View Details")}
            {action.kind === "guest" && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#2C2C2C]/6">
      <div className="aspect-[4/3] animate-pulse bg-[#FFE8DD]/60" />
      <div className="space-y-3 p-5">
        <div className="h-5 w-2/3 animate-pulse rounded bg-[#2C2C2C]/8" />
        <div className="h-4 w-full animate-pulse rounded bg-[#2C2C2C]/6" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[#2C2C2C]/6" />
        <div className="flex gap-2 pt-2">
          <div className="h-11 flex-1 animate-pulse rounded-full bg-[#2C2C2C]/6" />
          <div className="h-11 flex-1 animate-pulse rounded-full bg-[#F51042]/15" />
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

  const { applications, isLoading: applicationsLoading } = useChefKitchenApplicationsStatus();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const { data: publicLocations = [], isLoading: locationsLoading } = useQuery<PublicLocation[]>({
    queryKey: ["/api/public/locations"],
    queryFn: async () => {
      const response = await fetch("/api/public/locations");
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

  const filteredLocations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return publicLocations.filter((loc) => {
      if (!query) return true;
      return (
        loc.name.toLowerCase().includes(query) ||
        (loc.address || "").toLowerCase().includes(query) ||
        (loc.description || "").toLowerCase().includes(query) ||
        (loc.amenities || []).some((a) => a.toLowerCase().includes(query))
      );
    });
  }, [publicLocations, searchQuery]);

  const handleViewDetails = (locationId: number) => {
    const location = publicLocations.find((l) => l.id === locationId);
    navigate(`/kitchen-preview/${location?.slug || locationId}`);
  };

  const handlePrimaryAction = (locationId: number, action: LocationAction) => {
    const location = publicLocations.find((l) => l.id === locationId);
    const redirectPreview = `/kitchen-preview/${location?.slug || locationId}`;
    switch (action.kind) {
      case "book":
        navigate(`/dashboard?bookLocation=${locationId}`);
        break;
      case "continue":
      case "apply":
      case "reapply":
        navigate(`/kitchen-requirements/${locationId}`);
        break;
      case "guest":
        navigate(`/auth?redirect=${encodeURIComponent(redirectPreview)}`);
        break;
      case "pending":
        break;
    }
  };

  const isLoading = locationsLoading || authLoading || (!!user && applicationsLoading);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-b from-[#FFF8F5] via-white to-[#FFF8F5]">
      <SEOHead
        title={t("seoBrowseKitchensTitle", "Browse Kitchens — Commercial Kitchen Access")}
        description={t("seoBrowseKitchensDesc", "Browse certified commercial kitchens in St. John's, Newfoundland. Compare amenities, pricing, and availability — then book by the hour.")}
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

      <Header />

      <main className="relative z-10 flex-1 pb-16 pt-20 sm:pt-24 lg:pt-28">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
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
            <div className="mb-8 max-w-3xl sm:mb-10">
              <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#F51042]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[#F51042] sm:text-xs">
                <ChefHat className="h-3.5 w-3.5" />
                {t("kitchenAccessBadge", "Kitchen Access")}
              </span>
              <h1 className="mb-3 text-3xl font-bold leading-tight text-[#1A1A1A] sm:text-4xl lg:text-5xl">
                {t("findYour", "Find your")}{" "}
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-[#F51042] via-[#E8103A] to-[#FF6B7A] bg-clip-text text-transparent">
                    {t("kitchenWord", "kitchen")}
                  </span>
                </span>
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-[#6B6B6B] sm:text-base lg:text-lg">
                {t("browseKitchensHeroDesc", "Browse certified commercial kitchens in St. John's. Explore spaces freely — sign in when you're ready to book.")}
              </p>
            </div>
          </FadeInSection>

          {/* Sticky search */}
          <div className="sticky top-16 z-20 mb-8 sm:top-20 lg:top-24">
            <div className="rounded-2xl border border-[#2C2C2C]/8 bg-white/90 p-3 shadow-[0_8px_30px_rgba(44,44,44,0.06)] backdrop-blur-md sm:p-4">
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
                  {filteredLocations.length} {filteredLocations.length === 1 ? t("spaceSingular", "space") : t("spacePlural", "spaces")}
                  {searchQuery.trim() ? (" " + t("matchingYourSearch", "matching your search")) : (" " + t("availableWord", "available"))}
                </p>
              )}
            </div>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : filteredLocations.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredLocations.map((loc, index) => {
                const action = getActionForLocation(loc.id);
                return (
                  <BrowseLocationCard
                    key={loc.id}
                    location={loc}
                    action={action}
                    index={index}
                    onViewDetails={() => handleViewDetails(loc.id)}
                    onPrimaryAction={() => handlePrimaryAction(loc.id, action)}
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
          {!authLoading && !user && filteredLocations.length > 0 && (
            <FadeInSection delay={1}>
              <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-[#2C2C2C]/8 bg-white p-6 text-center shadow-[0_8px_30px_rgba(44,44,44,0.05)] sm:p-8">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#F51042]/10">
                  <Lock className="h-4 w-4 text-[#F51042]" />
                </div>
                <p className="mb-1 text-sm font-semibold text-[#1A1A1A]">{t("readyToBookKitchen", "Ready to book a kitchen?")}</p>
                <p className="mb-5 text-xs leading-relaxed text-[#6B6B6B] sm:text-sm">
                  {t("readyToBookKitchenDesc", "Create a free account to view availability and reserve your slot. Browsing stays open — no pressure.")}
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
      </main>

      <Footer />
    </div>
  );
}
