/**
 * Booked length in people words: "20 min", "1 hr", "1 hr 30 min", "2 hrs" (fr-CA "1 h 30 min", uk "1 год 30 хв").
 * Pure and locale-keyed so the header, the visit lines and tests read the same. Display only.
 */
type Units = { min: string; hr: (hours: number) => string };

const UNITS: Record<'en' | 'fr' | 'uk', Units> = {
  en: { min: 'min', hr: hours => (hours === 1 ? 'hr' : 'hrs') },
  fr: { min: 'min', hr: () => 'h' },
  uk: { min: 'хв', hr: () => 'год' },
};

function unitsFor(locale?: string | null): Units {
  const base = (locale || 'en').toLowerCase().split('-')[0];
  return base === 'fr' ? UNITS.fr : base === 'uk' ? UNITS.uk : UNITS.en;
}

export function formatBookedDuration(minutes: number, locale?: string | null): string {
  const units = unitsFor(locale);
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60), rest = total % 60;
  if (hours === 0) return `${rest} ${units.min}`;
  const hourPart = `${hours} ${units.hr(hours)}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} ${units.min}`;
}
