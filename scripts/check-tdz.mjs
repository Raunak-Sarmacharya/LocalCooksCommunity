#!/usr/bin/env node
/**
 * TDZ guard — catches the crash class that caused a P0 blank page in
 * `kitchen-application/KitchenApplicationForm.tsx`.
 *
 * The bug: a `useMemo` FACTORY runs during the render body (it is not deferred), so reading a
 * component-scope binding declared BELOW the hook throws
 *   "Cannot access 'X' before initialization"
 * which React's error boundary turns into a blank "Something went wrong" page.
 *
 * Neither check this repo normally runs can see it:
 *   - esbuild is syntax-only and bundles the crashing file clean;
 *   - `tsc` does NOT flag use-before-declaration when the read is inside a function body, because it
 *     assumes the function may run later.
 *
 * So this is a static scan for exactly that shape. It is a heuristic, not a type system: it reports
 * candidates for a human to confirm. A zero exit means nothing was found.
 *
 * LIMITATION — scope it to ONE component file at a time.
 * There is no real scope analysis here: the whole file is treated as one scope, so in a file holding
 * several sibling components a `const` in component B can look like a forward reference from
 * component A. That is why the default sweep over `client/src` is noisy and must NOT be wired up as
 * a repo-wide CI gate. Point it at a file (or a flow's files) and it is accurate — it reproduced the
 * real P0 in `KitchenApplicationForm.tsx` and reports the apply-kitchen flow clean.
 *
 * Usage:
 *   node scripts/check-tdz.mjs <file> [<file>...]   # recommended
 *   node scripts/check-tdz.mjs                      # sweeps client/src (noisy, see above)
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const HOOK = /\b(useMemo|useCallback|useEffect|useLayoutEffect)\s*\(/;
const DECL = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/;
const DESTRUCT = /^(?:const|let)\s*\{([^}]*)\}/;
const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Extent of a hook call, by combined bracket depth from the hook's own line. */
function extent(lines, start) {
  let depth = 0;
  let started = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "(" || ch === "{" || ch === "[") {
        depth++;
        started = true;
      } else if (ch === ")" || ch === "}" || ch === "]") {
        depth--;
        if (started && depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(p, out);
    } else if ([".tsx", ".ts"].includes(extname(p)) && !p.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length ? args : walk("client/src");

let total = 0;
let scanned = 0;

for (const path of files) {
  let lines;
  try {
    lines = readFileSync(path, "utf8").split(/\r?\n/);
  } catch {
    continue;
  }
  scanned++;

  const hooks = [];
  lines.forEach((l, i) => {
    if (HOOK.test(l)) hooks.push([i, extent(lines, i), HOOK.exec(l)[1]]);
  });
  const insideHook = (i) => hooks.some(([a, b]) => a <= i && i <= b);

  // TRUE component scope: exactly two leading spaces and not inside any hook body.
  // Counting declarations *inside* a hook body as component scope produces false positives
  // (a binding declared and used within the same factory is legal).
  //
  // FIRST occurrence wins. A later declaration of the same name is almost always a shadow in a
  // sibling scope, and letting it overwrite makes every earlier use look like a forward reference.
  const decls = new Map();
  lines.forEach((l, i) => {
    if (insideHook(i) || !l.startsWith("  ") || l.startsWith("   ")) return;
    const s = l.slice(2);
    const m = DECL.exec(s);
    if (m && !decls.has(m[1])) decls.set(m[1], i);
    const m2 = DESTRUCT.exec(s);
    if (m2) {
      for (const part of m2[1].split(",")) {
        const n = part.split(":").pop().trim();
        if (IDENT.test(n) && !decls.has(n)) decls.set(n, i);
      }
    }
  });

  const hits = [];
  for (const [hs, he, kind] of hooks) {
    const joined = lines.slice(hs, he + 1).join("\n");
    const li = joined.lastIndexOf("[");
    const ri = joined.lastIndexOf("]");
    const dep = li >= 0 && li < ri ? joined.slice(li, ri + 1) : "";
    for (const [name, d] of decls) {
      if (d <= hs) continue; // declared above the hook: safe
      // A bare identifier reference only. `(?<![.\w$])` rejects property access
      // (`data.checklist`) and `(?!\s*:)` rejects an object-literal key — both were real
      // false-positive sources, not forward references.
      const ref = new RegExp(`(?<![.\\w$])${name}(?![\\w$])(?!\\s*:)`);
      const inDep = ref.test(dep);
      let inBody = false;
      if (kind === "useMemo" || kind === "useCallback") {
        for (let j = hs; j <= he; j++) {
          if (j === d) continue;
          if (ref.test(lines[j])) {
            inBody = true;
            break;
          }
        }
      }
      if (inDep || inBody) {
        hits.push({ kind, hs: hs + 1, name, d: d + 1, where: inDep ? "dep array" : "factory body" });
      }
    }
  }

  if (hits.length) {
    console.log(`\n${path}`);
    for (const h of hits) {
      console.log(
        `  TDZ  ${h.kind} at line ${h.hs} reads "${h.name}" declared at line ${h.d} (${h.where})`,
      );
    }
    total += hits.length;
  }
}

console.log(
  total === 0
    ? `\nTDZ check passed (${scanned} file(s) scanned).`
    : `\nTDZ check found ${total} candidate(s) across ${scanned} file(s) scanned.`,
);
process.exit(total === 0 ? 0 : 1);
