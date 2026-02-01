/**
 * Server Configuration Module
 * 
 * Centralized configuration for environment-aware settings.
 * Provides subdomain-aware URL resolution for Stripe OAuth redirects
 * and other cross-domain functionality.
 */

type SubdomainType = 'kitchen' | 'chef' | 'admin' | 'main';

/**
 * Get the application base URL for a specific subdomain.
 * 
 * In development: Returns localhost with the appropriate port.
 * In production: Returns the subdomain-prefixed production domain.
 * 
 * @param subdomain - The subdomain type ('kitchen', 'chef', 'admin', 'main')
 * @returns The full base URL (e.g., 'https://kitchen.localcooks.ca')
 * 
 * @example
 * // In production for manager routes:
 * getAppBaseUrl('kitchen') // => 'https://kitchen.localcooks.ca'
 * 
 * // In development:
 * getAppBaseUrl('kitchen') // => 'http://localhost:5173'
 */
export function getAppBaseUrl(subdomain: SubdomainType = 'main'): string {
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
        // Development: Use localhost with Vite port
        // Port 5173 is the Vite dev server default
        const port = process.env.VITE_PORT || '5173';
        return `http://localhost:${port}`;
    }

    // Production: Use the configured base domain with subdomain prefix
    const baseDomain = process.env.APP_BASE_DOMAIN || 'localcooks.ca';

    if (subdomain === 'main' || !subdomain) {
        return `https://${baseDomain}`;
    }

    return `https://${subdomain}.${baseDomain}`;
}

/**
 * Get the server port for the backend.
 * 
 * @returns The port number as a string
 */
export function getServerPort(): string {
    return process.env.PORT || (process.env.NODE_ENV === 'development' ? '5001' : '5000');
}

/**
 * Check if the application is running in development mode.
 * 
 * @returns true if NODE_ENV is 'development'
 */
export function isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
}

/**
 * Check if the application is running in production mode.
 * 
 * @returns true if NODE_ENV is not 'development'
 */
export function isProduction(): boolean {
    return process.env.NODE_ENV !== 'development';
}
