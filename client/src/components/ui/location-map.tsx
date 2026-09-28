import { useEffect, useRef, useState } from "react";
import { MapPin, LocateFixed, ArrowUpRight } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CARTO_TILE_URL } from "@/components/kitchen/KitchensMap";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface LocationMapProps {
  address: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  heightClassName?: string;
  zoom?: number;
  className?: string;
}

export function LocationMap({ address, name, latitude, longitude, heightClassName = "h-[220px]", zoom = 15, className }: LocationMapProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const hasCoordinates = typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

  useEffect(() => {
    if (!container.current || !hasCoordinates) return;
    const map = L.map(container.current, { center: [latitude!, longitude!], zoom, scrollWheelZoom: false, dragging: !L.Browser.mobile, zoomControl: false });
    mapRef.current = map;
    setTilesUnavailable(false);
    L.tileLayer(CARTO_TILE_URL, { maxZoom: 19, detectRetina: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' })
      .on("tileerror", () => setTilesUnavailable(true))
      .on("tileload", () => setTilesUnavailable(false))
      .addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    // Compare's pill styling, adapted to a single fixed location label.
    // DOM text keeps manager-provided names and addresses out of HTML strings.
    const pill = document.createElement("div");
    pill.className = "kc-map-pill kc-location-pill gap-2";
    const pin = document.createElement("span");
    pin.className = "kc-map-pill-rate";
    pin.setAttribute("aria-hidden", "true");
    pin.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
    const label = document.createElement("span");
    label.className = "kc-map-pill-name";
    label.textContent = name || address;
    pill.append(pin, label);
    const icon = L.divIcon({ className: "kc-map-pill-wrap", iconSize: [0, 0], iconAnchor: [0, 0], html: pill });
    const popup = document.createElement("div");
    popup.className = "space-y-2";
    const heading = document.createElement("p");
    heading.className = "font-semibold text-gray-900";
    heading.textContent = name || t("location", "Location");
    const street = document.createElement("p");
    street.className = "text-xs leading-relaxed text-gray-600";
    street.textContent = address;
    const directions = document.createElement("a");
    directions.href = directionsUrl;
    directions.target = "_blank";
    directions.rel = "noopener noreferrer";
    directions.className = "text-xs font-medium underline underline-offset-4";
    directions.textContent = t("getDirections", "Get directions");
    popup.append(heading, street, directions);
    L.marker([latitude!, longitude!], { icon, title: name || address, alt: name || address, keyboard: true })
      .bindPopup(popup, { className: "kc-location-popup", minWidth: 180, maxWidth: 240, offset: [0, -46], autoPanPadding: [16, 16] }).addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, [hasCoordinates, latitude, longitude, zoom, name, address, directionsUrl, t]);

  return <div className={cn("overflow-hidden rounded-xl border border-border/50 bg-background", className)}>
    <div className={cn("relative isolate bg-[#F3F1EF]", heightClassName)}>
      {hasCoordinates ? <>
        <div ref={container} className="kc-map !min-h-0" role="region" aria-label={name ? `Map showing ${name}` : "Location map"} />
        {tilesUnavailable && <p role="status" className="absolute bottom-8 left-3 right-14 z-[500] rounded-lg bg-white/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">{t("mapTilesUnavailable", "Map could not load. Use Get directions below.")}</p>}
        <button type="button" aria-label={t("recenterMap", "Recenter map")} onClick={() => mapRef.current?.setView([latitude!, longitude!], zoom)} className="absolute right-[10px] top-[10px] z-[500] flex h-8 w-8 items-center justify-center rounded-xl border-0 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-700"><LocateFixed size={16} /></button>
      </> : <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"><MapPin size={24} /><p>{t("mapUnavailable", "Map preview unavailable. Open directions to locate the kitchen.")}</p></div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/50 p-3">
      <p className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-relaxed text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{address}</span></p>
      <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gray-900 underline underline-offset-4 hover:text-[#F51042]">{t("getDirections", "Get directions")}<ArrowUpRight size={14} /></a>
    </div>
  </div>;
}

export default LocationMap;
