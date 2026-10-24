/**
 * Application Requirements Wizard - Shared Types
 * Enterprise-grade type definitions for the step-by-step requirements configuration
 */

export interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date' | 'file' | 'cloudflare_upload';
  required: boolean;
  placeholder?: string;
  options?: string[];
  tier: 1 | 2 | 3;
  /** Shown under the question on the customer's form. */
  description?: string;
  /** Number questions: the accepted range. */
  min?: number;
  max?: number;
  /** Date questions: today or later only. */
  futureOnly?: boolean;
  /**
   * A file the kitchen treats as a document with an expiry date (owner, Oct 24): listed with the built-in documents and
   * tracked the same way. `mode` replaces `required` for these: 'required' pauses new bookings when missing or expired.
   */
  expires?: boolean;
  mode?: 'track' | 'required';
}

export interface LocationRequirements {
  id: number;
  locationId: number;
  // Personal Information
  requireFirstName: boolean;
  requireLastName: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  // Business Information
  requireBusinessName: boolean;
  requireBusinessType: boolean;
  requireExperience: boolean;
  requireBusinessDescription: boolean;
  // Certifications
  requireFoodHandlerCert: boolean;
  requireFoodHandlerExpiry: boolean;
  // Kitchen Usage
  requireUsageFrequency: boolean;
  requireSessionDuration: boolean;
  // Agreements
  requireTermsAgree: boolean;
  requireAccuracyAgree: boolean;
  // Legacy custom fields
  customFields?: CustomField[];
  // Tier 1 Requirements
  tier1_years_experience_required?: boolean;
  tier1_years_experience_minimum?: number;
  tier1_custom_fields?: CustomField[];
  // Tier 2 Requirements
  tier2_food_establishment_cert_required?: boolean;
  tier2_food_establishment_expiry_required?: boolean;
  tier2_insurance_document_required?: boolean;
  tier2_insurance_minimum_amount?: number;
  // "Track it": asked as optional, kept with its expiry date and reminded, never pauses booking.
  food_handler_cert_tracked?: boolean;
  food_establishment_cert_tracked?: boolean;
  insurance_tracked?: boolean;
  tier2_kitchen_experience_required?: boolean;
  tier2_custom_fields?: CustomField[];
  // Facility Information
  floor_plans_url?: string;
  ventilation_specs?: string;
  ventilation_specs_url?: string;
  equipment_list?: string[];
  materials_description?: string;
}

export interface FieldGroupConfig {
  title: string;
  description: string;
  fields: {
    key: keyof LocationRequirements;
    label: string;
    description?: string;
    recommended?: boolean;
  }[];
}

export const STEP1_FIELD_GROUPS: FieldGroupConfig[] = [
  {
    title: 'Personal Information',
    description: 'Basic contact details for the applicant',
    fields: [
      { key: 'requireFirstName', label: 'First Name', description: 'Legal first name', recommended: true },
      { key: 'requireLastName', label: 'Last Name', description: 'Legal last name', recommended: true },
      { key: 'requireEmail', label: 'Email Address', description: 'Primary contact email', recommended: true },
      { key: 'requirePhone', label: 'Phone Number', description: 'Contact phone number' },
    ]
  },
  {
    title: 'Business Information',
    description: 'Details about their culinary business',
    fields: [
      { key: 'requireBusinessName', label: 'Business Name', description: 'Registered business or DBA name' },
      { key: 'requireBusinessType', label: 'Business Type', description: 'Category of food business', recommended: true },
      { key: 'requireBusinessDescription', label: 'Business Description', description: 'Detailed description of operations' },
    ]
  },
  {
    title: 'Food Safety Certification',
    description: 'Required certifications for food handling',
    fields: [
      // Only the QUESTION is a request-phase concern. The expiry is collected
      // with the certificate itself whenever one is uploaded, so a switch for it
      // could only ever contradict that rule.
      { key: 'requireFoodHandlerCert', label: 'Food Safety Certificate', description: 'Ask the customer whether they hold a certificate', recommended: true },
    ]
  },
  {
    title: 'Kitchen Usage Plans',
    description: 'How they plan to use the kitchen',
    fields: [
      { key: 'requireUsageFrequency', label: 'Usage Frequency', description: 'How often they need kitchen access' },
      { key: 'requireSessionDuration', label: 'Session Duration', description: 'Typical session length' },
    ]
  },
  {
    title: 'Legal Agreements',
    description: 'Required acknowledgments and agreements',
    fields: [
      { key: 'requireTermsAgree', label: 'Terms Agreement', description: 'Accept terms of use', recommended: true },
      { key: 'requireAccuracyAgree', label: 'Accuracy Certification', description: 'Certify information accuracy', recommended: true },
    ]
  },
];

