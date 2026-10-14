/**
 * Seller shop (PHP app) URLs, resolved per environment. Never hard-code a shop host.
 *
 * Each Vercel environment already points PHP_BRIDGE_API_URL at its own shop host
 * (production → shop.localcook.shop, preview/development → stagingwebapp.localcook.shop),
 * so the shop origin follows it. SHOP_BASE_URL overrides when set.
 */
const PRODUCTION_SHOP = 'https://shop.localcook.shop';
const STAGING_SHOP = 'https://stagingwebapp.localcook.shop';

export function getShopBaseUrl(): string {
  if (process.env.SHOP_BASE_URL) return process.env.SHOP_BASE_URL.replace(/\/+$/, '');
  try {
    if (process.env.PHP_BRIDGE_API_URL) return new URL(process.env.PHP_BRIDGE_API_URL).origin;
  } catch { /* fall through to the environment default */ }
  return process.env.VERCEL_ENV === 'production' ? PRODUCTION_SHOP : STAGING_SHOP;
}

export const getShopLoginUrl = () => `${getShopBaseUrl()}/app/shop/index.php`;

/** Shop login that lands on vendor onboarding (Stripe Connect setup) after sign-in. */
export function getVendorOnboardingUrl(): string {
  const base = getShopBaseUrl();
  return `${base}/app/shop/index.php?redirect=${encodeURIComponent(`${base}/app/shop/vendor_onboarding.php`)}`;
}

export const getSellerAnalyticsApiUrl = (shopId: string | number) =>
  `${getShopBaseUrl()}/app/seller_analytics_api.php?sid=${encodeURIComponent(String(shopId))}`;
