import { activeChecklist } from './active-checklist';

export type DutySection = {
  enabled: boolean; instructions: string | null;
  workflowEnabled?: boolean;
  tasksRequired?: boolean;
  items: Array<{ id: string; label: string; required?: boolean; description?: string }>;
  photos: Array<{ id: string; label: string; required?: boolean; description?: string }>;
};
export type VisitDuties = {
  clockCloseout?: import('./clock-closeout').CloseoutSnapshot;
  version: 1 | 2; capturedAt: string; source: 'confirmation' | 'legacy_first_action';
  arrival: DutySection; departure: DutySection;
  checkinWindowMinutesBefore: number; checkoutReviewWindowMinutes: number;
};
export function readVisitDuties(value: unknown): VisitDuties | null {
  if (value == null) return null;
  const duties = value as VisitDuties;
  if (![1, 2].includes(duties.version) || !duties.arrival || !duties.departure ||
    !Array.isArray(duties.arrival.items) || !Array.isArray(duties.departure.items) ||
    !Array.isArray(duties.arrival.photos) || !Array.isArray(duties.departure.photos) ||
    !Number.isSafeInteger(duties.checkinWindowMinutesBefore) || duties.checkinWindowMinutesBefore < 0 ||
    !Number.isSafeInteger(duties.checkoutReviewWindowMinutes) || duties.checkoutReviewWindowMinutes < 0)
    throw new Error('Visit duties need Local Cooks review; unsupported or invalid snapshot');
  return duties;
}
export function makeVisitDuties(checklist: any, storage: boolean,
  settings: { checkinWindowMinutesBefore: number; checkoutReviewWindowMinutes: number }, source: VisitDuties['source'], now = new Date()): VisitDuties {
  const row = checklist ? activeChecklist(checklist) : {};
  const section = (prefix: string): DutySection => ({
    enabled: !storage || row[`${prefix}Enabled`] === true,
    ...(!storage ? { workflowEnabled: true, tasksRequired: [row[`${prefix}Items`], row[`${prefix}PhotoRequirements`]].flatMap(value => Array.isArray(value) ? value : []).some(task => task.required !== false) } : {}),
    instructions: row[`${prefix}Instructions`] || null,
    items: Array.isArray(row[`${prefix}Items`]) ? row[`${prefix}Items`] : [],
    photos: Array.isArray(row[`${prefix}PhotoRequirements`]) ? row[`${prefix}PhotoRequirements`] : [],
  });
  return { version: storage ? 1 : 2, capturedAt: now.toISOString(), source,
    arrival: section(storage ? 'storageCheckin' : 'checkin'), departure: section(storage ? 'storageCheckout' : 'checkout'),
    checkinWindowMinutesBefore: settings.checkinWindowMinutesBefore,
    checkoutReviewWindowMinutes: settings.checkoutReviewWindowMinutes };
}
/** No generic photo requirement. Only configured enabled duties are mandatory. */
export type DutyFieldErrors = { items?: string; photos?: string };
export class VisitDutyValidationError extends Error {
  constructor(message: string, public fieldErrors: DutyFieldErrors) { super(message); }
}
export function validateDutySection(section: DutySection, photos?: string[], items?: Array<{ id: string; checked: boolean }>): { valid: boolean; error?: string; fieldErrors?: DutyFieldErrors } {
  if (!section.enabled) return { valid: true };
  const required = section.photos.filter(photo => photo.required !== false).length;
  const fieldErrors: DutyFieldErrors = {};
  if (new Set((photos || []).filter(Boolean)).size < required)
    fieldErrors.photos = `Please upload one distinct photo for each required item (${required} required)`;
  const checked = new Set((items || []).filter(item => item.checked === true).map(item => item.id));
  const missing = section.items.filter(item => item.required !== false && !checked.has(item.id));
  if (missing.length) fieldErrors.items = `Complete required checklist items: ${missing.map(item => item.label).join(', ')}`;
  return Object.keys(fieldErrors).length ? { valid: false, error: Object.values(fieldErrors).join('. '), fieldErrors } : { valid: true };
}
