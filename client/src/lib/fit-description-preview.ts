/** Binary-search truncate so `text… Show all` fits in `availablePx`. Returns null when no cut needed. */
export function fitDescriptionPreview(
  full: string,
  availablePx: number,
  measurePx: (s: string) => number,
  suffixPx: number
): string | null {
  if (measurePx(full) <= availablePx) return null;
  const budget = Math.max(0, availablePx - suffixPx);
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measurePx(full.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return full.slice(0, Math.max(0, lo)).trimEnd();
}
