/**
 * Subdomain utility functions for routing
 */

/**
 * Extract subdomain from hostname
 * @param hostname - The hostname from the request (e.g., 'chef.localcooks.ca' or 'localhost:5000')
 * @returns The subdomain type or null
 */
export function getSubdomainFromHostname(hostname) {
  if (!hostname) return null;

  // Remove port if present
  const hostWithoutPort = hostname.split(':')[0];

  // Split by dots
  const parts = hostWithoutPort.split('.');

  // Handle localhost subdomains (development)
  // For 'chef.localhost', parts would be ['chef', 'localhost']
  // For 'localhost', parts would be ['localhost']
  if (hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1') {
    return 'main'; // Default to main for plain localhost
  }

  // Check for localhost subdomains (e.g., chef.localhost, driver.localhost)
  if (parts.length === 2 && parts[1] === 'localhost') {
    const subdomain = parts[0].toLowerCase();
    switch (subdomain) {
      case 'chef':
        return 'chef';
      case 'driver':
        return 'driver';
      case 'kitchen':
        return 'kitchen';
      case 'admin':
        return 'admin';
      default:
        return 'main'; // Unknown subdomain, treat as main
    }
  }

  // Handle production subdomains
  // For 'chef.localcooks.ca', parts would be ['chef', 'localcooks', 'ca']
  // For 'localcooks.ca', parts would be ['localcooks', 'ca']
  if (parts.length >= 3) {
    const subdomain = parts[0].toLowerCase();
    
    switch (subdomain) {
      case 'chef':
        return 'chef';
      case 'driver':
        return 'driver';
      case 'kitchen':
        return 'kitchen';
      case 'admin':
        return 'admin';
      default:
        return null; // Unknown subdomain, treat as main
    }
  }

  // No subdomain (main domain)
  return 'main';
}

/**
 * Get the base URL for a given subdomain type
 * @param subdomainType - The subdomain type
 * @param baseDomain - The base domain (default: 'localcooks.ca')
 * @returns The full URL
 */
export function getSubdomainUrl(subdomainType, baseDomain = 'localcooks.ca') {
  if (!subdomainType || subdomainType === 'main') {
    return `https://${baseDomain}`;
  }
  return `https://${subdomainType}.${baseDomain}`;
}

/**
 * Get subdomain from request headers (for server-side)
 * @param headers - Request headers object
 * @returns The subdomain type
 */
export function getSubdomainFromHeaders(headers) {
  // Check x-forwarded-host first (Vercel sets this)
  const forwardedHost = headers['x-forwarded-host'] || headers['x-vercel-deployment-url'];
  if (forwardedHost) {
    const hostname = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
    return getSubdomainFromHostname(hostname);
  }

  // Fallback to host header
  const host = headers['host'];
  if (host) {
    const hostname = Array.isArray(host) ? host[0] : host;
    return getSubdomainFromHostname(hostname);
  }

  return null;
}

/**
 * Check if a route should be accessible from a given subdomain
 * @param subdomainType - The subdomain type
 * @param routePath - The route path
 * @returns Whether the route is accessible
 */
export function isRouteAccessibleFromSubdomain(subdomainType, routePath) {
  // Admin routes only accessible from admin subdomain
  if (routePath.startsWith('/admin')) {
    return subdomainType === 'admin';
  }

  // Manager routes - accessible from admin and kitchen subdomains
  if (routePath.startsWith('/manager')) {
    return subdomainType === 'admin' || subdomainType === 'kitchen';
  }

  // Portal routes - accessible from kitchen subdomain
  if (routePath.startsWith('/portal')) {
    return subdomainType === 'kitchen';
  }

  // Chef routes - accessible from chef subdomain
  if (routePath.startsWith('/apply') || routePath.startsWith('/dashboard') || 
      routePath.startsWith('/book-kitchen') || routePath.startsWith('/share-profile')) {
    return subdomainType === 'chef';
  }

  // Delivery partner routes - accessible from driver subdomain
  if (routePath.startsWith('/delivery-partner-apply')) {
    return subdomainType === 'driver';
  }

  // Auth routes - accessible from all subdomains
  if (routePath.startsWith('/auth') || routePath.startsWith('/driver-auth') || 
      routePath.startsWith('/forgot-password') || routePath.startsWith('/password-reset')) {
    return true;
  }

  // Public routes - accessible from all
  if (routePath === '/' || routePath.startsWith('/terms') || routePath.startsWith('/privacy') || 
      routePath.startsWith('/success') || routePath.startsWith('/email-action')) {
    return true;
  }

  // Default: accessible from all subdomains
  return true;
}

