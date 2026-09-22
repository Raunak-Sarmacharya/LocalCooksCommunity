import { logger } from "@/lib/logger";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
}

export function KitchenLocationCard({ location, navigate }: KitchenLocationCardProps) {
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
        <motion.div
            className="group h-full"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            whileHover={{ y: -8 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
        >
            <Card className="h-full border-0 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white overflow-hidden">
                {/* Inset photo — same radius as card + visible stroke */}
                <div className="shrink-0 p-3 pb-0">
                    <div className="relative h-44 overflow-hidden rounded-2xl border border-[#E5E0DB] ring-1 ring-[#2C2C2C]/[0.06] bg-[#F3F1EF]">
                        {!showPlaceholder ? (
                            <>
                                <SmartImage
                                    src={displayUrl}
                                    alt={kitchenName}
                                    className="w-full h-full object-cover rounded-2xl transform group-hover:scale-105 transition-transform duration-500"
                                    onError={(e) => {
                                        logger.error(`[KitchenLocationCard] Image failed to load for ${kitchenName}:`, rawImageUrl);
                                        setImageError(true);
                                    }}
                                    loading="lazy"
                                />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                            </>
                        ) : (
                            <KitchenPhotoPlaceholder className="rounded-2xl" />
                        )}

                        {location.kitchenCount > 1 && (
                            <div className="absolute top-3 right-3 bg-white rounded-full px-3 py-1 shadow-md z-10">
                                <span className="text-xs font-bold text-[#F51042]">
                                    {t("kitchenCount", "{{count}} Kitchens", { count: location.kitchenCount })}
                                </span>
                            </div>
                        )}

                        {location.logoUrl && (
                            <div className="absolute top-3 left-3 z-10">
                                <SmartImage
                                    src={location.logoUrl}
                                    alt={t("logoAlt", "{{name}} logo", { name: location.name })}
                                    className="h-10 w-auto object-contain bg-white rounded-lg p-1.5 shadow-md"
                                    hideOnError
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Content. Two things keep a row of cards level: every block
                    reserves its space whether or not it has content, and the
                    button is pushed down by `mt-auto`. Without both, a card
                    with no description pulled its button up and the row
                    stopped lining up. */}
                <div className="flex flex-1 flex-col p-5">
                    <TruncatedText as="h3" className="text-lg font-bold text-[#1A1A1A] mb-1 group-hover:text-[#F51042] transition-colors">
                        {kitchenName}
                    </TruncatedText>

                    {/* The row holds its height with a non-breaking space, so a
                        missing address cannot shorten the card. */}
                    <div className="mb-2 flex items-start gap-1.5">
                        <Icon icon="mdi:map-marker-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#2C2C2C]" aria-hidden />
                        <TruncatedText as="p" className="truncate text-sm leading-relaxed text-[#6B6B6B]">
                            {location.address?.trim() || "\u00a0"}
                        </TruncatedText>
                    </div>

                    {/* One line, always reserved. `truncate` gives the ellipsis and
                        TruncatedText adds the full text on hover only when it
                        actually overflows — no wrapping, so every card matches. */}
                    <TruncatedText as="p" className="mb-4 truncate text-xs italic leading-relaxed text-[#828282]">
                        {location.description?.trim() || "\u00a0"}
                    </TruncatedText>

                    <Button
                        className="mt-auto w-full bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold rounded-full py-2.5 text-sm transition-all duration-300 group/btn"
                        onClick={() => navigate(previewHref)}
                    >
                        <Icon icon="mdi:calendar-month-outline" className="mr-1.5 h-4 w-4 text-white" aria-hidden />
                        {t("viewAvailability", "View Availability")}
                        <Icon icon="mdi:arrow-right" className="ml-1.5 h-4 w-4 text-white group-hover/btn:translate-x-0.5 transition-transform" aria-hidden />
                    </Button>
                </div>
            </Card>
        </motion.div>
    );
}
