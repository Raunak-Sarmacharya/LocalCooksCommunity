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
      { key: 'requireFoodHandlerCert', label: 'Food Handler Certificate', description: 'Proof of food safety certification', recommended: true },
      { key: 'requireFoodHandlerExpiry', label: 'Certificate Expiry Date', description: 'When certification expires' },
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
        label: 'Food Safety Certificate',
        description: 'Certificate and expiry date are collected together',
        recommended: true,
      },
      { 
        key: 'tier2_food_establishment_cert_required', 
        label: 'Food Establishment License', 
        description: 'Official food establishment permit/license',
        recommended: true 
      },
      { 
        key: 'tier2_food_establishment_expiry_required', 
        label: 'License Expiry Date', 
        description: 'When the establishment license expires' 
      },
    ]
  },
  {
    title: 'Insurance & Liability',
    description: 'Coverage documentation for liability protection',
    fields: [
      { 
        key: 'tier2_insurance_document_required', 
        label: 'Liability Insurance', 
        description: 'Certificate of insurance or policy documentation',
        recommended: true 
      },
    ]
  },
  {
    title: 'Experience & Background',
    description: 'Chef experience with commercial kitchen operations',
    fields: [
      { key: 'tier2_kitchen_experience_required', label: 'Kitchen Experience Description', description: 'Description of their commercial kitchen experience' },
    ]
  },
];

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
  { value: 'text', label: 'Text Input', description: 'Single line text field' },
  { value: 'textarea', label: 'Text Area', description: 'Multi-line text for longer responses' },
  { value: 'number', label: 'Number', description: 'Numeric input' },
  { value: 'select', label: 'Dropdown', description: 'Single selection from options' },
  { value: 'checkbox', label: 'Checkbox Group', description: 'Multiple selections allowed' },
  { value: 'date', label: 'Date Picker', description: 'Calendar date selection' },
  { value: 'file', label: 'File Upload', description: 'Document or image upload' },
  { value: 'cloudflare_upload', label: 'Large File Upload', description: 'For larger files via Cloudflare' },
] as const;
