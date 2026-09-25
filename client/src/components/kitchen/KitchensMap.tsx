import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Discovery map for the Compare Kitchens page (Leaflet + CARTO light basemap).
 *
 * One marker per ADDRESS, not per kitchen: kitchens at the same location share
 * identical coordinates, so per-kitchen pins would stack invisibly on top of
 * each other. The pill shows the address's lowest rate; clicking it opens a
 * popover that lists each kitchen at that address individually, each linking
 * to its own preview (same navigation as the cards).
 *
 * Interactions mirror the Airbnb list/map contract the page asked for:
 * hovering a card highlights the pill, hovering a pill highlights the card,
 * and the list is never filtered by the map.
 */

export interface MapKitchenEntry {
  id: number;
  name: string;
  imageUrl: string | null;
  /** Pre-formatted rate ("$25/hr"), or null when the kitchen has no rate. */
  rateLabel: string | null;
}

export interface KitchenMapMarker {
  locationId: number;
  locationName: string;
  address: string;
  lat: number;
  lng: number;
  /** Compact pill text ("$25/hr"), the address's lowest rate. Null when no kitchen has one. */
  minRateLabel: string | null;
  /** True when several kitchens share the address, so the pill reads "From $X/hr". */
  showFromPrefix: boolean;
  kitchens: MapKitchenEntry[];
}

interface KitchensMapProps {
  markers: KitchenMapMarker[];
  hoveredLocationId: number | null;
  onHoverLocation: (locationId: number | null) => void;
  onViewKitchen: (kitchenId: number) => void;
  /** Off in the sticky split view so page scroll is not hijacked; on in the mobile sheet. */
  scrollWheelZoom?: boolean;
  /** Flip true after the container becomes visible so Leaflet re-measures it. */
  active?: boolean;
  className?: string;
}

/** St. John's city centre, used before markers arrive and when none resolve. */
const DEFAULT_CENTER: L.LatLngExpression = [47.5615, -52.7126];
const DEFAULT_ZOOM = 12;

/**
 * CARTO basemap. `light_all` is the muted light style (Airbnb-like); `voyager` is the
 * warmer alternative if the page ever wants more colour. The key is a PUBLIC basemap
 * key by design - CARTO issues it for browser tile URLs, so it lives here rather than
 * in an env var (no Vercel setup needed). The style on the keyed `rastertiles` endpoint
 * is `light_all` - `positron` 404s there (measured 2026-09-25) even though the same
 * style is called positron elsewhere in CARTO's docs.
 */
