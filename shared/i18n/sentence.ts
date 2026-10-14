/**
 * Sentences that end with a localized time ("until 7:55 p.m.") must not get a second period ("p.m..").
 * Templates keep their own closing period (so every locale reads naturally); this collapses exactly two periods
 * into one. Ellipses ("…" or "...") are never touched.
 */
export function collapseDoublePeriods(text: string): string {
  return text.replace(/(?<!\.)\.\.(?!\.)/g, '.');
}

/** i18next post-processor: applied to every translated string (client and server). */
export const sentencePostProcessor = {
  type: 'postProcessor' as const,
  name: 'sentence',
  process: (value: string) => typeof value === 'string' ? collapseDoublePeriods(value) : value,
};