export const STEP2_BUILT_IN_FIELDS: FieldGroupConfig[] = [
  {
    title: 'Licensing & Compliance',
    description: 'Official documentation for regulatory compliance',
    fields: [
      {
        key: 'requireFoodHandlerCert',
        label: 'Food safety certificate',
        description: 'Certificate and expiry date are collected together',
        recommended: true,
      },
      {
        key: 'tier2_food_establishment_cert_required',
        label: 'Food establishment licence',
        description: 'Licence and expiry date are collected together',
        recommended: true
      },
    ]
  },
  {
    title: 'Insurance & Liability',
    description: 'Coverage documentation for liability protection',
    fields: [
      { 
        key: 'tier2_insurance_document_required', 
        label: 'Liability insurance', 
        description: 'Certificate of insurance with its expiry date',
        recommended: true 
      },
    ]
  },
];

/** Asked with the kitchen's own questions (owner, Oct 24): on means asked and required, off means not asked. */
export const KITCHEN_EXPERIENCE_FIELD = { key: 'tier2_kitchen_experience_required' as const, label: 'Kitchen experience', description: 'Their experience in commercial kitchens' };

/**
 * Common requests a kitchen manager can ask a chef for, offered by the "choose
 * from common requests" picker, mirroring the common-task list on the
 * check-in/check-out page: the blank label field is the biggest source of
 * friction, so the usual asks are one tap away.
 *
 * The list is written from the chef's side of the table — the things a kitchen
 * manager actually needs from someone booking their kitchen, phrased the way a
 * chef would read them. Compliance paperwork beyond the built-in licence and
 * insurance rows is deliberately not here: those already have their own rows.
 *
 * `key` is an i18n key rather than literal copy, so the picker reads in the
 * manager's language. Once picked, the resolved text is written into the
 * field's `label` — the same free-text field a manager would have typed into.
 */
export const COMMON_REQUIREMENT_FIELDS: {
  key: string;
  type: CustomField['type'];
  required?: boolean;
}[] = [
  { key: 'commonFieldBusinessRegistration', type: 'file' },
  { key: 'commonFieldMenuDescription', type: 'textarea' },
  { key: 'commonFieldStaffCount', type: 'number' },
  { key: 'commonFieldWeeklyHours', type: 'text' },
  { key: 'commonFieldPreferredStartDate', type: 'date' },
  { key: 'commonFieldStorageNeeds', type: 'text' },
  { key: 'commonFieldEquipmentBringing', type: 'textarea' },
  { key: 'commonFieldAllergensHandled', type: 'text' },
  { key: 'commonFieldDeliveryVehicle', type: 'text' },
  { key: 'commonFieldOnsiteContact', type: 'text' },
];

