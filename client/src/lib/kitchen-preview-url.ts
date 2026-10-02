import { DEFAULT_LOCALE, isAppLocale } from '@shared/i18n';
import { getSubdomainOriginForEnvironment } from '@shared/subdomain-utils';
import { buildLocalizedPath, parseLocationLocale } from '@/i18n/routing';

export function kitchenPathSlug(name: string): string {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || 'kitchen';
}

export function kitchenPreviewHref(location: string | number, kitchen: { name: string; slug?: string | null }): string {
  return `/kitchen/${encodeURIComponent(String(location))}/${encodeURIComponent(kitchen.slug || kitchenPathSlug(kitchen.name))}`;
}

export function canonicalKitchenHref(path: string, locationSlug: string, kitchen: { name: string; slug?: string | null }, search = '', hash = ''): string {
  const match = path.match(/\/(?:kitchen-preview|kitchen)\//);
  const prefix = match ? path.slice(0, match.index) : '';
  const params = new URLSearchParams(search);
  params.delete('kitchenId');
  const remainingSearch = params.toString();
  return `${prefix}${kitchenPreviewHref(locationSlug, kitchen)}${remainingSearch ? `?${remainingSearch}` : ''}${hash}`;
}

export function chefKitchenShareUrl(path: string, current: { hostname: string; port: string; protocol: string }, language?: string): string {
  const parsed = parseLocationLocale(path);
  const locale = parsed.hasLocalePrefix ? parsed.locale : isAppLocale(language) ? language : DEFAULT_LOCALE;
  const origin = getSubdomainOriginForEnvironment('chef', current.hostname, {
    port: current.port,
    protocol: current.protocol,
  });
  return `${origin}${buildLocalizedPath(path, locale)}`;
}

export async function shareKitchenLink(url: string, title: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Desktop browsers may expose Web Share without supporting this payload.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
