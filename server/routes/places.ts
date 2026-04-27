import { logger } from "../logger";
import { Router, Request, Response } from "express";

const router = Router();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Enterprise-grade Google Places API Proxy
 * 
 * This proxy ensures the Google API key is never exposed to the browser.
 * All Places API calls go through the server, keeping credentials secure.
 */

// Rate limiting state (simple in-memory, use Redis for production at scale)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP

/**
 * Province-level autocomplete configuration.
 *
 * Google's legacy Places Autocomplete API does NOT support province/state-level
 * components filters (only country). To restrict to a specific province we:
 *   1. Pass `country:ca` via components.
 *   2. Bias results with a rectangular `bounds` covering the province plus
 *      `strictbounds=true` so Google won't return matches outside.
 *   3. Filter the predictions on the way back so only ones whose
 *      secondary_text references the province (e.g. "NL") are returned.
 *   4. Validate the chosen place's `address_components` server-side in the
 *      details endpoint so a user can never persist an out-of-province pick.
 */
const PROVINCE_BOUNDS: Record<string, { sw: [number, number]; ne: [number, number]; longName: string }> = {
  // Newfoundland & Labrador — covers Labrador mainland + Newfoundland island.
  // SW corner ~46.0N,-67.8W, NE corner ~61.0N,-52.0W.
  NL: {
    sw: [46.0, -67.8],
    ne: [61.0, -52.0],
    longName: "Newfoundland and Labrador",
  },
};

function predictionMatchesProvince(p: any, provinceCode: string): boolean {
  const code = provinceCode.toUpperCase();
  const longName = PROVINCE_BOUNDS[code]?.longName || "";
  const haystack = `${p.description || ""} ${p.structured_formatting?.secondary_text || ""}`;
  // Match the bare province code as a whole word (e.g. ", NL," or "NL,")
  const codeRegex = new RegExp(`(^|[\\s,])${code}([\\s,]|$)`);
  if (codeRegex.test(haystack)) return true;
  if (longName && haystack.toLowerCase().includes(longName.toLowerCase())) return true;
  return false;
}

function placeIsInProvince(addressComponents: any[] | undefined, provinceCode: string): boolean {
  if (!Array.isArray(addressComponents)) return false;
  const code = provinceCode.toUpperCase();
  const longName = PROVINCE_BOUNDS[code]?.longName?.toLowerCase() || "";
  for (const comp of addressComponents) {
    if (Array.isArray(comp?.types) && comp.types.includes("administrative_area_level_1")) {
      const short = String(comp.short_name || "").toUpperCase();
      const long = String(comp.long_name || "").toLowerCase();
      if (short === code) return true;
      if (longName && long === longName) return true;
    }
  }
  return false;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  record.count++;
  return true;
}

/**
 * GET /api/places/autocomplete
 * Proxy for Google Places Autocomplete API
 * 
 * Query params:
 * - input: The search query (required)
 * - types: Place types filter (optional, default: 'address')
 * - components: Country restrictions (optional, default: 'country:us|country:ca')
 */
