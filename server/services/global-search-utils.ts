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

export function mergeSearchResults(
  databaseResults: GlobalSearchResult[],
  staticResults: GlobalSearchResult[],
  limit: number,
): GlobalSearchResult[] {
  return [...databaseResults, ...staticResults]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
