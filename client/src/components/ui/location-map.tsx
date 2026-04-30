import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface LocationMapProps {
  /** The location's address — passed directly to Google Maps. */
  address: string;
  /** Optional location/kitchen name for the iframe accessibility title. */
  name?: string;
  /** Tailwind height class for the map area. Defaults to a compact 220px. */
  heightClassName?: string;
  /** Map zoom level (1-20). Defaults to 15 (street level). */
  zoom?: number;
  className?: string;
}

/**
 * Compact embedded Google Map showing where a location is.
 *
 * Uses Google's legacy `maps.google.com?output=embed` URL — no API key, no
 * separate API enablement, no client-side geocoding. Google handles the
 * geocoding and rendering inside the iframe. The native "Open in Maps" link
 * inside the iframe (top-left) lets users jump to the full Google Maps app.
 */
export function LocationMap({
  address,
  name,
  heightClassName = "h-[220px]",
  zoom = 15,
  className,
}: LocationMapProps) {
  const encodedAddress = encodeURIComponent(address);
  const embedUrl = `https://maps.google.com/maps?q=${encodedAddress}&z=${zoom}&t=m&output=embed&iwloc=B`;

  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden border border-border/50 bg-muted/20",
        className,
      )}
    >
      <div className={cn("relative w-full bg-muted", heightClassName)}>
        <iframe
          title={name ? `Map showing ${name}` : "Location map"}
          src={embedUrl}
          className="absolute inset-0 w-full h-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>

      <div className="flex items-start gap-2 p-3 bg-background border-t border-border/50">
        <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-snug truncate">
          {address}
        </p>
      </div>
    </div>
  );
}

export default LocationMap;
