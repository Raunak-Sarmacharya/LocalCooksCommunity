// Seller shop (PHP app) URLs, resolved per environment. Never hard-code a shop host.
const PRODUCTION_SHOP = "https://shop.localcook.shop";
const STAGING_SHOP = "https://stagingwebapp.localcook.shop";
const PRODUCTION_HOSTS = new Set(["localcooks.ca", "www.localcooks.ca", "chef.localcooks.ca", "kitchen.localcooks.ca", "admin.localcooks.ca"]);

export function getShopBaseUrl(): string {
  const configured = import.meta.env.VITE_SHOP_BASE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  return PRODUCTION_HOSTS.has(host) ? PRODUCTION_SHOP : STAGING_SHOP;
}

export const getShopHomeUrl = () => `${getShopBaseUrl()}/app/shop/home.php`;

/** Shop login that lands on vendor onboarding (Stripe Connect setup) after sign-in. */
export function getVendorOnboardingUrl(): string {
  const base = getShopBaseUrl();
  return `${base}/app/shop/index.php?redirect=${encodeURIComponent(`${base}/app/shop/vendor_onboarding.php`)}`;
}
