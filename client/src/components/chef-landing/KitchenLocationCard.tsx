import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Calendar, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { usePresignedImageUrl } from "@/hooks/use-presigned-image-url";
import { useState } from "react";

// Define interface matching the data structure in ChefLanding
export interface KitchenLocation {
    id: number;
    name: string;
    address: string;
    logoUrl: string | null;
    mainImage: string | null;
    featuredKitchenImage: string | null;
    kitchenCount: number;
    description?: string | null;
}

interface KitchenLocationCardProps {
    location: KitchenLocation;
    navigate: (path: string) => void;
}

export function KitchenLocationCard({ location, navigate }: KitchenLocationCardProps) {
    // Logic to determine which image URL to use
    const rawImageUrl = (location.mainImage || location.featuredKitchenImage || '').trim();
    const hasValidRawImage = rawImageUrl.length > 0;

    // Use the hook to get the accessible URL (handles R2 signing)
    // Only call hook if we actually have a raw URL
    const presignedUrl = usePresignedImageUrl(hasValidRawImage ? rawImageUrl : null);

    // Internal state to handle image loading failures (fallback to placeholder)
    const [imageError, setImageError] = useState(false);

    // Determine what to actually show
    const showPlaceholder = !hasValidRawImage || imageError;
    const displayUrl = presignedUrl || rawImageUrl; // Fallback to raw if hook waiting or failed

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
                {/* Kitchen Image Area */}
                <div className="relative h-44 overflow-hidden">
                    {!showPlaceholder ? (
                        <>
                            <img
                                src={displayUrl}
                                alt={location.name}
                                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
                                onError={(e) => {
                                    console.error(`[KitchenLocationCard] Image failed to load for ${location.name}:`, rawImageUrl);
                                    setImageError(true);
                                }}
                                loading="lazy"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                        </>
                    ) : (
                        // Placeholder State
                        <div className="w-full h-full bg-gradient-to-br from-[#FFE8DD] via-[#FFF0EB] to-white flex items-center justify-center">
                            <div className="w-16 h-16 bg-gradient-to-br from-[#F51042]/15 to-[#FF6B6B]/10 rounded-xl flex items-center justify-center">
                                <Building2 className="h-8 w-8 text-[#F51042]" />
                            </div>
                        </div>
                    )}

                    {/* Kitchen count badge */}
                    {location.kitchenCount > 1 && (
                        <div className="absolute top-3 right-3 bg-white rounded-full px-3 py-1 shadow-md z-10">
                            <span className="text-xs font-bold text-[#F51042]">{location.kitchenCount} Kitchens</span>
                        </div>
                    )}

                    {/* Logo overlay */}
                    {location.logoUrl && (
                        <div className="absolute top-3 left-3 z-10">
                            <img
                                src={location.logoUrl}
                                alt={`${location.name} logo`}
                                className="h-10 w-auto object-contain bg-white rounded-lg p-1.5 shadow-md"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="p-5">
                    <h3 className="text-lg font-bold text-[#1A1A1A] mb-1 group-hover:text-[#F51042] transition-colors">
                        {location.name}
                    </h3>
                    {location.address && (
                        <div className="flex items-start gap-1.5 mb-2">
                            <span className="text-[#F51042] mt-0.5">📍</span>
                            <p className="text-sm text-[#6B6B6B] leading-relaxed line-clamp-1">{location.address}</p>
                        </div>
                    )}

                    {location.description && (
                        <p className="text-xs text-[#828282] leading-relaxed line-clamp-2 mb-4 italic">
                            {location.description}
                        </p>
                    )}

                    <Button
                        className="w-full bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold rounded-lg py-2.5 text-sm transition-all duration-300 group/btn"
                        onClick={() => navigate(`/kitchen-preview/${location.id}`)}
                    >
                        <Calendar className="mr-1.5 h-4 w-4" />
                        View Availability
                        <ArrowRight className="ml-1.5 h-4 w-4 group-hover/btn:translate-x-0.5 transition-transform" />
                    </Button>
                </div>
            </Card>
        </motion.div>
    );
}