const CARTO_BASEMAP_KEY = "cb1_3ymq_1_002c4aace0fe36bd3c0d93d2";
const CARTO_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_BASEMAP_KEY}`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

interface PillLabels {
  from: string;
}

function buildPillIcon(marker: KitchenMapMarker, active: boolean, labels: PillLabels): L.DivIcon {
  const content = marker.minRateLabel
    ? `${marker.showFromPrefix ? `<span class="kc-map-pill-from">${escapeHtml(labels.from)}&nbsp;</span>` : ""}<span class="kc-map-pill-rate">${escapeHtml(marker.minRateLabel)}</span>`
    : `<span class="kc-map-pill-name">${escapeHtml(marker.locationName)}</span>`;
  return L.divIcon({
    // Replaces Leaflet's default white-box divIcon styling; the pill is styled in index.css.
    className: "kc-map-pill-wrap",
    html: `<div class="kc-map-pill${active ? " kc-map-pill--active" : ""}">${content}</div>`,
    // The pill is centred on the point with CSS translate, so the icon itself is zero-size.
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

interface PopupLabels {
  viewDetails: string;
  closePreview: string;
  kitchensAtAddress: (count: number) => string;
}

const CHEVRON_SVG =
  '<svg class="kc-popup-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const CLOSE_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function buildPopupHtml(marker: KitchenMapMarker, labels: PopupLabels): string {
  // Leaflet's default close anchor is unstyleable without fighting its inline metrics; the
  // popup ships its OWN close button instead (bindPopup is called with closeButton: false),
  // and the map's delegated click listener turns data-popup-close into map.closePopup().
  const closeButton = `<button type="button" class="kc-popup-close" data-popup-close aria-label="${escapeHtml(labels.closePreview)}">${CLOSE_SVG}</button>`;

  if (marker.kitchens.length === 1) {
    const kitchen = marker.kitchens[0];
    return `
      <div class="kc-popup-card">
        ${closeButton}
        ${kitchen.imageUrl ? `<img src="${escapeHtml(kitchen.imageUrl)}" alt="" class="kc-popup-img" loading="lazy" />` : ""}
        <div class="kc-popup-body">
          <p class="kc-popup-name">${escapeHtml(kitchen.name)}</p>
          <p class="kc-popup-meta">${kitchen.rateLabel ? escapeHtml(kitchen.rateLabel) : escapeHtml(marker.address)}</p>
          <button type="button" class="kc-popup-view" data-kitchen-id="${kitchen.id}">${escapeHtml(labels.viewDetails)}</button>
        </div>
      </div>`;
  }

  const rows = marker.kitchens
    .map(
      (kitchen) => `
      <button type="button" class="kc-popup-row" data-kitchen-id="${kitchen.id}">
        ${kitchen.imageUrl
          ? `<img src="${escapeHtml(kitchen.imageUrl)}" alt="" class="kc-popup-thumb" loading="lazy" />`
          : `<span class="kc-popup-thumb kc-popup-thumb--empty" aria-hidden="true"></span>`}
        <span class="kc-popup-row-text">
          <span class="kc-popup-row-name">${escapeHtml(kitchen.name)}</span>
          ${kitchen.rateLabel ? `<span class="kc-popup-row-rate">${escapeHtml(kitchen.rateLabel)}</span>` : ""}
        </span>
        ${CHEVRON_SVG}
      </button>`,
    )
    .join("");

  return `
    <div class="kc-popup-card">
      ${closeButton}
      <p class="kc-popup-title">${escapeHtml(labels.kitchensAtAddress(marker.kitchens.length))}</p>
      ${rows}
    </div>`;
}

export default function KitchensMap({
  markers,
  hoveredLocationId,
  onHoverLocation,
  onViewKitchen,
  scrollWheelZoom = false,
  active = true,
  className,
}: KitchensMapProps) {
  const { t } = useTranslation("kitchen");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markerLayersRef = useRef<Map<number, L.Marker>>(new Map());

  // Latest values via refs so the map itself is created once and never re-created
  // when a callback identity or the labels change.
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onHoverRef = useRef(onHoverLocation);
  onHoverRef.current = onHoverLocation;
  const onViewRef = useRef(onViewKitchen);
  onViewRef.current = onViewKitchen;
  const pillLabelsRef = useRef<PillLabels>({ from: "From" });
  pillLabelsRef.current = { from: t("fromPrefix", "From") };
  const popupLabelsRef = useRef<PopupLabels>({
    viewDetails: "View Details",
    closePreview: "Close preview",
    kitchensAtAddress: (count) => `${count} kitchens at this address`,
  });
  popupLabelsRef.current = {
    viewDetails: t("viewDetails", "View Details"),
    closePreview: t("closePreviewAria", "Close preview"),
    kitchensAtAddress: (count) =>
      t("kitchensAtThisAddress", { count, defaultValue: "{count} kitchens at this address" }),
  };

  function fitToMarkers(map: L.Map, list: KitchenMapMarker[]) {
    if (list.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    if (list.length === 1) {
      map.setView([list[0].lat, list[0].lng], 13);
      return;
    }
    map.fitBounds(list.map((m) => [m.lat, m.lng]) as L.LatLngBoundsExpression, {
      padding: [40, 40],
      maxZoom: 14,
    });
  }

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      scrollWheelZoom,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(CARTO_TILE_URL, {
      maxZoom: 19,
      detectRetina: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Popover actions are plain HTML (Leaflet renders popups outside React), so one
    // delegated listener on the container handles them: data-popup-close dismisses the
    // popup, data-kitchen-id navigates to that kitchen's preview.
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-popup-close]")) {
        map.closePopup();
        return;
      }
      const kitchenTarget = target?.closest<HTMLElement>("[data-kitchen-id]");
      if (!kitchenTarget) return;
      const kitchenId = Number(kitchenTarget.dataset.kitchenId);
      if (Number.isFinite(kitchenId)) onViewRef.current(kitchenId);
    };
    container.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("click", handleClick);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markerLayersRef.current.clear();
    };
    // scrollWheelZoom is an init-time Leaflet option; the page sets it per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild markers when the SET changes (search filtering, data arrival).
  const markersSignature = markers
    .map((m) => `${m.locationId}:${m.lat},${m.lng}:${m.minRateLabel ?? ""}:${m.kitchens.map((k) => k.id).join(",")}`)
    .join("|");

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markerLayersRef.current.clear();

    for (const markerData of markersRef.current) {
      const marker = L.marker([markerData.lat, markerData.lng], {
        icon: buildPillIcon(markerData, false, pillLabelsRef.current),
        title: markerData.locationName,
      });
      marker.on("mouseover", () => onHoverRef.current(markerData.locationId));
      marker.on("mouseout", () => onHoverRef.current(null));
      marker.on("click", () => {
        marker
          .bindPopup(buildPopupHtml(markerData, popupLabelsRef.current), {
            className: "kc-map-popup",
            offset: [0, -6],
            maxWidth: 280,
            minWidth: 240,
            closeButton: false,
          })
          .openPopup();
      });
      marker.addTo(layer);
      markerLayersRef.current.set(markerData.locationId, marker);
    }

    fitToMarkers(map, markersRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersSignature]);

  // Reflect the page's hover state on the pills.
  useEffect(() => {
    for (const [locationId, marker] of markerLayersRef.current) {
      const markerData = markersRef.current.find((m) => m.locationId === locationId);
      if (!markerData) continue;
      const hovered = hoveredLocationId === locationId;
      marker.setIcon(buildPillIcon(markerData, hovered, pillLabelsRef.current));
      marker.setZIndexOffset(hovered ? 1000 : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredLocationId, markersSignature]);

  // Re-measure when the container becomes visible (mobile sheet opening, layout switches).
  useEffect(() => {
    const map = mapRef.current;
    if (!active || !map) return;
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      fitToMarkers(map, markersRef.current);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={cn("kc-map", className)}
      role="region"
      aria-label={t("kitchensMapAria", "Map of kitchens")}
    />
  );
}
