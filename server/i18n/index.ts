import i18n, { type TFunction } from "i18next";
import ICU from "i18next-icu";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  I18N_NAMESPACES,
  buildFallbackLng,
  isAppLocale,
  type AppLocale,
  type I18nNamespace,
} from "@shared/i18n";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve catalog path for both tsx (dev) and compiled dist layouts. */
function catalogPath(locale: string, namespace: string): string {
  const candidates = [
    join(__dirname, "../../shared/i18n/locales", locale, `${namespace}.json`),
    join(process.cwd(), "shared/i18n/locales", locale, `${namespace}.json`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function loadNamespace(locale: string, namespace: string): Record<string, unknown> {
  const path = catalogPath(locale, namespace);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    // Fallback to require for CJS bundling edge cases
    try {
      return require(path) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function buildResources(): Record<string, Record<string, Record<string, unknown>>> {
  const resources: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    resources[locale] = {};
    for (const ns of I18N_NAMESPACES) {
      resources[locale][ns] = loadNamespace(locale, ns);
    }
  }
  return resources;
}

let initPromise: Promise<TFunction> | null = null;

export function initServerI18n(): Promise<TFunction> {
  if (initPromise) return initPromise;
  if (i18n.isInitialized) {
    initPromise = Promise.resolve(i18n.t.bind(i18n));
    return initPromise;
  }

  initPromise = i18n
    .use(ICU)
    .init({
      lng: DEFAULT_LOCALE,
      fallbackLng: buildFallbackLng(),
      supportedLngs: [...SUPPORTED_LOCALES],

      defaultNS: "common",
      ns: [...I18N_NAMESPACES],
      resources: buildResources(),
      interpolation: { escapeValue: false },
      load: "currentOnly",
      returnNull: false,
      returnEmptyString: false,
    } as Parameters<typeof i18n.init>[0])
    .then(() => i18n.t.bind(i18n));

  return initPromise;
}

export function resolveLocale(raw?: string | null): AppLocale {
  return isAppLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * Translate for a specific locale (email/SMS/PDF). Does not mutate global lng.
 */
export function tLocale(
  locale: string | null | undefined,
  key: string,
  options?: Record<string, unknown> & { ns?: I18nNamespace }
): string {
  const lng = resolveLocale(locale);
  if (!i18n.isInitialized) {
    // Sync bootstrap for early callers — catalogs are local files
    void initServerI18n();
  }
  return String(
    i18n.t(key as never, { lng, ...(options as object) } as never)
  );
}

export async function ensureServerI18n(): Promise<void> {
  await initServerI18n();
}

export { i18n as serverI18n };
