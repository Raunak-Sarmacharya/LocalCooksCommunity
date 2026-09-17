/**
 * Maps an email address to its webmail inbox.
 *
 * "Check your inbox" is only worth saying if it is one click. Two details make
 * that work: detect the provider from the domain, and **name it on the button**
 * ("Open Gmail", not "Open your email"). A generic link reads as decoration and
 * gets ignored; a named one gets clicked.
 *
 * Only known consumer providers are mapped. A corporate domain is very often
 * Google Workspace or Microsoft 365, but that cannot be told from the address
 * alone — and guessing wrong drops someone on a login page for an account they
 * do not have, which is worse than showing no button at all. Unknown domains
 * return `null` and the caller falls back to plain advice.
 *
 * These are inbox URLs rather than search links: `#search/from:…` style URLs
 * are undocumented, change without notice, and land on an empty result when the
 * message has not arrived yet — which is exactly the moment this is used.
 */

/** Stable key for the brand mark rendered beside the provider name. */
export type EmailProviderBrand =
  | "gmail"
  | "outlook"
  | "yahoo"
  | "icloud"
  | "proton"
  | "gmx"
  | "zoho"
  | "qq"
  | "tuta"
  | "mailcom"
  | "generic";

export interface EmailProvider {
  /** Shown after the brand mark, e.g. "Gmail". */
  name: string;
  /** The provider's inbox, for a signed-in user. */
  inboxUrl: string;
  /** Lookup key for the colored brand icon. */
  brand: EmailProviderBrand;
}

const GMAIL: EmailProvider = {
  name: "Gmail",
  inboxUrl: "https://mail.google.com/mail/u/0/",
  brand: "gmail",
};
const OUTLOOK: EmailProvider = {
  name: "Outlook",
  inboxUrl: "https://outlook.live.com/mail/0/inbox",
  brand: "outlook",
};
const ICLOUD: EmailProvider = {
  name: "iCloud Mail",
  inboxUrl: "https://www.icloud.com/mail",
  brand: "icloud",
};
const PROTON: EmailProvider = {
  name: "Proton Mail",
  inboxUrl: "https://mail.proton.me/",
  brand: "proton",
};
const YAHOO: EmailProvider = {
  name: "Yahoo Mail",
  inboxUrl: "https://mail.yahoo.com/",
  brand: "yahoo",
};
const GMX: EmailProvider = {
  name: "GMX",
  inboxUrl: "https://www.gmx.com/",
  brand: "gmx",
};

/** Matched on the whole domain. */
const EXACT_DOMAINS: Record<string, EmailProvider> = {
  "gmail.com": GMAIL,
  "googlemail.com": GMAIL,
  "outlook.com": OUTLOOK,
  "hotmail.com": OUTLOOK,
  "live.com": OUTLOOK,
  "msn.com": OUTLOOK,
  "icloud.com": ICLOUD,
  "me.com": ICLOUD,
  "mac.com": ICLOUD,
  "proton.me": PROTON,
  "protonmail.com": PROTON,
  "aol.com": { name: "AOL Mail", inboxUrl: "https://mail.aol.com/", brand: "generic" },
  "zoho.com": { name: "Zoho Mail", inboxUrl: "https://mail.zoho.com/", brand: "zoho" },
  "fastmail.com": { name: "Fastmail", inboxUrl: "https://app.fastmail.com/", brand: "generic" },
  "tutanota.com": { name: "Tuta", inboxUrl: "https://mail.tutanota.com/", brand: "tuta" },
  "tuta.com": { name: "Tuta", inboxUrl: "https://mail.tutanota.com/", brand: "tuta" },
  "mail.com": { name: "mail.com", inboxUrl: "https://www.mail.com/mail/", brand: "mailcom" },
  "qq.com": { name: "QQ Mail", inboxUrl: "https://mail.qq.com/", brand: "qq" },
  "163.com": { name: "NetEase Mail", inboxUrl: "https://mail.163.com/", brand: "generic" },
  "126.com": { name: "NetEase Mail", inboxUrl: "https://mail.126.com/", brand: "generic" },
};

/**
 * Matched on the domain's first label, so `yahoo.ca`, `yahoo.co.uk` and
 * `yahoo.com` all resolve without listing every country domain.
 */
const DOMAIN_FAMILIES: Record<string, EmailProvider> = {
  yahoo: YAHOO,
  // Hotmail and Live also ship country domains (hotmail.ca, live.co.uk), so the
  // whole family maps to the same Outlook inbox.
  hotmail: OUTLOOK,
  live: OUTLOOK,
  gmx: GMX,
  yandex: { name: "Yandex Mail", inboxUrl: "https://mail.yandex.com/", brand: "generic" },
  rambler: { name: "Rambler Mail", inboxUrl: "https://mail.rambler.ru/", brand: "generic" },
};

/** `web.de` and `gmx.de` are the same provider but not the same label. */
const WEB_DE: EmailProvider = { name: "WEB.DE", inboxUrl: "https://web.de/", brand: "generic" };

/** Returns the provider's inbox for a known address, or `null` if unrecognised. */
export function emailProviderFor(email: string | null | undefined): EmailProvider | null {
  if (!email) return null;

  const at = email.lastIndexOf("@");
  if (at === -1) return null;

  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;

  if (domain === "web.de") return WEB_DE;

  const exact = EXACT_DOMAINS[domain];
  if (exact) return exact;

  const family = DOMAIN_FAMILIES[domain.split(".")[0]];
  return family ?? null;
}
