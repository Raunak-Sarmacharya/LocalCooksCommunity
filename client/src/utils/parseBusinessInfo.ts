/**
 * Business Info Parser Utility
 * 
 * Parses the businessDescription JSON field stored in kitchen applications.
 * This field contains chef business details submitted during the application process.
 * 
 * @module utils/parseBusinessInfo
 */

/**
 * Business information structure stored in the businessDescription JSON field.
 * All fields are optional as they depend on location requirements.
 */
export interface BusinessInfo {
    /** Chef's business or company name */
    businessName?: string;
    /** Type of business (e.g., catering, meal prep, bakery) */
    businessType?: string;
    /** Years of cooking experience (e.g., "0-2", "3-5", "5+") */
    experience?: string;
    /** Free-text business description */
    description?: string;
    /** Expected kitchen usage frequency (e.g., "daily", "weekly") */
    usageFrequency?: string;
    /** Typical session duration in hours */
    sessionDuration?: string;
    /** Food handler certificate expiry date (ISO string) */
    foodHandlerCertExpiry?: string;
    /** Food establishment certificate expiry date (ISO string) */
    foodEstablishmentCertExpiry?: string;
}

/**
 * Parses the businessDescription JSON string into a typed BusinessInfo object.
 * Handles both valid JSON and plain text descriptions gracefully.
 * 
 * @param description - The raw businessDescription string from the application
 * @returns Parsed BusinessInfo object, or null if no description provided
 * 
 * @example
 * // Valid JSON input
 * parseBusinessInfo('{"businessName":"Satya Bakery","experience":"0-2"}')
 * // Returns: { businessName: "Satya Bakery", experience: "0-2" }
 * 
 * @example
 * // Plain text fallback
 * parseBusinessInfo("Just a simple text description")
 * // Returns: { description: "Just a simple text description" }
 * 
 * @example
 * // Null/undefined input
 * parseBusinessInfo(null)
 * // Returns: null
 */
export function parseBusinessInfo(description: string | null | undefined): BusinessInfo | null {
    if (!description) return null;

    try {
        const parsed = JSON.parse(description);
        // Ensure we got an object, not a primitive
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as BusinessInfo;
        }
        // If JSON parsed to a primitive, treat as plain description
        return { description: String(parsed) };
    } catch {
        // Not valid JSON - treat as plain text description
        return { description };
    }
}

/**
 * Formats the experience value for display with proper labeling.
 * 
 * @param experience - Raw experience value (e.g., "0-2", "5+")
 * @returns Formatted string (e.g., "0-2 years") or "N/A" if not provided
 */
export function formatExperience(experience: string | undefined): string {
    if (!experience) return 'N/A';
    // If already contains "year", return as-is
    if (experience.toLowerCase().includes('year')) return experience;
    return `${experience} years`;
}

/**
 * Formats a date string for display.
 * 
 * @param dateString - ISO date string
 * @returns Formatted date (e.g., "Sep 13, 2027") or "N/A" if invalid
 */
export function formatExpiryDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return 'N/A';
    }
}
