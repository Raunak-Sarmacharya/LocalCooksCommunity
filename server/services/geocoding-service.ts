import { logger } from "../logger";

/**
 * Server-side address geocoding for chef-facing discovery surfaces.
 *
 * The `locations` table stores an address string and no coordinates (the Places autocomplete
 * geometry was never persisted), so a map view has nothing to pin. Geocoding lives on the
 * server for three reasons:
 *
 * 1. The Google key must never reach the browser (same rule `routes/places.ts` follows).
 * 2. Caching per address means each location is geocoded ONCE per server process instead of
 *    once per visitor, which keeps Nominatim's 1 req/s courtesy limit unhittable.
 * 3. A failed lookup must degrade to "no marker", never to a failed `/public/kitchens`.
 *
 * Order of providers: Google Geocoding (key already provisioned for Places) first, Nominatim
 * (free, no key, requires an identifying User-Agent) as the fallback. A REQUEST_DENIED from
 * Google just means the Geocoding API is not enabled on the project; the fallback still works.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const GEOCODE_TIMEOUT_MS = 5000;

/** address (trimmed, lowercased) -> resolved point, or null when no provider could place it. */
const geocodeCache = new Map<string, GeoPoint | null>();

/** In-flight dedupe: two kitchens at one address must not trigger two lookups. */
const pending = new Map<string, Promise<GeoPoint | null>>();

async function fetchJsonWithTimeout(url: string, headers: Record<string, string>): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeWithGoogle(address: string, apiKey: string): Promise<GeoPoint | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  const data = await fetchJsonWithTimeout(url.toString(), {});
  if (!data || data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
    return null;
  }
  const location = data.results[0]?.geometry?.location;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function geocodeWithNominatim(address: string): Promise<GeoPoint | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", address);
  // Nominatim's usage policy rejects requests without an identifying User-Agent.
  const data = await fetchJsonWithTimeout(url.toString(), {
    "User-Agent": "LocalCooks/1.0 (https://localcooks.ca; contact@localcooks.ca)",
    "Accept-Language": "en",
  });
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = Number(data[0]?.lat);
  const lng = Number(data[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Resolve an address to a point, cached forever per process. Returns null when the address is
 * blank or no provider could place it; callers must treat null as "render without a marker".
 */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const cacheKey = address.trim().toLowerCase();
  if (!cacheKey) return null;

  const cached = geocodeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const inFlight = pending.get(cacheKey);
  if (inFlight) return inFlight;

  const lookup = (async (): Promise<GeoPoint | null> => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      const point = await geocodeWithGoogle(address, apiKey);
      if (point) return point;
    }
    const point = await geocodeWithNominatim(address);
    if (!point) {
      logger.warn(`[geocoding] no provider could place address: ${address}`);
    }
    return point;
  })();

  pending.set(cacheKey, lookup);
  try {
    const point = await lookup;
    geocodeCache.set(cacheKey, point);
    return point;
  } finally {
    pending.delete(cacheKey);
  }
}

/**
 * Geocode a set of addresses in one parallel pass and return a lookup keyed by the ORIGINAL
 * address string. `/public/kitchens` fans one address out to several kitchens, so the route
 * dedupes first and maps the point back onto each kitchen.
 */
export async function geocodeAddresses(addresses: string[]): Promise<Map<string, GeoPoint | null>> {
  const unique = Array.from(new Set(addresses.filter((a) => !!a && a.trim().length > 0)));
  const points = await Promise.all(unique.map((a) => geocodeAddress(a)));
  const byNormalized = new Map<string, GeoPoint | null>();
  unique.forEach((address, index) => {
    byNormalized.set(address.trim().toLowerCase(), points[index] ?? null);
  });
  return new Map(
    addresses.map((address) => [address, byNormalized.get(address.trim().toLowerCase()) ?? null]),
  );
}