export const CUSTOM_FIELD_TYPES = [
  { value: 'text', label: 'Short answer', description: 'One line of text' },
  { value: 'textarea', label: 'Paragraph', description: 'A longer written answer' },
  { value: 'number', label: 'Number', description: 'A number, with limits if you want' },
  { value: 'select', label: 'Dropdown', description: 'Pick one from a list' },
  { value: 'checkbox', label: 'Checkboxes', description: 'Pick any from a list' },
  { value: 'date', label: 'Date', description: 'A calendar date' },
  { value: 'file', label: 'File upload', description: 'A document or photo' },
  // Older questions only; the builder offers one File upload type (owner, Oct 24).
  { value: 'cloudflare_upload', label: 'File upload', description: 'A document or photo' },
] as const;

/**
 * The answer types the builder offers, by what the kitchen means rather than the stored type: an Agreement is a
 * checkbox with no options (the form and server already treat that as "tick to confirm"), and both stored file
 * types are one File upload.
 */
export type QuestionKind = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'agreement' | 'date' | 'file';
export const QUESTION_KINDS: { value: QuestionKind; labelKey: string; hintKey: string }[] = [
  { value: 'text', labelKey: 'qbKindText', hintKey: 'qbKindTextHint' },
  { value: 'textarea', labelKey: 'qbKindTextarea', hintKey: 'qbKindTextareaHint' },
  { value: 'number', labelKey: 'qbKindNumber', hintKey: 'qbKindNumberHint' },
  { value: 'select', labelKey: 'qbKindSelect', hintKey: 'qbKindSelectHint' },
  { value: 'checkbox', labelKey: 'qbKindCheckbox', hintKey: 'qbKindCheckboxHint' },
  { value: 'agreement', labelKey: 'qbKindAgreement', hintKey: 'qbKindAgreementHint' },
  { value: 'date', labelKey: 'qbKindDate', hintKey: 'qbKindDateHint' },
  { value: 'file', labelKey: 'qbKindFile', hintKey: 'qbKindFileHint' },
];
export function questionKind(field: Pick<CustomField, 'type'> & { options?: string[] }): QuestionKind {
  if (field.type === 'checkbox') return field.options?.length ? 'checkbox' : 'agreement';
  if (field.type === 'cloudflare_upload') return 'file';
  return field.type;
}

/**
 * One named requirement a chef is asked for, and whether it is compulsory.
 *
 * The review screen needs the manager's decisions AS NAMES — "Food Safety Certificate,
 * required", not "1 of 4 required" — so it reads the same field lists the wizard renders.
 * Deriving them here rather than hand-writing a second list is the whole point: a
 * hand-written copy is free to drift from the form that set it, which is the same
 * two-owners-of-one-fact shape that has already cost this codebase two reviews.
 */
export interface ResolvedRequirement {
  /** Stable key for React and for tests. */
  key: string;
  /** The field's name, as the wizard shows it. */
  label: string;
  /** What it is for — shown quietly under the name, so a name alone is not a riddle. */
  description?: string;
  required: boolean;
  /** Documents only: Not needed, Track it or Required, as the kitchen chose. */
  mode?: 'none' | 'track' | 'required';
}

/** The built-in document rows the wizard renders. */
const BUILT_IN_DOC_ROWS = STEP2_BUILT_IN_FIELDS.flatMap((group) => group.fields);

/**
 * The built-in document requirements, in the wizard's own order.
 *
 * This is the one the REVIEW reads, and it returns exactly what `RequirementsStepTwo` puts on
 * screen: the same four rows, in the same order, with `required` carrying each switch's state.
 *
 * It deliberately does NOT group them. The wizard renders ONE flat list under a single card —
 * the `title` on each `STEP2_BUILT_IN_FIELDS` group (Licensing & Compliance, Insurance &
 * Liability, Experience & Background) is never displayed, and is not even read on that path,
 * because the component flattens the groups into `FIELD_ROWS`. Headings invented for the
 * review would be structure the manager never saw while configuring, which is what this
 * review was already wrong about once.
 */
