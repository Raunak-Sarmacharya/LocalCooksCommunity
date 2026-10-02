import type { GlobalSearchResult } from "@shared/search";

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function createSearchSnippet(body: string, query: string, maxLength = 150): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;

  const normalizedBody = normalizeSearchText(compact);
  const terms = normalizeSearchText(query).split(" ").filter((term) => term.length > 1);
  const matchAt = terms
    .map((term) => normalizedBody.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, matchAt - Math.floor(maxLength / 3));
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end).trim()}${end < compact.length ? "…" : ""}`;
}

export function scoreStaticDocument(title: string, body: string, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(title);
  const normalizedBody = normalizeSearchText(body);
  if (!normalizedQuery) return 0;
  if (normalizedTitle === normalizedQuery) return 12;
  if (normalizedTitle.startsWith(normalizedQuery)) return 9;
  if (normalizedTitle.includes(normalizedQuery)) return 7;

  const terms = normalizedQuery.split(" ").filter(Boolean);
  const matchedTerms = terms.filter(
    (term) => normalizedTitle.includes(term) || normalizedBody.includes(term),
  ).length;
  return matchedTerms === terms.length ? 4 + matchedTerms / 10 : 0;
}

// Small edit-distance check for navigation and help titles. It deliberately runs only
// after normal matching fails, so a typo never outranks an exact result.
export function isLikelyTypo(title: string, query: string): boolean {
  const needle = normalizeSearchText(query);
  if (needle.length < 4 || needle.length > 40) return false;
  const words = normalizeSearchText(title).split(/[\s,./!?;:()[\]{}-]+/).filter(Boolean);
  return words.some((word) => {
    if (Math.abs(word.length - needle.length) > 2) return false;
    let previous = Array.from({ length: word.length + 1 }, (_, i) => i);
    for (let i = 1; i <= needle.length; i++) {
      const next = [i];
      for (let j = 1; j <= word.length; j++) {
        next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(needle[i - 1] !== word[j - 1]));
      }
      previous = next;
    }
    return previous[word.length] <= (needle.length >= 7 ? 2 : 1);
  });
}

export function mergeSearchResults(
  databaseResults: GlobalSearchResult[],
  staticResults: GlobalSearchResult[],
  limit: number,
): GlobalSearchResult[] {
  const results = [...databaseResults, ...staticResults];
  const exact = results.filter((result) => !result.fuzzy);
  const candidates = exact.length ? exact : results;
  const ranked = candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const chosen: GlobalSearchResult[] = [];
  const seen = new Set<string>();
  const resourceCap = Math.ceil(limit / 2);
  let resources = 0;
  for (const result of ranked) {
    if (seen.has(result.id)) continue;
    if (result.id.startsWith("resource:") && resources >= resourceCap) continue;
    chosen.push(result);
    seen.add(result.id);
    if (result.id.startsWith("resource:")) resources++;
    if (chosen.length === limit) return chosen;
  }
  for (const result of ranked) {
    if (chosen.length === limit) break;
    if (!seen.has(result.id)) chosen.push(result);
  }
  return chosen;
}