router.get("/autocomplete", async (req: Request, res: Response) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        error: "Too many requests",
        message: "Rate limit exceeded. Please try again later."
      });
    }

    const { input, types = "address", components = "country:us|country:ca", province } = req.query;

    if (!input || typeof input !== "string") {
      return res.status(400).json({
        error: "Bad Request",
        message: "Input parameter is required"
      });
    }

    if (input.length < 3) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Input must be at least 3 characters"
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      logger.error("[Places API] GOOGLE_MAPS_API_KEY is not configured");
      return res.status(500).json({
        error: "Server Configuration Error",
        message: "Places API is not configured"
      });
    }

    // Normalize province (only allow known codes)
    const provinceCode =
      typeof province === "string" && PROVINCE_BOUNDS[province.toUpperCase()]
        ? province.toUpperCase()
        : null;

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", input);
    url.searchParams.set("types", types as string);
    // Province lookups must be Canada-only regardless of any client override
    const componentsParam = provinceCode ? "country:ca" : (components as string);
    url.searchParams.set("components", componentsParam);
    if (provinceCode) {
      const { sw, ne } = PROVINCE_BOUNDS[provinceCode];
      url.searchParams.set("locationrestriction", `rectangle:${sw[0]},${sw[1]}|${ne[0]},${ne[1]}`);
      // Legacy autocomplete uses `location` + `radius` + `strictbounds`. Keep both
      // to maximise compatibility — the Places API will use whichever it accepts.
      const centerLat = (sw[0] + ne[0]) / 2;
      const centerLng = (sw[1] + ne[1]) / 2;
      url.searchParams.set("location", `${centerLat},${centerLng}`);
      url.searchParams.set("radius", "900000"); // ~900km covers all of NL
      url.searchParams.set("strictbounds", "true");
    }
    url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "REQUEST_DENIED") {
      logger.error("[Places API] Request denied:", data.error_message);
      return res.status(403).json({
        error: "API Error",
        message: "Places API request was denied"
      });
    }

    // Filter results to province (safety net — Google sometimes leaks edge results)
    let rawPredictions = data.predictions || [];
    if (provinceCode) {
      rawPredictions = rawPredictions.filter((p: any) =>
        predictionMatchesProvince(p, provinceCode)
      );
    }

    // Return only necessary data (don't expose raw API response)
    const predictions = rawPredictions.map((p: any) => ({
      place_id: p.place_id,
      description: p.description,
      structured_formatting: {
        main_text: p.structured_formatting?.main_text,
        secondary_text: p.structured_formatting?.secondary_text
      }
    }));

    res.json({
      status: data.status,
      predictions
    });
  } catch (error) {
    logger.error("[Places API] Autocomplete error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch address suggestions"
    });
  }
});

/**
 * GET /api/places/details
 * Proxy for Google Places Details API
 * 
 * Query params:
 * - place_id: The place ID from autocomplete (required)
 */
router.get("/details", async (req: Request, res: Response) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        error: "Too many requests",
        message: "Rate limit exceeded. Please try again later."
      });
    }

    const { place_id, province } = req.query;

    if (!place_id || typeof place_id !== "string") {
      return res.status(400).json({
        error: "Bad Request",
        message: "place_id parameter is required"
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      logger.error("[Places API] GOOGLE_MAPS_API_KEY is not configured");
      return res.status(500).json({
        error: "Server Configuration Error",
        message: "Places API is not configured"
      });
    }

    const provinceCode =
      typeof province === "string" && PROVINCE_BOUNDS[province.toUpperCase()]
        ? province.toUpperCase()
        : null;

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", place_id);
    url.searchParams.set("fields", "formatted_address,geometry,address_components");
    url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "REQUEST_DENIED") {
      logger.error("[Places API] Request denied:", data.error_message);
      return res.status(403).json({
        error: "API Error",
        message: "Places API request was denied"
      });
    }

    if (data.status !== "OK" || !data.result) {
      return res.status(404).json({
        error: "Not Found",
        message: "Place details not found"
      });
    }

    // Hard-validate that the chosen place is actually in the requested province
    if (provinceCode) {
      const components = data.result.address_components;
      if (!placeIsInProvince(components, provinceCode)) {
        return res.status(422).json({
          error: "Out of province",
          message: `Address must be within ${PROVINCE_BOUNDS[provinceCode].longName} (${provinceCode}). Please pick another address.`,
        });
      }
    }

    // Return only necessary data
    res.json({
      status: data.status,
      result: {
        formatted_address: data.result.formatted_address,
        geometry: data.result.geometry,
        address_components: data.result.address_components
      }
    });
  } catch (error) {
    logger.error("[Places API] Details error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch place details"
    });
  }
});

export default router;
