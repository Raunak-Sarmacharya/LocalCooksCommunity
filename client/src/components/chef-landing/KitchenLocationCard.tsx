import { logger } from "@/lib/logger";
import { motion } from "framer-motion";
import { Icon } from "@iconify/react";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { useState } from "react";
import { SmartImage } from "@/components/ui/smart-image";
import { TruncatedText } from "@/components/common/TruncatedText";
import { KitchenPhotoPlaceholder } from "@/components/kitchen/KitchenPhotoPlaceholder";
import { useTranslation } from "react-i18next";

// Define interface matching the data structure in ChefLanding
export interface KitchenLocation {
    id: number;
    slug?: string;
    name: string;
    address: string;
    logoUrl: string | null;
    mainImage: string | null;
    featuredKitchenImage: string | null;
    kitchenCount: number;
    description?: string | null;
    /**
     * The published kitchen this card represents. `null`/absent on a response that predates the
     * field, in which case the card falls back to the location's own name.
     */
    featuredKitchen?: { id: number; name: string } | null;
}

interface KitchenLocationCardProps {
    location: KitchenLocation;
    navigate: (path: string) => void;
    /** Position in the row, used only to stagger the entrance. */
    index?: number;
}

export function KitchenLocationCard({ location, navigate, index = 0 }: KitchenLocationCardProps) {
    const { t } = useTranslation("common");

    /**
     * This card describes ONE KITCHEN, not the address it sits at.
     *
     * A location can hold several kitchens, and each one is published or taken down separately by its
     * manager — so a card titled with the location was naming something no chef can book, and it kept
     * promising availability the address no longer had. The kitchen is the bookable unit, so it names
     * the card.
     *
     * The link carries `?kitchenId=`, so the preview page opens on the same kitchen the card described
     * instead of on whichever one happens to sort first. The address line still shows the location, and
     * the "N Kitchens" badge still tells the chef there is more than one kitchen here.
     */
    const kitchenName = location.featuredKitchen?.name?.trim() || location.name;
    const previewHref = `/kitchen-preview/${location.slug || location.id}${
        location.featuredKitchen ? `?kitchenId=${location.featuredKitchen.id}` : ""
    }`;

    // Logic to determine which image URL to use
    const rawImageUrl = (location.mainImage || location.featuredKitchenImage || '').trim();
    const hasValidRawImage = rawImageUrl.length > 0;

    // Use the utility to get the accessible URL (handles R2 proxy)
    const proxyUrl = hasValidRawImage ? getR2ProxyUrl(rawImageUrl) : null;

    // Internal state to handle image loading failures (fallback to placeholder)
    const [imageError, setImageError] = useState(false);

    // Determine what to actually show
    const showPlaceholder = !hasValidRawImage || imageError;
    const displayUrl = proxyUrl || rawImageUrl; // Fallback to raw if proxy failed

    return (
        <motion.article
            data-kitchen-card
            className="group/card h-full"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -8% 0px" }}
            transition={{ duration: 0.7, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="flex h-full flex-col rounded-[26px] bg-white p-2 shadow-[0_1px_2px_rgba(80,0,20,0.08),0_24px_48px_-24px_rgba(80,0,20,0.45)] ring-1 ring-black/[0.04] transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:-translate-y-1.5 group-hover/card:shadow-[0_1px_2px_rgba(80,0,20,0.08),0_36px_60px_-24px_rgba(80,0,20,0.55)]">
                {/* Photo */}
                <div className="relative aspect-[16/11] overflow-hidden rounded-[20px] bg-[#F3F1EF]">
                    {!showPlaceholder ? (
                        <>
                            <SmartImage
                                src={displayUrl}
                                alt={kitchenName}
                                className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:scale-[1.04]"
                                onError={() => {
                                    logger.error(`[KitchenLocationCard] Image failed to load for ${kitchenName}:`, rawImageUrl);
                                    setImageError(true);
                                }}
                                loading="lazy"
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-transparent" />
                        </>
                    ) : (
                        <KitchenPhotoPlaceholder />
                    )}

                    {location.logoUrl && (
                        <div className="absolute left-3 top-3 z-10">
                            <SmartImage
                                src={location.logoUrl}
                                alt={t("logoAlt", "{{name}} logo", { name: location.name })}
                                className="h-10 w-auto rounded-xl bg-white/95 object-contain p-1.5 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.3)]"
                                style={{ borderRadius: 7 }}
                                hideOnError
                            />
                        </div>
                    )}

                    {location.kitchenCount > 1 && (
                        <div className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.3)] backdrop-blur">
                            <Icon icon="mdi:silverware-fork-knife" className="h-3.5 w-3.5 text-[#F51042]" aria-hidden />
                            <span className="text-[0.72rem] font-semibold text-[#1F1F1F]">
                                {t("kitchenCount", "{{count}} Kitchens", { count: location.kitchenCount })}
                            </span>
                        </div>
                    )}
                </div>

                {/* Details. Every line reserves its height whether or not it has content, and the
                    button sits on `mt-auto`, so a row of cards always lines up. */}
                <div className="flex flex-1 flex-col px-3 pb-3 pt-4 sm:px-4">
                    <TruncatedText as="h3" className="truncate text-[1.1rem] font-semibold tracking-[-0.01em] text-[#1F1F1F]">
                        {kitchenName}
                    </TruncatedText>

                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                        <Icon icon="mdi:map-marker-outline" className="h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
                        <TruncatedText as="p" className="min-w-0 truncate text-[0.86rem] text-[#5F5F5F]">
                            {location.address?.trim() || "\u00a0"}
                        </TruncatedText>
                    </div>

                    <TruncatedText as="p" className="mb-4 mt-2 truncate text-[0.8rem] text-[#8A8A8A]">
                        {location.description?.trim() || "\u00a0"}
                    </TruncatedText>

                    <button
                        type="button"
                        onClick={() => navigate(previewHref)}
                        className="group/btn mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F51042] px-5 text-[0.9rem] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_18px_-10px_rgba(245,16,66,0.8)] transition-colors duration-300 hover:bg-[#E30D3C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-offset-2"
                    >
                        <Icon icon="mdi:calendar-month-outline" className="h-4 w-4" aria-hidden />
                        {t("viewAvailability", "View Availability")}
                        <Icon
                            icon="mdi:arrow-right"
                            className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-0.5"
                            aria-hidden
                        />
                    </button>
                </div>
            </div>
        </motion.article>
    );
}
