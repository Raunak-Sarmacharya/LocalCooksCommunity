#!/usr/bin/env node
/**
 * CI gate for i18n catalogs and client key usage.
 * Usage: node scripts/i18n-lint.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const localeRoot = join(repoRoot, "shared", "i18n", "locales");
const clientRoot = join(repoRoot, "client", "src");
const SOURCE = "en-CA";
const TARGETS = ["fr-CA", "uk"];

const MANAGER_PATH_RE =
  /(?:pages\/Manager|components\/manager|layouts\/DashboardLayout|layouts\/ManagerBookingLayout|components\/app-sidebar|components\/layout\/ManagerHeader|pages\/KitchenAvailability|pages\/StorageListing|pages\/EquipmentListing|pages\/KitchenPricing)/;

/** Legacy manager pages not wired in App.tsx — skip hardcoded-string audit */
const MANAGER_LINT_SKIP = new Set([
  "client/src/pages/ManagerChefProfiles.tsx",
  "client/src/pages/ManagerPortalApplications.tsx",
]);

function flatten(obj, prefix = "") {
  /** @type {string[]} */
  const keys = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) keys.push(prefix);
    return keys;
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flatten(v, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

function loadJson(locale, ns) {
  const path = join(localeRoot, locale, `${ns}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx|ts)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** @type {Map<string, Set<string>>} */
const catalogKeys = new Map();

let errors = 0;

// ── 1. Catalog parity + empty values ─────────────────────────────────────
const sourceNs = readdirSync(join(localeRoot, SOURCE))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

for (const ns of sourceNs) {
  const source = loadJson(SOURCE, ns);
  if (!source) continue;
  const sourceKeys = new Set(flatten(source));
  catalogKeys.set(ns, sourceKeys);

  for (const locale of TARGETS) {
    const target = loadJson(locale, ns);
    if (!target) {
      console.error(`[missing file] ${locale}/${ns}.json`);
      errors++;
      continue;
    }
    const targetKeys = new Set(flatten(target));
    for (const key of sourceKeys) {
      if (!targetKeys.has(key)) {
        console.error(`[missing key] ${locale}/${ns}.json → ${key}`);
        errors++;
      }
    }
    for (const key of targetKeys) {
      if (!sourceKeys.has(key)) {
        console.error(`[extra key] ${locale}/${ns}.json → ${key}`);
        errors++;
      }
    }
    for (const key of sourceKeys) {
      const parts = key.split(".");
      let cur = target;
      for (const p of parts) cur = cur?.[p];
      if (typeof cur === "string" && cur.trim() === "") {
        console.error(`[empty value] ${locale}/${ns}.json → ${key}`);
        errors++;
      }
    }
  }
}

// ── 2. Used keys must exist in en-CA catalogs ─────────────────────────────
const usedManagerKeys = new Set();
const usedKitchenKeys = new Set();
const usedChefKeys = new Set();
const usedBookingKeys = new Set();
const usedCommonKeys = new Set();

const mtCallRe = /\bmt\s*\(\s*["']([^"']+)["']/g;
const nsCallRe = /\b(?:kt|ct|bt|tt)\s*\(\s*["']([^"']+)["']/g;
const tCallRe =
  /\bt\s*\(\s*(?:\[\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\]|["']([^"']+)["'])(?:\s*,\s*\{[^}]*\bns\s*:\s*["']([^"']+)["'])?/g;

for (const file of walk(clientRoot)) {
  const text = readFileSync(file, "utf8");

  let m;
  mtCallRe.lastIndex = 0;
  while ((m = mtCallRe.exec(text))) {
    const key = m[1];
    if (key && !key.includes("${")) usedManagerKeys.add(key);
  }

  nsCallRe.lastIndex = 0;
  while ((m = nsCallRe.exec(text))) {
    const key = m[1];
    if (!key || key.includes("${")) continue;
    const fn = m[0].slice(0, 2);
    if (fn === "kt") usedKitchenKeys.add(key);
    else if (fn === "ct") usedChefKeys.add(key);
    else if (fn === "bt") usedBookingKeys.add(key);
    else if (fn === "tt") usedCommonKeys.add(key);
  }

  if (!text.includes("useTranslation") && !text.includes(".t(")) continue;

  // Only verify useTranslation t() keys for manager namespace (legacy coverage)
  let defaultNs = "common";
  const useTr = text.match(/useTranslation\s*\(\s*["']([^"']+)["']\s*\)/);
  if (useTr) defaultNs = useTr[1];
  if (defaultNs !== "manager") continue;

  tCallRe.lastIndex = 0;
  while ((m = tCallRe.exec(text))) {
    const tupleNs = m[1];
    const tupleKey = m[2];
    const plainKey = m[3];
    const optNs = m[4];
    const ns = tupleNs ?? optNs ?? defaultNs;
    const key = tupleKey ?? plainKey;
    if (!key || key.includes("${") || ns !== "manager") continue;
    usedManagerKeys.add(key);
  }
}

function verifyUsedKeys(ns, used) {
  const catalog = catalogKeys.get(ns);
  if (!catalog) return;
  for (const key of used) {
    if (!catalog.has(key)) {
      console.error(`[missing used key] en-CA/${ns}.json → ${key}`);
      errors++;
    }
  }
}

verifyUsedKeys("manager", usedManagerKeys);
verifyUsedKeys("kitchen", usedKitchenKeys);
verifyUsedKeys("chef", usedChefKeys);
verifyUsedKeys("booking", usedBookingKeys);
verifyUsedKeys("common", usedCommonKeys);

// ── 3. Likely hardcoded visible strings in manager surfaces ───────────────
const jsxTextRe = />\s*([A-Za-z][^<{]{3,}?)\s*</g;
const attrRe =
  /(?:title|description|label|placeholder|aria-label)=["']([A-Za-z][^"'{]{3,})["']/g;
const toastRe = /toast\(\{[^}]*?(?:title|description):\s*["']([A-Za-z][^"']{3,})["']/g;

const allowLiteral = new Set([
  "LocalCooks",
  "CAD",
  "Stripe",
  "OK",
  "ID",
  "PDF",
  "SMS",
  "UTC",
  "GMT",
  "KB",
  "SB",
  "EXT",
  "OP",
  "DC",
]);

for (const file of walk(clientRoot)) {
  const rel = relative(repoRoot, file);
  if (!MANAGER_PATH_RE.test(rel)) continue;
  if (rel.includes(".test.")) continue;
  if (MANAGER_LINT_SKIP.has(rel)) continue;

  const text = readFileSync(file, "utf8");

  /** @type {Set<string>} */
  const hits = new Set();
  for (const re of [jsxTextRe, attrRe, toastRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const s = m[1].trim();
      if (!s || s.includes("{") || allowLiteral.has(s)) continue;
      if (/^[A-Z_]{2,}$/.test(s)) continue;
      if (/^\d/.test(s)) continue;
      hits.add(s);
    }
  }

  if (hits.size > 0 && !text.includes("useTranslation") && !text.includes('mt(') && !text.includes('from "@/i18n/manager"')) {
    const sample = [...hits].slice(0, 3).join(" | ");
    console.error(
      `[hardcoded manager string] ${rel} — no useTranslation; e.g. ${sample}`
    );
    errors++;
  } else if (hits.size > 20 && !text.includes('mt(') && !text.includes('useTranslation("manager")')) {
    const sample = [...hits].slice(0, 3).join(" | ");
    console.error(
      `[hardcoded manager string] ${rel} — ${hits.size} likely literals; e.g. ${sample}`
    );
    errors++;
  }
}

if (errors > 0) {
  console.error(`\ni18n lint failed with ${errors} issue(s).`);
  process.exit(1);
}

console.log(
  `i18n lint OK — ${sourceNs.length} namespaces synced across ${TARGETS.join(", ")}; ${usedManagerKeys.size} manager, ${usedKitchenKeys.size} kitchen, ${usedChefKeys.size} chef, ${usedBookingKeys.size} booking, ${usedCommonKeys.size} common keys verified.`,
);
