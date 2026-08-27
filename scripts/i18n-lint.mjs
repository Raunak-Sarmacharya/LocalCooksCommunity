#!/usr/bin/env node
/**
 * CI gate: ensure every locale catalog has the same keys as en-CA (source of truth).
 * Usage: node scripts/i18n-lint.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "shared", "i18n", "locales");
const SOURCE = "en-CA";
const TARGETS = ["fr-CA", "uk"];

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
  const path = join(root, locale, `${ns}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

const sourceNs = readdirSync(join(root, SOURCE))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

let errors = 0;

for (const ns of sourceNs) {
  const source = loadJson(SOURCE, ns);
  if (!source) continue;
  const sourceKeys = new Set(flatten(source));

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

if (errors > 0) {
  console.error(`\ni18n lint failed with ${errors} issue(s).`);
  process.exit(1);
}

console.log(
  `i18n lint OK — ${sourceNs.length} namespaces synced across ${TARGETS.join(", ")}.`
);
