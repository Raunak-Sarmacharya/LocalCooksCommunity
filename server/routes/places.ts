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

    const { input, types = "address", components = "country:us|country:ca" } = req.query;

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
      console.error("[Places API] GOOGLE_MAPS_API_KEY is not configured");
      return res.status(500).json({
        error: "Server Configuration Error",
        message: "Places API is not configured"
      });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", input);
    url.searchParams.set("types", types as string);
    url.searchParams.set("components", components as string);
    url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "REQUEST_DENIED") {
      console.error("[Places API] Request denied:", data.error_message);
      return res.status(403).json({
        error: "API Error",
        message: "Places API request was denied"
      });
    }

    // Return only necessary data (don't expose raw API response)
    const predictions = (data.predictions || []).map((p: any) => ({
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
    console.error("[Places API] Autocomplete error:", error);
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

    const { place_id } = req.query;

    if (!place_id || typeof place_id !== "string") {
      return res.status(400).json({
        error: "Bad Request",
        message: "place_id parameter is required"
      });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      console.error("[Places API] GOOGLE_MAPS_API_KEY is not configured");
      return res.status(500).json({
        error: "Server Configuration Error",
        message: "Places API is not configured"
      });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", place_id);
    url.searchParams.set("fields", "formatted_address,geometry,address_components");
    url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "REQUEST_DENIED") {
      console.error("[Places API] Request denied:", data.error_message);
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
    console.error("[Places API] Details error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch place details"
    });
  }
});

export default router;
