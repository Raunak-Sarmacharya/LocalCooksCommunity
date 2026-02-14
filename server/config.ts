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
 * getAppBaseUrl('kitchen') // => 'http://kitchen.localhost:5001'
 */
export function getAppBaseUrl(subdomain: SubdomainType = 'main'): string {
    const isDev = process.env.NODE_ENV === 'development';
    const isVercel = !!process.env.VERCEL;
    const isVercelPreview = process.env.VERCEL_ENV === 'preview';

    // Local development (not on Vercel) — use localhost
    if (isDev && !isVercel) {
        const port = process.env.PORT || '5001';
        
        if (subdomain === 'main' || !subdomain) {
            return `http://localhost:${port}`;
        }
        
        // Use subdomain.localhost for proper subdomain routing in dev
        return `http://${subdomain}.localhost:${port}`;
    }

    // Vercel (Preview or Production)
    const baseDomain = process.env.APP_BASE_DOMAIN || 'localcooks.ca';
    const prefix = isVercelPreview ? 'dev-' : '';

    if (subdomain === 'main' || !subdomain) {
        return isVercelPreview ? `https://dev.${baseDomain}` : `https://${baseDomain}`;
    }

    return `https://${prefix}${subdomain}.${baseDomain}`;
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
