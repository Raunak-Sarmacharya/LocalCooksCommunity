/**
 * Subdomain utility functions for routing
 */

export type SubdomainType = 'chef' | 'kitchen' | 'admin' | 'main' | null;

/**
 * Extract subdomain from hostname
 * @param hostname - The hostname from the request (e.g., 'chef.localcooks.ca' or 'localhost:5000')
 * @returns The subdomain type or null
 */
export function getSubdomainFromHostname(hostname: string): SubdomainType {
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

  // Check for localhost subdomains (e.g., chef.localhost, kitchen.localhost)
  if (parts.length === 2 && parts[1] === 'localhost') {
    const subdomain = parts[0].toLowerCase();
    switch (subdomain) {
      case 'chef':
        return 'chef';
      case 'kitchen':
        return 'kitchen';
      case 'admin':
        return 'admin';
      default:
        return 'main'; // Unknown subdomain, treat as main
    }
  }

  // Handle production and dev subdomains
  // For 'chef.localcooks.ca', parts would be ['chef', 'localcooks', 'ca']
  // For 'dev-chef.localcooks.ca', parts would be ['dev-chef', 'localcooks', 'ca']
  // For 'localcooks.ca', parts would be ['localcooks', 'ca']
  if (parts.length >= 3) {
    const subdomain = parts[0].toLowerCase();
    
    switch (subdomain) {
      case 'chef':
      case 'dev-chef':
        return 'chef';
      case 'kitchen':
      case 'dev-kitchen':
        return 'kitchen';
      case 'admin':
      case 'dev-admin':
        return 'admin';
      case 'dev':
        return 'main';
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
export function getSubdomainUrl(subdomainType: SubdomainType, baseDomain: string = 'localcooks.ca'): string {
  if (!subdomainType || subdomainType === 'main') {
    return `https://${baseDomain}`;
  }
  return `https://${subdomainType}.${baseDomain}`;
}

/**
 * Check if the current hostname is a dev environment subdomain
 * @param hostname - The hostname to check
 * @returns true if hostname is a dev-* subdomain
 */
export function isDevSubdomain(hostname: string): boolean {
  if (!hostname) return false;
  const hostWithoutPort = hostname.split(':')[0];
  const parts = hostWithoutPort.split('.');
  if (parts.length >= 3) {
    return parts[0].toLowerCase().startsWith('dev');
  }
  return false;
}

/**
 * True for Vercel preview deploys, or when already on a `dev-*` host.
 * Production (`VERCEL_ENV=production`) and plain local hosts are false.
 */
export function isPreviewDeployment(
  hostname?: string,
  vercelEnv?: string | null
): boolean {
  if (vercelEnv === 'preview') return true;
  if (hostname && isDevSubdomain(hostname)) return true;
  return false;
}

/**
 * Origin URL for a role subdomain in the current environment.
 * - Local: http://chef.localhost:5001
 * - Preview (`VERCEL_ENV=preview` or `dev-*` host): https://dev-chef.localcooks.ca
 * - Production: https://chef.localcooks.ca
 */
export function getSubdomainOriginForEnvironment(
  subdomainType: 'chef' | 'kitchen' | 'admin',
  hostname: string,
  options?: { port?: string; protocol?: string; vercelEnv?: string | null }
): string {
  const hostWithoutPort = hostname.split(':')[0].toLowerCase();

  if (
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort.endsWith('.localhost')
  ) {
    const proto = options?.protocol ?? 'http:';
    const p = options?.port || '5001';
    const portSuffix = p ? `:${p}` : '';
    return `${proto}//${subdomainType}.localhost${portSuffix}`;
  }

  const isDev = isPreviewDeployment(hostname, options?.vercelEnv);
  const prefix = isDev ? 'dev-' : '';
  const parts = hostWithoutPort.split('.');
  // vercel.app / single-label hosts → fall back to localcooks.ca
  const baseDomain =
    parts.length >= 2 && !hostWithoutPort.endsWith('.vercel.app')
      ? parts.slice(-2).join('.')
      : 'localcooks.ca';
  return `https://${prefix}${subdomainType}.${baseDomain}`;
}

/**
 * Login/auth origin for a user role (manager → kitchen subdomain).
 * Preview → https://dev-chef.localcooks.ca ; production → https://chef.localcooks.ca
 */
export function getRoleLoginOrigin(
  role: string | null | undefined,
  hostname: string,
  options?: { port?: string; protocol?: string; vercelEnv?: string | null }
): string {
  const normalized = (role || 'chef').toLowerCase();
  const subdomainType: 'chef' | 'kitchen' | 'admin' =
    normalized === 'manager' || normalized === 'kitchen'
      ? 'kitchen'
      : normalized === 'admin'
        ? 'admin'
        : 'chef';
  return getSubdomainOriginForEnvironment(subdomainType, hostname, options);
}

/**
 * Chef dashboard path + whether a cross-subdomain redirect is required.
 */
export function resolveChefDashboardNavigation(
  view?: string,
  hostname: string = typeof globalThis !== 'undefined' && typeof window !== 'undefined'
    ? window.location.hostname
    : 'localcooks.ca',
  port: string = typeof globalThis !== 'undefined' && typeof window !== 'undefined'
    ? window.location.port
    : '',
  vercelEnv?: string | null
): { path: string; href: string; sameOrigin: boolean } {
  const path =
    !view || view === 'overview'
      ? '/dashboard'
      : `/dashboard?view=${encodeURIComponent(view)}`;
  const origin = getSubdomainOriginForEnvironment('chef', hostname, {
    port,
    protocol: typeof window !== 'undefined' ? window.location.protocol : 'https:',
    vercelEnv,
  });
  const sameOrigin =
    typeof window !== 'undefined' ? window.location.origin === origin : true;
  return { path, href: `${origin}${path}`, sameOrigin };
}

/** Full-page redirect to chef dashboard when not already on chef origin. */
export function goToChefDashboard(view?: string, vercelEnv?: string | null): void {
  if (typeof window === 'undefined') return;
  const { path, href, sameOrigin } = resolveChefDashboardNavigation(
    view,
    window.location.hostname,
    window.location.port,
    vercelEnv
  );
  if (sameOrigin) {
    window.location.assign(path);
    return;
  }
  window.location.href = href;
}

/**
 * Get the subdomain URL for the correct environment (prod or dev)
 * @param subdomainType - The subdomain type
 * @param hostname - Current hostname to detect dev vs prod
 * @param baseDomain - The base domain
 * @returns The full URL with correct subdomain prefix
 */
export function getSubdomainUrlForEnvironment(
  subdomainType: SubdomainType,
  hostname: string,
  baseDomain: string = 'localcooks.ca',
  vercelEnv?: string | null
): string {
  if (!subdomainType || subdomainType === 'main') {
    const isDev = isPreviewDeployment(hostname, vercelEnv);
    return isDev ? `https://dev.${baseDomain}` : `https://${baseDomain}`;
  }
  return getSubdomainOriginForEnvironment(subdomainType, hostname, { vercelEnv });
}

/**
 * Get subdomain from request headers (for server-side)
 * @param headers - Request headers object
 * @returns The subdomain type
 */
export function getSubdomainFromHeaders(headers: Record<string, string | string[] | undefined>): SubdomainType {
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
export function isRouteAccessibleFromSubdomain(subdomainType: SubdomainType, routePath: string): boolean {
  // Admin routes only accessible from admin subdomain
  if (routePath.startsWith('/admin')) {
    return subdomainType === 'admin';
  }

  // Manager routes - accessible from admin and kitchen subdomains
  if (routePath.startsWith('/manager')) {
    return subdomainType === 'admin' || subdomainType === 'kitchen';
  }

  // Chef routes - accessible from chef subdomain
  if (routePath.startsWith('/apply') || routePath.startsWith('/dashboard') || 
      routePath.startsWith('/book-kitchen')) {
    return subdomainType === 'chef';
  }

  // Auth routes - accessible from all subdomains
  if (routePath.startsWith('/auth') || 
      routePath.startsWith('/forgot-password') || routePath.startsWith('/password-reset')) {
    return true;
  }

  // Public routes - accessible from all
  if (routePath === '/' || routePath.startsWith('/terms') || routePath.startsWith('/privacy') || 
      routePath.startsWith('/success') || routePath.startsWith('/email-action') ||
      routePath.startsWith('/resources')) {
    return true;
  }

  // Default: accessible from all subdomains
  return true;
}

/**
 * Get the required subdomain for a user role
 * @param role - The user role
 * @returns The required subdomain type for that role
 */
export function getRequiredSubdomainForRole(role: string | null | undefined): SubdomainType {
  if (!role) return null;
  
  switch (role.toLowerCase()) {
    case 'chef':
      return 'chef';
    case 'manager':
      return 'kitchen';
    case 'admin':
      return 'admin';
    default:
      return null;
  }
}

/**
 * Check if a user role is allowed to login from the given subdomain
 * @param role - The user role
 * @param subdomain - The subdomain from the request
 * @param isPortalUser - Whether the user is a portal user (portal users can login from kitchen subdomain)
 * @param isChef - Whether the user has chef flag (for users with role: null but isChef: true)
 * @param isManager - Whether the user has manager flag
 * @returns Whether the login is allowed
 */
export function isRoleAllowedForSubdomain(
  role: string | null | undefined,
  subdomain: SubdomainType,
  isPortalUser: boolean = false,
  isChef: boolean = false,
  isManager: boolean = false
): boolean {
  // Portal users can login from kitchen subdomain
  if (isPortalUser && subdomain === 'kitchen') {
    return true;
  }
  
  // Determine effective role from role field or flags
  let effectiveRole = role;
  
  // If role is null/undefined, determine from flags
  if (!effectiveRole) {
    if (isManager) {
      effectiveRole = 'manager';
    } else if (isChef) {
      effectiveRole = 'chef';
    }
  }
  
  const requiredSubdomain = getRequiredSubdomainForRole(effectiveRole);
  
  // If no required subdomain found, deny access (strict enforcement)
  if (!requiredSubdomain) {
    return false;
  }
  
  // Must match the required subdomain exactly
  return subdomain === requiredSubdomain;
}

