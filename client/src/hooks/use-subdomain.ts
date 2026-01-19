import { useEffect, useState } from 'react';
import type { SubdomainType } from '@shared/subdomain-utils';
import { getSubdomainFromHostname } from '@shared/subdomain-utils';

/**
 * Hook to detect the current subdomain
 * @returns The current subdomain type
 */
export function useSubdomain(): SubdomainType {
  const [subdomain, setSubdomain] = useState<SubdomainType>(() => {
    // Initialize directly to avoid flash of wrong content
    if (typeof window !== 'undefined') {
      return getSubdomainFromHostname(window.location.hostname);
    }
    return null;
  });

  useEffect(() => {
    // Get subdomain from current hostname
    const hostname = window.location.hostname;
    const detected = getSubdomainFromHostname(hostname);
    setSubdomain(detected);
  }, []);

  return subdomain;
}

/**
 * Hook to get the base URL for the current subdomain
 * @returns The base URL
 */
export function useSubdomainUrl(): string {
  const subdomain = useSubdomain();
  const baseDomain = 'localcooks.ca';

  if (!subdomain || subdomain === 'main') {
    return `https://${baseDomain}`;
  }

  return `https://${subdomain}.${baseDomain}`;
}

