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

export type WizardStep = 'step1' | 'step2' | 'facility';

export interface StepConfig {
  id: WizardStep;
  title: string;
  description: string;
  icon: string;
  explanation: string;
}

export const WIZARD_STEPS: StepConfig[] = [
  {
    id: 'step1',
    title: 'Step 1: Initial Application',
    description: 'Configure what chefs need to submit when they first apply',
    icon: 'clipboard-list',
    explanation: `**What is Step 1?**\n\nThis is the initial application form chefs see when they apply to use your kitchen. Configure the required information to screen applicants before you invest time reviewing them.\n\n**Best Practices:**\n- Keep required fields minimal to encourage applications\n- Food handler certification is often legally required\n- Business information helps you understand their needs`
  },
  {
    id: 'step2',
    title: 'Step 2: Kitchen Coordination',
    description: 'Requirements for operational planning after initial approval',
    icon: 'settings-2',
    explanation: `**What is Step 2?**\n\nAfter you approve a chef's initial application, they enter the coordination phase. This is where you collect detailed documentation for compliance and operational planning.\n\n**Best Practices:**\n- Request food establishment license if legally required in your jurisdiction\n- Insurance documentation protects both parties\n- Use custom fields for location-specific requirements`
  },
  {
    id: 'facility',
    title: 'Facility Information',
    description: 'Information automatically shared with approved chefs',
    icon: 'building-2',
    explanation: `**What is Facility Information?**\n\nThis information is automatically shared with chefs after approval. It helps them prepare for using your kitchen space.\n\n**Best Practices:**\n- Upload clear floor plans to reduce orientation time\n- Document ventilation specs for compliance\n- Keep equipment list updated for chef planning`
  }
];

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