export function resolveDocumentRequirements(
  requirements: Partial<LocationRequirements> | null | undefined,
): ResolvedRequirement[] {
  const tracked: Record<string, keyof LocationRequirements> = {
    requireFoodHandlerCert: 'food_handler_cert_tracked',
    tier2_food_establishment_cert_required: 'food_establishment_cert_tracked',
    tier2_insurance_document_required: 'insurance_tracked',
  };
  const builtIn: ResolvedRequirement[] = BUILT_IN_DOC_ROWS.map((field) => {
    const required = requirements?.[field.key] === true;
    return { key: String(field.key), label: field.label, description: field.description, required,
      mode: required ? 'required' : requirements?.[tracked[String(field.key)]] === true ? 'track' : 'none' };
  });
  // The kitchen's own dated documents sit in the same list (owner, Oct 24).
  const own = ((requirements as { tier2_custom_fields?: CustomField[] } | null | undefined)?.tier2_custom_fields ?? [])
    .filter((field) => field?.expires)
    .map((field): ResolvedRequirement => ({ key: field.id, label: field.label, description: field.description, required: field.required === true, mode: field.required ? 'required' : 'track' }));
  return [...builtIn, ...own];
}

/**
 * The built-in document requirements, de-duplicated on key.
 *
 * The food-safety row appears in BOTH the step-1 and step-2 field lists (asked as a question
 * in one, collected as a document in the other). Kept for callers that combine both lists;
 * the requirements review reads `resolveDocumentRequirements` directly, since that list is
 * what the wizard renders and it has no duplicate to remove.
 */
export function resolveDocumentRequirementsUnique(
  requirements: Partial<LocationRequirements> | null | undefined,
): ResolvedRequirement[] {
  const seen = new Set<string>();
  return resolveDocumentRequirements(requirements).filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

/**
 * The applicant questions, resolved against a saved row.
 *
 * NOTE: the requirements REVIEW no longer reads this. `STEP1_FIELD_GROUPS` is the platform's
 * standard application, owned by an admin and set in `PlatformRequirementsSection` — the
 * onboarding wizard never renders it, so reporting these to a manager named switches they
 * had never seen and could not change (2026-09-26). Kept because the admin screen and any
 * future "what will a chef be asked for" view legitimately want the whole picture; do NOT
 * feed it to a manager-facing recap without checking they can act on it.
 */
export function resolveApplicantRequirements(
  requirements: Partial<LocationRequirements> | null | undefined,
): ResolvedRequirement[] {
  return STEP1_FIELD_GROUPS
    .flatMap((group) => group.fields)
    .map((field) => ({
      key: String(field.key),
      label: field.label,
      description: field.description,
      required: requirements?.[field.key] === true,
    }));
}

/** The manager's own questions, in the order they were added. */
export function resolveCustomRequirements(
  requirements: Partial<LocationRequirements> | null | undefined,
): ResolvedRequirement[] {
  /*
   * `tier2_custom_fields` is where the wizard WRITES and what the server validates
   * (`tier-validation.ts`). The review used to read the legacy `customFields`, which the
   * step never populates — so a manager's own questions were invisible on this screen.
   */
  const fields = (requirements as { tier2_custom_fields?: CustomField[] } | null | undefined)?.tier2_custom_fields;
  const experience: ResolvedRequirement[] = requirements?.tier2_kitchen_experience_required
    ? [{ key: KITCHEN_EXPERIENCE_FIELD.key, label: KITCHEN_EXPERIENCE_FIELD.label, description: 'Paragraph', required: true }]
    : [];
  if (!Array.isArray(fields)) return experience;
  return [...experience, ...fields.filter((field) => !field?.expires).map((field, index) => ({
    key: field.id || `custom-${index}`,
    label: field.label,
    // The answer type is worth naming: "Dropdown" and "File upload" are different asks,
    // and the review is where the manager checks which they picked.
    description: questionKind(field) === 'agreement' ? 'Agreement' : CUSTOM_FIELD_TYPES.find((type) => type.value === field.type)?.label ?? field.type,
    required: field.required === true,
  }))];
}
