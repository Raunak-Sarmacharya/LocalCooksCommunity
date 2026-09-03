import { logger } from "@/lib/logger";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  Clock,
  FileText,
  Info,
  Loader2,
  MapPin,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type FieldErrors, useForm, useWatch } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { phoneNumberSchema, optionalPhoneNumberSchema, normalizePhoneNumber, isValidNorthAmericanPhone } from "@shared/phone-validation";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChefPageHeader } from "@/components/chef/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";

// Helper component for authenticated document links
function AuthenticatedDocumentLink({ url, className, children }: { url: string | null | undefined; className?: string; children: React.ReactNode }) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);
  
  if (!url) return null;
  
  return (
    <a 
      href={presignedUrl || url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

// Base schema for kitchen application form (used as fallback)
// Make experience optional by default since it's conditional based on requirements
// Business name/type are optional — request-to-apply does not require them
const baseKitchenApplicationSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: phoneNumberSchema,
  businessName: z.string().optional().or(z.literal("")),
  businessType: z.string().optional().or(z.literal("")),
  experience: z.string().optional(), // Make optional by default
  businessDescription: z.string().optional(),
  foodHandlerCertExpiry: z.string().optional(), // Moved to Tier 2 (cannot upload in registration)
  foodEstablishmentCertExpiry: z.string().optional(),
  usageFrequency: z.string().optional().or(z.literal('')),
  sessionDuration: z.string().optional().or(z.literal('')),
  termsAgree: z.boolean().default(true),
  accuracyAgree: z.boolean().default(true),
  // Tier 2 field - kitchen experience description
  kitchenExperienceDescription: z.string().optional(),
});

type KitchenApplicationFormData = z.infer<typeof baseKitchenApplicationSchema> & {
  customFields?: Record<string, any>;
};

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date' | 'file' | 'cloudflare_upload';
  required: boolean;
  placeholder?: string;
  options?: string[];
}

interface LocationInfo {
  id: number;
  name: string;
  address: string;
  city?: string;
  brandImageUrl?: string | null;
  kitchenTermsUrl?: string | null;
}

interface KitchenApplicationFormProps {
  location: LocationInfo;
  globalApp?: any;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// Business type / frequency options — shared with registration “Request to apply” modal
import {
  REQUEST_TO_APPLY_BUSINESS_TYPES,
  REQUEST_TO_APPLY_FREQUENCIES,
} from "./request-to-apply-fields";

const businessTypes = REQUEST_TO_APPLY_BUSINESS_TYPES.map((o) => ({
  value: o.value,
  label: o.fallback,
  key: o.key,
}));

const usageFrequencies = REQUEST_TO_APPLY_FREQUENCIES.map((o) => ({
  value: o.value,
  label: o.fallback,
  key: o.key,
}));

// Experience options (Step 2 / location-requirement only)
const experienceLevels = [
  { value: "0-2", label: "0-2 years (Just starting)" },
  { value: "2-5", label: "2-5 years (Growing)" },
  { value: "5-10", label: "5-10 years (Established)" },
  { value: "10+", label: "10+ years (Expert)" },
];

// Duration options
const sessionDurations = [
  { value: "2-4", label: "2-4 hours" },
  { value: "4-8", label: "4-8 hours" },
  { value: "8-12", label: "8-12 hours (full day)" },
  { value: "12+", label: "12+ hours (extended)" },
];

export default function KitchenApplicationForm({
  location,
  globalApp,
  onSuccess,
  onCancel,
}: KitchenApplicationFormProps) {
  const { user } = useFirebaseAuth();
  const { t } = useTranslation("kitchen");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { createApplication, refetch } = useChefKitchenApplications();
  const { application, hasApplication, refetch: refetchLocationApp } = useChefKitchenApplicationForLocation(location.id);

  // Get current tier from application
  // If status is 'approved' but still on tier 1, we should effectively be on tier 2 for the form
  // unless we've reached the max tier (which is currently 2)
  // Also unlock Step 2 for the legacy buggy state: inReview + tier >= 2 (admin approve used to bump tier without setting approved).
  const dbTier = application?.current_tier ?? 1;
  const effectiveTier =
    (application?.status === 'approved' && dbTier < 2) ||
    (application?.status === 'inReview' && dbTier >= 2 && !application?.tier2_completed_at)
      ? Math.max(dbTier, 2)
      : dbTier;

  // Use effectiveTier for all UI logic, but keep dbTier for submission logic if needed
  const currentTier = effectiveTier;
  const tierData = (application?.tier_data || {}) as Record<string, any>;

  // Fetch location requirements
  const { data: requirements, isLoading: isLoadingRequirements } = useQuery({
    queryKey: [`/api/public/locations/${location.id}/requirements`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${location.id}/requirements`);
      if (!response.ok) return null;
      return response.json();
    },
  });

  // File upload state - initialize with existing URLs if available
  const [foodHandlerFile, setFoodHandlerFile] = useState<File | null>(null);
  const [businessLicenseFile, setBusinessLicenseFile] = useState<File | null>(null);
  const [existingFoodHandlerUrl, setExistingFoodHandlerUrl] = useState<string | null>(application?.foodSafetyLicenseUrl || null);
  const [existingBusinessLicenseUrl, setExistingBusinessLicenseUrl] = useState<string | null>(application?.foodEstablishmentCertUrl || null);
  // Tier 2 file uploads
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [fileErrors, setFileErrors] = useState<{
    businessLicense?: string;
    insurance?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  
  // Custom field file uploads - map of field ID to File object
  const [customFieldFiles, setCustomFieldFiles] = useState<Record<string, File>>({});



  // Split user's display name into first and last
  const nameParts = user?.displayName?.split(' ') || ['', ''];
  const defaultFirstName = nameParts[0] || '';
  const defaultLastName = nameParts.slice(1).join(' ') || '';

  // Dynamic schema generation based on requirements
  const dynamicSchema = useMemo(() => {
    if (!requirements) return baseKitchenApplicationSchema;

    // For Tier 2+, make all Tier 1 fields optional since they're already submitted
    const isTier2OrHigher = currentTier >= 2 || !!globalApp;
    // Phone is optional on request-to-apply — collect it on Step 2 if still missing
    const needsPhoneOnStep2 =
      isTier2OrHigher && !(application?.phone && String(application.phone).trim());

    const optionalText = z.string().optional().or(z.literal(''));
    const requiredPhone = z.string()
      .min(1, t("valPhoneReq", { defaultValue: "Phone number is required" }))
      .refine(
        (val) => {
          const normalized = normalizePhoneNumber(val);
          return normalized !== null && isValidNorthAmericanPhone(normalized);
        },
        { message: t("valPhoneInvalid", { defaultValue: "Please enter a valid phone number" }) }
      )
      .transform((val) => normalizePhoneNumber(val) || val);
    const optionalPhone = z.string()
      .optional()
      .or(z.literal(''))
      .refine(
        (val) => {
          if (!val || val.trim() === '') return true;
          const normalized = normalizePhoneNumber(val);
          return normalized !== null && isValidNorthAmericanPhone(normalized);
        },
        { message: t("valPhoneInvalid", { defaultValue: "Please enter a valid phone number" }) }
      )
      .transform((val) => {
        if (!val || val.trim() === '') return null;
        return normalizePhoneNumber(val) || val;
      });

    // Step 2 allowlist: only phone-if-missing, food-safety expiry, and manager Step 2 reqs.
    // Never re-require request-to-apply fields (business name/type/desc/experience/usage/etc).
    if (isTier2OrHigher) {
      const step2Fields: Record<string, z.ZodTypeAny> = {
        firstName: optionalText,
        lastName: optionalText,
        email: z.string().email().optional().or(z.literal('')),
        phone: needsPhoneOnStep2 ? requiredPhone : optionalPhone,
        businessName: optionalText,
        businessType: optionalText,
        experience: optionalText,
        businessDescription: z.string().optional(),
        foodHandlerCertExpiry: z.string().min(1, t("valFoodSafetyExpiryReq", { defaultValue: "Food Safety License expiry date is required" })),
        foodEstablishmentCertExpiry: requirements.tier2_food_establishment_expiry_required
          ? z.string().min(1, t("valFoodEstExpiryReq", { defaultValue: "Food establishment certificate expiry is required" }))
          : z.string().optional(),
        usageFrequency: optionalText,
        sessionDuration: optionalText,
        termsAgree: z.boolean().default(true).optional(),
        accuracyAgree: z.boolean().default(true).optional(),
        kitchenExperienceDescription: requirements.tier2_kitchen_experience_required
          ? z.string().min(1, t("valKitchenExpReq", { defaultValue: "Kitchen experience description is required" }))
          : z.string().optional(),
      };

      const customFieldsSchema: Record<string, z.ZodTypeAny> = {};
      const tier2Fields = Array.isArray(requirements.tier2_custom_fields) ? requirements.tier2_custom_fields : [];
      tier2Fields.forEach((field: CustomField) => {
        if (field.required) {
          switch (field.type) {
            case 'text':
            case 'textarea':
              customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
              break;
            case 'number':
              customFieldsSchema[`custom_${field.id}`] = z.number({ required_error: t("valFieldReq", { defaultValue: "{label} is required", label: field.label }) });
              break;
            case 'select':
              customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valSelectFieldReq", { defaultValue: "Please select {label}", label: field.label }));
              break;
            case 'checkbox':
              if (field.options && field.options.length > 0) {
                customFieldsSchema[`custom_${field.id}`] = z.array(z.string()).min(1, t("valSelectOptionReq", { defaultValue: "Please select at least one option for {label}", label: field.label }));
              } else {
                customFieldsSchema[`custom_${field.id}`] = z.boolean().refine(val => val === true, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
              }
              break;
            case 'date':
              customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
              break;
            case 'file':
            case 'cloudflare_upload':
              customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
              break;
          }
        } else {
          customFieldsSchema[`custom_${field.id}`] = z.any().optional();
        }
      });

      return z.object({ ...step2Fields, ...customFieldsSchema });
    }

    const baseFields = {
      firstName: requirements.requireFirstName
        ? z.string().min(1, t("valFirstNameReq", { defaultValue: "First name is required" }))
        : optionalText,
      lastName: requirements.requireLastName
        ? z.string().min(1, t("valLastNameReq", { defaultValue: "Last name is required" }))
        : optionalText,
      email: requirements.requireEmail
        ? z.string().email(t("valEmailReq", { defaultValue: "Please enter a valid email address" }))
        : z.string().email().optional().or(z.literal('')),
      phone: requirements.requirePhone ? requiredPhone : optionalPhone,
      // Request-to-apply treats these as optional — never block on them
      businessName: optionalText,
      businessType: optionalText,
      experience: requirements.tier1_years_experience_required
        ? z.string().min(1, t("valExpReq", { defaultValue: "Please select your experience level" }))
        : optionalText,
      businessDescription: requirements.requireBusinessDescription
        ? z.string().min(1, t("valBusinessDescReq", { defaultValue: "Business description is required" }))
        : z.string().optional(),
      foodHandlerCertExpiry: z.string().optional(),
      foodEstablishmentCertExpiry: requirements.requireFoodEstablishmentExpiry
        ? z.string().min(1, t("valFoodEstExpiryReq", { defaultValue: "Food establishment certificate expiry is required" }))
        : z.string().optional(),
      usageFrequency: optionalText,
      sessionDuration: optionalText,
      termsAgree: z.boolean().default(true).optional(),
      accuracyAgree: z.boolean().default(true).optional(),
      kitchenExperienceDescription: z.string().optional(),
    };

    // Merge custom fields based on tier
    let fieldsToUse: CustomField[] = [];
    if (currentTier === 1 && requirements.tier1_custom_fields && Array.isArray(requirements.tier1_custom_fields)) {
      fieldsToUse = requirements.tier1_custom_fields;
    }

    // Add custom fields to schema
    const customFieldsSchema: Record<string, z.ZodTypeAny> = {};
    fieldsToUse.forEach((field: CustomField) => {
      if (field.required) {
        switch (field.type) {
          case 'text':
          case 'textarea':
            customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
            break;
          case 'number':
            customFieldsSchema[`custom_${field.id}`] = z.number({ required_error: t("valFieldReq", { defaultValue: "{label} is required", label: field.label }) });
            break;
          case 'select':
            customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valSelectFieldReq", { defaultValue: "Please select {label}", label: field.label }));
            break;
          case 'checkbox':
            // If checkbox has options, it's a multi-checkbox (array), otherwise single checkbox (boolean)
            if (field.options && field.options.length > 0) {
              customFieldsSchema[`custom_${field.id}`] = z.array(z.string()).min(1, t("valSelectOptionReq", { defaultValue: "Please select at least one option for {label}", label: field.label }));
            } else {
              customFieldsSchema[`custom_${field.id}`] = z.boolean().refine(val => val === true, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
            }
            break;
          case 'date':
            customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
            break;
          case 'file':
          case 'cloudflare_upload':
            customFieldsSchema[`custom_${field.id}`] = z.string().min(1, t("valFieldReq", { defaultValue: "{label} is required", label: field.label }));
            break;
        }
      } else {
        switch (field.type) {
          case 'text':
          case 'textarea':
          case 'select':
          case 'date':
            customFieldsSchema[`custom_${field.id}`] = z.string().optional();
            break;
          case 'number':
            customFieldsSchema[`custom_${field.id}`] = z.number().optional();
            break;
          case 'checkbox':
            // If checkbox has options, it's a multi-checkbox (array), otherwise single checkbox (boolean)
            if (field.options && field.options.length > 0) {
              customFieldsSchema[`custom_${field.id}`] = z.array(z.string()).optional();
            } else {
              customFieldsSchema[`custom_${field.id}`] = z.boolean().optional();
            }
            break;
          case 'file':
          case 'cloudflare_upload':
            customFieldsSchema[`custom_${field.id}`] = z.string().optional();
            break;
        }
      }
    });

    return z.object({ ...baseFields, ...customFieldsSchema });
  }, [requirements, currentTier, t, application?.phone, globalApp]);

  // Phone is optional on request-to-apply — ask on Step 2 if still missing
  const needsPhoneOnStep2 =
    currentTier >= 2 && !(application?.phone && String(application.phone).trim());
  const getDefaultValues = useMemo(() => {
    // Start with default values from user data
    const defaults: any = {
      firstName: defaultFirstName,
      lastName: defaultLastName,
      email: user?.email || "",
      phone: "",
      businessName: "",
      businessType: "",
      experience: "",
      businessDescription: "",
      foodHandlerCertExpiry: "",
      foodEstablishmentCertExpiry: "",
      usageFrequency: "",
      sessionDuration: "",
      termsAgree: true,
      accuracyAgree: true,
      kitchenExperienceDescription: "",
    };

    // Load globalApp defaults if available
    if (globalApp) {
      if (globalApp.fullName) {
        const nameParts = globalApp.fullName.split(' ');
        defaults.firstName = nameParts[0] || '';
        defaults.lastName = nameParts.slice(1).join(' ') || '';
      }
      defaults.email = globalApp.email || defaults.email;
      defaults.phone = globalApp.phone || defaults.phone;
    }

    // Load existing application data if available
    if (application) {
      // Personal info
      if (application.fullName && application.fullName !== 'N/A') {
        const nameParts = application.fullName.split(' ');
        defaults.firstName = nameParts[0] || '';
        defaults.lastName = nameParts.slice(1).join(' ') || '';
      }
      defaults.email = application.email || defaults.email;
      defaults.phone = application.phone || '';

      // Business info (stored as JSON in businessDescription)
      if (application.businessDescription) {
        try {
          const businessInfo = JSON.parse(application.businessDescription);
          defaults.businessName = businessInfo.businessName || '';
          defaults.businessType = businessInfo.businessType || '';
          defaults.experience = businessInfo.experience || '';
          defaults.businessDescription = businessInfo.description || '';
          defaults.usageFrequency = businessInfo.usageFrequency || '';
          defaults.sessionDuration = businessInfo.sessionDuration || '';
          defaults.foodHandlerCertExpiry = businessInfo.foodHandlerCertExpiry || '';
          defaults.foodEstablishmentCertExpiry = businessInfo.foodEstablishmentCertExpiry || '';
        } catch (e) {
          logger.warn('Failed to parse business description JSON:', e);
        }
      }

      // Experience might also be stored separately
      if (application.cookingExperience) {
        defaults.experience = application.cookingExperience;
      }

      // Certificate expiry dates
      if (application.foodSafetyLicenseExpiry) {
        defaults.foodHandlerCertExpiry = application.foodSafetyLicenseExpiry;
      }
      if (application.foodEstablishmentCertExpiry) {
        defaults.foodEstablishmentCertExpiry = application.foodEstablishmentCertExpiry;
      }

      // Load custom fields data
      if (application.customFieldsData) {
        Object.entries(application.customFieldsData).forEach(([fieldId, value]) => {
          defaults[`custom_${fieldId}`] = value;
        });
      }

      // Load tier_data fields (for Tier 2+)
      if (application.tier_data) {
        const tierDataParsed = application.tier_data as Record<string, any>;
        if (tierDataParsed.kitchen_experience_description) {
          defaults.kitchenExperienceDescription = tierDataParsed.kitchen_experience_description;
        }
      }
    }

    // Add default values for custom fields that don't have existing data
    // Use tier-specific fields based on current tier
    let fieldsToUse: CustomField[] = [];
    if (currentTier === 1 && requirements?.tier1_custom_fields && Array.isArray(requirements.tier1_custom_fields)) {
      fieldsToUse = requirements.tier1_custom_fields;
    } else if (currentTier >= 2 && requirements?.tier2_custom_fields && Array.isArray(requirements.tier2_custom_fields)) {
      fieldsToUse = requirements.tier2_custom_fields;
    }

    fieldsToUse.forEach((field: CustomField) => {
      const fieldKey = `custom_${field.id}`;
      if (defaults[fieldKey] === undefined) {
        if (field.type === 'checkbox') {
          // Multi-checkbox (with options) defaults to empty array, single checkbox defaults to false
          defaults[fieldKey] = (field.options && field.options.length > 0) ? [] : false;
        } else {
          defaults[fieldKey] = '';
        }
      }
    });

    try {
      const fallbackStr = window.localStorage.getItem('fallbackRegistrationData');
      if (fallbackStr) {
        const fallback = JSON.parse(fallbackStr);
        if (!defaults.businessName && fallback.shopName) defaults.businessName = fallback.shopName;
        if (!defaults.businessType && fallback.businessType) defaults.businessType = fallback.businessType;
        if (!defaults.experience && fallback.experience) defaults.experience = fallback.experience;
        if (!defaults.businessDescription && fallback.businessDescription) defaults.businessDescription = fallback.businessDescription;
        if (!defaults.phone && fallback.phone) defaults.phone = fallback.phone;
        if ((!defaults.email || defaults.email === "") && fallback.email) defaults.email = fallback.email;
        if (defaults.firstName === defaultFirstName && fallback.fullName) {
          const parts = fallback.fullName.split(' ');
          defaults.firstName = parts[0] || '';
          defaults.lastName = parts.slice(1).join(' ') || '';
        }
      }
    } catch(e) {
      console.warn('Failed to parse fallbackRegistrationData', e);
    }

    return defaults;
  }, [requirements, defaultFirstName, defaultLastName, user?.email, application, currentTier]);

  // Create a stable resolver that updates when dynamicSchema changes
  const resolver = useMemo(() => zodResolver(dynamicSchema), [dynamicSchema]);

  const form = useForm<KitchenApplicationFormData>({
    resolver,
    defaultValues: getDefaultValues,
    mode: "onChange",
  });

  // Re-initialize form when requirements change - also trigger revalidation with new schema
  useEffect(() => {
    if (requirements) {
      form.reset(getDefaultValues);
      // Trigger revalidation with the new schema
      form.trigger();
    }
  }, [requirements, getDefaultValues, form]);

  // Watch all form values for progress calculation
  const watchedValues = useWatch({ control: form.control });

  // Calculate section progress
  const sectionProgress = useMemo(() => {
    const section1Fields = ['firstName', 'lastName', 'email', 'phone'] as const;
    const section2Fields = ['businessName', 'businessType', 'experience'] as const;
    const section3Fields = ['foodHandlerCertExpiry'] as const;
    const section4Fields = ['usageFrequency', 'sessionDuration'] as const;
    const section5Fields = ['termsAgree', 'accuracyAgree'] as const;

    const calcSectionProgress = (fields: readonly (keyof KitchenApplicationFormData)[]) => {
      let filled = 0;
      fields.forEach(field => {
        const value = watchedValues[field];
        if (typeof value === 'boolean') {
          if (value) filled++;
        } else if (value && String(value).trim()) {
          filled++;
        }
      });
      return Math.round((filled / fields.length) * 100);
    };

    // Section 3 includes file upload
    const section3Progress = () => {
      let filled = 0;
      const total = 2; // file + expiry date
      if (foodHandlerFile) filled++;
      if (watchedValues.foodHandlerCertExpiry) filled++;
      return Math.round((filled / total) * 100);
    };

    return {
      section1: calcSectionProgress(section1Fields),
      section2: calcSectionProgress(section2Fields),
      section3: section3Progress(),
      section4: calcSectionProgress(section4Fields),
      section5: calcSectionProgress(section5Fields),
    };
  }, [watchedValues, foodHandlerFile]);

  // Calculate overall progress
  const overallProgress = useMemo(() => {
    const { section1, section2, section3, section4, section5 } = sectionProgress;
    return Math.round((section1 + section2 + section3 + section4 + section5) / 5);
  }, [sectionProgress]);

  const showValidationToast = (messages: string[]) => {
    const uniqueMessages = Array.from(new Set(messages.filter(Boolean)));
    toast({
      title: t("missingInfo", { defaultValue: "Missing required information" }),
      description: uniqueMessages.length > 0
        ? uniqueMessages.join(", ")
        : t("completeReqFields", { defaultValue: "Please complete the required fields before submitting." }),
      variant: "destructive",
    });
  };

  const collectFormErrorMessages = (errors: FieldErrors<any>): string[] => {
    return Object.values(errors).flatMap((error: any) => {
      if (!error) return [];
      if (error.message) return [String(error.message)];
      if (typeof error === "object") return collectFormErrorMessages(error);
      return [];
    });
  };

  const getStep2FileValidationErrors = () => {
    const nextFileErrors: typeof fileErrors = {};
    const messages: string[] = [];

    if (currentTier >= 2) {
      if (requirements?.tier2_food_establishment_cert_required && !businessLicenseFile && !existingBusinessLicenseUrl) {
        nextFileErrors.businessLicense = t("valFoodEstExpiryReq", { defaultValue: "Food establishment license is required" });
        messages.push(t("uploadFoodEstLic", { defaultValue: "Upload your food establishment license" }));
      }

      if (requirements?.tier2_insurance_document_required && !insuranceFile) {
        nextFileErrors.insurance = t("valFieldReq", { defaultValue: "Insurance document is required", label: "Insurance" });
        messages.push(t("uploadInsurance", { defaultValue: "Upload your insurance document" }));
      }
    }

    return { nextFileErrors, messages };
  };

  const handleInvalidSubmit = (errors: FieldErrors<KitchenApplicationFormData>) => {
    const formMessages = collectFormErrorMessages(errors);
    const { nextFileErrors, messages: fileMessages } = getStep2FileValidationErrors();

    setFileErrors(nextFileErrors);
    showValidationToast([...formMessages, ...fileMessages]);
  };

  const onSubmit = async (data: KitchenApplicationFormData) => {
    setFileErrors({});

    // Validate file uploads and expiry dates ONLY for Tier 2 (manager approval step).
    // In Tier 1 (auto-submitted from registration), the user cannot upload files
    // from the registration modal, so we must not block submission on missing
    // document uploads. These are collected later in Tier 2.
    if (currentTier >= 2) {
      // Food Safety License is always mandatory on Step 2 (yes/no only on request-to-apply;
      // file upload lives here). Distinct from establishment license / insurance.
      if (!foodHandlerFile && !existingFoodHandlerUrl) {
        toast({
          title: t("missingDoc", { defaultValue: "Missing Document" }),
          description: t("uploadFoodSafetyLicense", { defaultValue: "Please upload your Food Safety License" }),
          variant: "destructive",
        });
        return;
      }

      if (!data.foodHandlerCertExpiry?.trim()) {
        form.setError("foodHandlerCertExpiry", {
          type: "required",
          message: t("valFoodSafetyExpiryReq", { defaultValue: "Food Safety License expiry date is required" }),
        });
        toast({
          title: t("missingDoc", { defaultValue: "Missing Document" }),
          description: t("valFoodSafetyExpiryReq", { defaultValue: "Food Safety License expiry date is required" }),
          variant: "destructive",
        });
        return;
      }

      const expiryDate = new Date(data.foodHandlerCertExpiry);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        toast({
          title: t("certExpired", { defaultValue: "Certificate Expired" }),
          description: t("uploadValidFoodSafetyLicense", { defaultValue: "Your Food Safety License has expired. Please upload a valid license." }),
          variant: "destructive",
        });
        return;
      }
    }

    if (currentTier >= 2) {
      const { nextFileErrors, messages: missingMessages } = getStep2FileValidationErrors();

      if (requirements?.tier2_food_establishment_expiry_required && !data.foodEstablishmentCertExpiry) {
        form.setError("foodEstablishmentCertExpiry", {
          type: "required",
          message: t("valFoodEstExpiryReq", { defaultValue: "Food establishment license expiry date is required" }),
        });
        missingMessages.push(t("valFoodEstExpiryReq", { defaultValue: "Food establishment license expiry date is required" }));
      }

      if (Object.keys(nextFileErrors).length > 0 || missingMessages.length > 0) {
        setFileErrors(nextFileErrors);
        showValidationToast(missingMessages);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();

      // Core fields (handle optional fields)
      // Step 2: prefer existing application values for Tier 1 fields the form no longer shows
      const existingFullName =
        application?.fullName && application.fullName !== "N/A" ? application.fullName : "";
      const submittedFullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();
      formData.append(
        "locationId",
        location.id.toString(),
      );
      formData.append(
        "fullName",
        submittedFullName || existingFullName || "N/A",
      );
      formData.append("email", data.email || application?.email || "");
      formData.append("phone", data.phone || application?.phone || "");
      formData.append("kitchenPreference", application?.kitchenPreference || "commercial");

      // Business info - store in businessDescription field
      let existingBusinessInfo: Record<string, any> = {};
      if (application?.businessDescription) {
        try {
          existingBusinessInfo =
            typeof application.businessDescription === "string"
              ? JSON.parse(application.businessDescription)
              : (application.businessDescription as Record<string, any>);
        } catch {
          existingBusinessInfo = {};
        }
      }
      const businessInfo = JSON.stringify({
        businessName: data.businessName || existingBusinessInfo.businessName || application?.shopName || "",
        businessType: data.businessType || existingBusinessInfo.businessType || "",
        experience: data.experience || existingBusinessInfo.experience || "",
        description: data.businessDescription || existingBusinessInfo.description || "",
        usageFrequency: data.usageFrequency || existingBusinessInfo.usageFrequency || "",
        sessionDuration: data.sessionDuration || existingBusinessInfo.sessionDuration || "",
        foodHandlerCertExpiry: data.foodHandlerCertExpiry || existingBusinessInfo.foodHandlerCertExpiry || null,
        foodEstablishmentCertExpiry:
          data.foodEstablishmentCertExpiry || existingBusinessInfo.foodEstablishmentCertExpiry || null,
      });
      formData.append("businessDescription", businessInfo);
      if (data.businessName || existingBusinessInfo.businessName || application?.shopName) {
        formData.append(
          "shopName",
          data.businessName || existingBusinessInfo.businessName || application?.shopName || "Shop Not Named",
        );
      }
      if (data.experience || existingBusinessInfo.experience || application?.cookingExperience) {
        formData.append(
          "cookingExperience",
          data.experience || existingBusinessInfo.experience || application?.cookingExperience || "",
        );
      }

      // Certification status — "yes" if new file uploaded OR existing cert already on record
      formData.append("foodSafetyLicense", (foodHandlerFile || existingFoodHandlerUrl) ? "yes" : "no");
      // Food establishment cert — "yes" if new file uploaded OR existing cert already on record
      formData.append("foodEstablishmentCert", (businessLicenseFile || existingBusinessLicenseUrl) ? "yes" : "no");

      // Expiry dates (only if provided)
      if (data.foodHandlerCertExpiry) {
        formData.append("foodSafetyLicenseExpiry", data.foodHandlerCertExpiry);
      }
      if (data.foodEstablishmentCertExpiry) {
        formData.append("foodEstablishmentCertExpiry", data.foodEstablishmentCertExpiry);
      }

      // Files
      if (foodHandlerFile) {
        formData.append("foodSafetyLicenseFile", foodHandlerFile);
      }
      if (businessLicenseFile) {
        formData.append("foodEstablishmentCertFile", businessLicenseFile);
      }

      // Custom fields data
      const customFieldsData: Record<string, any> = {};

      // Use tier-specific fields based on current tier
      let fieldsToUse: CustomField[] = [];
      if (currentTier === 1 && requirements?.tier1_custom_fields && Array.isArray(requirements.tier1_custom_fields)) {
        fieldsToUse = requirements.tier1_custom_fields;
      } else if (currentTier >= 2 && requirements?.tier2_custom_fields && Array.isArray(requirements.tier2_custom_fields)) {
        fieldsToUse = requirements.tier2_custom_fields;
      }

      fieldsToUse.forEach((field: CustomField) => {
        const fieldKey = `custom_${field.id}`;
        const value = data[fieldKey as keyof typeof data];

        // Handle different field types
        if (value !== undefined && value !== null) {
          // For checkbox with options (array), only include if array has items
          if (field.type === 'checkbox' && field.options && field.options.length > 0) {
            if (Array.isArray(value) && value.length > 0) {
              customFieldsData[field.id] = value;
            }
          }
          // For single checkbox (boolean), include if true
          else if (field.type === 'checkbox' && (!field.options || field.options.length === 0)) {
            if (value === true) {
              customFieldsData[field.id] = value;
            }
          }
          // For other fields, include if not empty string
          else if (value !== '') {
            customFieldsData[field.id] = value;
          }
        }
      });
      
      logger.info('[KitchenApplicationForm] Custom fields data:', {
        fieldsToUse: fieldsToUse.map(f => ({ id: f.id, label: f.label, type: f.type })),
        customFieldsData,
        formValues: Object.keys(data).filter(k => k.startsWith('custom_')).map(k => ({ key: k, value: data[k as keyof typeof data] }))
      });
      
      if (Object.keys(customFieldsData).length > 0) {
        formData.append("customFieldsData", JSON.stringify(customFieldsData));
        logger.info('[KitchenApplicationForm] Appending customFieldsData:', JSON.stringify(customFieldsData));
      } else {
        logger.warn('[KitchenApplicationForm] No custom fields data to append');
      }

      // Add tier data if submitting for higher tiers (currently supporting Tier 2)
      if (currentTier === 2) {
        const tierDataObj: Record<string, any> = {
          tier2: {},
        };
        // Add kitchen experience description if provided
        if (data.kitchenExperienceDescription) {
          tierDataObj.kitchen_experience_description = data.kitchenExperienceDescription;
        }
        formData.append("tier_data", JSON.stringify(tierDataObj));
        formData.append("current_tier", currentTier.toString());
      }

      // Add tier-specific file uploads
      if (insuranceFile) formData.append("tier2_insurance_document", insuranceFile);

      // Add custom field file uploads
      // Files are appended with prefix 'customFile_' + fieldId so server can identify them
      Object.entries(customFieldFiles).forEach(([fieldId, file]) => {
        formData.append(`customFile_${fieldId}`, file);
        logger.info(`[KitchenApplicationForm] Appending custom file: customFile_${fieldId}`, file.name);
      });

      await createApplication.mutateAsync(formData);
      
      // Clear fallback data since they have successfully submitted
      window.localStorage.removeItem('fallbackRegistrationData');

      setShowSuccess(true);
      refetch();
      refetchLocationApp();

    } catch (error: any) {
      toast({
        title: t("errorTitle", { defaultValue: "Error" }),
        description: error.message || t("failedSubmit", { defaultValue: "Failed to submit application" }),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // File change handlers
  const handleFoodHandlerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: t("fileTooLarge", { defaultValue: "File Too Large" }),
          description: t("maxFile5mb", { defaultValue: "Maximum file size is 5MB" }),
          variant: "destructive",
        });
        return;
      }
      setFoodHandlerFile(file);
    }
  };

  const handleBusinessLicenseFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: t("fileTooLarge", { defaultValue: "File Too Large" }),
          description: t("maxFile5mb", { defaultValue: "Maximum file size is 5MB" }),
          variant: "destructive",
        });
        return;
      }
      setBusinessLicenseFile(file);
      setFileErrors(prev => ({ ...prev, businessLicense: undefined }));
    }
  };

  const handleInsuranceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: t("fileTooLarge", { defaultValue: "File Too Large" }),
          description: t("maxFile10mb", { defaultValue: "Maximum file size is 10MB" }),
          variant: "destructive",
        });
        return;
      }
      setInsuranceFile(file);
      setFileErrors(prev => ({ ...prev, insurance: undefined }));
    }
  };

  // Success screen
  if (showSuccess) {
    return (
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-12 px-6"
        >
          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight">{t("applicationSubmitted", { defaultValue: "Application submitted" })}</h2>
          <p className="mx-auto mb-8 max-w-md text-muted-foreground">
            {t("applicationSubmittedDesc", { defaultValue: "Thank you! We\'ve received your kitchen application and will review it within 24 hours. Check your email for updates." })}
          </p>

          <div className="grid grid-cols-3 gap-4 mb-10">
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-2xl font-bold text-muted-foreground mb-1">1</div>
              <div className="text-xs text-muted-foreground">{t("documentsVerified", { defaultValue: "Documents Verified" })}<br />{t("twentyFourHours", { defaultValue: "(24 hours)" })}</div>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-2xl font-bold text-muted-foreground mb-1">2</div>
              <div className="text-xs text-muted-foreground">{t("accountActivated", { defaultValue: "Account" })}<br />{t("activated", { defaultValue: "Activated" })}</div>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-2xl font-bold text-muted-foreground mb-1">3</div>
              <div className="text-xs text-muted-foreground">{t("startBooking", { defaultValue: "Start Booking" })}<br />{t("kitchens", { defaultValue: "Kitchens" })}</div>
            </div>
          </div>

          <Button
            onClick={() => onSuccess ? onSuccess() : navigate("/dashboard")}
            className="w-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToDashboard", { defaultValue: "Back to Dashboard" })}
          </Button>
        </motion.div>
      </div>
    );
  }

  // Check if user already has an application for this location
  // Only block form while Step 1 is awaiting admin review (inReview + tier 1).
  // Allow Step 2 when approved, or when legacy buggy state left inReview with tier >= 2.
  if (
    hasApplication &&
    application &&
    application.status === "inReview" &&
    (application.current_tier ?? 1) < 2
  ) {
    const statusConfig = {
      inReview: {
        icon: Clock,
        color: "text-warning bg-muted",
        title: t("applicationPending", { defaultValue: "Application Pending" }),
        description: t("applicationPendingDesc", { defaultValue: "Your request to apply is being reviewed by the LocalCooks team." }),
      },
    };

    const config = statusConfig.inReview;
    const StatusIcon = config.icon;

    return (
      <div className="max-w-2xl mx-auto">
        <Card className="shadow-none">
          <CardContent className="p-8 text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${config.color}`}>
              <StatusIcon className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{config.title}</h2>
            <p className="text-muted-foreground mb-6">{config.description}</p>

            <div className="flex items-center justify-center gap-3 p-4 bg-muted rounded-lg mb-6">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">{location.name}</p>
                <p className="text-sm text-muted-foreground">{location.address}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onCancel || (() => navigate("/dashboard"))} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("backBtn", { defaultValue: "Back" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If fully approved (Tier 3: current_tier >= 3), show booking option
  if (hasApplication && application && application.status === "approved" && (application.current_tier ?? 1) >= 3) {
    const statusConfig = {
      approved: {
        icon: Check,
        color: "text-muted-foreground bg-muted",
        title: t("applicationApproved", { defaultValue: "Application approved" }),
        description: t("applicationApprovedDesc", { defaultValue: "Your application is fully approved. You can now book kitchens." }),
      },
    };

    const config = statusConfig.approved;
    const StatusIcon = config.icon;

    return (
      <div className="max-w-2xl mx-auto">
        <Card className="shadow-none">
          <CardContent className="p-8 text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${config.color}`}>
              <StatusIcon className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{config.title}</h2>
            <p className="text-muted-foreground mb-6">{config.description}</p>

            <div className="flex items-center justify-center gap-3 p-4 bg-muted rounded-lg mb-6">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">{location.name}</p>
                <p className="text-sm text-muted-foreground">{location.address}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onCancel || (() => navigate("/dashboard"))} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("backBtn", { defaultValue: "Back" })}
              </Button>

              <Button
                onClick={() => navigate(`/dashboard?view=kitchen-applications`)}
                className="flex-1"
              >
                {t("bookKitchenBtn", { defaultValue: "Book a Kitchen" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine if we should show re-application notice
  const showReapplicationNotice = hasApplication && application && (application.status === "rejected" || application.status === "cancelled");

  const reapplicationStatusConfig = {
    rejected: {
      icon: XCircle,
      color: "text-destructive bg-muted",
      title: t("prevAppRejected", { defaultValue: "Previous Application Rejected" }),
      description: application?.feedback || t("prevAppRejectedDesc", { defaultValue: "Your previous application was not approved." }),
    },
    cancelled: {
      icon: AlertCircle,
      color: "text-muted-foreground bg-muted",
      title: t("prevAppCancelled", { defaultValue: "Previous Application Cancelled" }),
      description: t("prevAppCancelledDesc", { defaultValue: "Your previous application was cancelled." }),
    },
  };

  const reapplicationConfig = showReapplicationNotice && application
    ? reapplicationStatusConfig[application.status as "rejected" | "cancelled"]
    : null;

  // Show loading state while fetching requirements
  if (isLoadingRequirements) {
    return (
      <div className="max-w-[700px] mx-auto py-12 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto">
      {/* Re-application notice if previously rejected or cancelled */}
      {showReapplicationNotice && reapplicationConfig && (
        <div className="mb-6">
          <Card className="shadow-none border">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${reapplicationConfig.color}`}>
                  {application?.status === "rejected" ? (
                    <XCircle className="h-6 w-6" />
                  ) : (
                    <AlertCircle className="h-6 w-6" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">{reapplicationConfig.title}</h3>
                  <p className="text-sm text-muted-foreground mb-3">{reapplicationConfig.description}</p>
                  <p className="text-sm text-muted-foreground font-medium">
                    {t("submitNewApp", { defaultValue: "You can submit a new application below with updated information." })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <ChefPageHeader
        title={t("requestToApply", { defaultValue: "Request to apply" })}
        description={t("requestToApplyAt", {
          defaultValue: "Request to apply at {name}",
          name: location.name,
        })}
        className="mb-8"
      />

      {/* Tier Progress Indicator */}
      {hasApplication && application && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">{t("appProgress", { defaultValue: "Application Progress" })}</h3>
            <span className="text-xs text-muted-foreground">
              {currentTier === 1
                ? t("requestToApplyProgress", { defaultValue: "Request to apply" })
                : t("step2Of2KitchenDocs", { defaultValue: "Kitchen documents (Step 2)" })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2].map((tier) => {
              const isComplete = (tier === 1 && application.tier1_completed_at) ||
                (tier === 2 && application.tier2_completed_at);
              const isCurrent = tier === currentTier;
              const isPast = tier < currentTier;

              return (
                <div key={tier} className="flex-1 flex items-center">
                  <div className={`flex-1 h-2 rounded-full ${isComplete || isPast ? 'bg-foreground' :
                    isCurrent ? 'bg-foreground/40' : 'bg-muted'
                    }`} />
                  {tier < 2 && (
                    <div className={`w-2 h-2 rounded-full mx-1 ${isComplete || isPast ? 'bg-foreground' :
                      isCurrent ? 'bg-foreground/40' : 'bg-muted'
                      }`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{t("step1Submit", { defaultValue: "Request to apply" })}</span>
            <span>{t("step2Coordinate", { defaultValue: "Kitchen documents" })}</span>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-10">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-foreground rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <div className="text-right mt-1">
          <span className="text-xs text-muted-foreground">{overallProgress}% {t("complete", { defaultValue: "complete" })}</span>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, handleInvalidSubmit)} className="space-y-6">
          {/* TIER 1 SECTIONS - Only show when on Tier 1 */}
          {currentTier === 1 && (
            <>
              {/* SECTION 1: About You - Hide if global app has collected this */}
              {!globalApp && (
                <Card className="shadow-none">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-6 pb-3 border-b">
                      <h3 className="font-semibold">{t("aboutYou", { defaultValue: "About You" })}</h3>
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                        {sectionProgress.section1}%
                      </span>
                    </div>

                    <div className="rounded-lg border p-4 rounded-r-lg mb-6">
                      <div className="flex gap-2">
                        <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-muted-foreground">
                          {t("reviewAppDesc", { defaultValue: "We typically review applications within 24 hours. You\'ll need food safety certification to get started." })}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("firstName", { defaultValue: "First Name" })} {requirements?.requireFirstName !== false && <span className="text-destructive">*</span>}
                              {requirements?.requireFirstName === false && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                            </FormLabel>
                            <FormControl>
                              <Input {...field} className="h-11" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("lastName", { defaultValue: "Last Name" })} {requirements?.requireLastName !== false && <span className="text-destructive">*</span>}
                              {requirements?.requireLastName === false && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                            </FormLabel>
                            <FormControl>
                              <Input {...field} className="h-11" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("emailAddress", { defaultValue: "Email Address" })} {requirements?.requireEmail !== false && <span className="text-destructive">*</span>}
                              {requirements?.requireEmail === false && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                            </FormLabel>
                            <FormControl>
                              <Input type="email" {...field} className="h-11" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("phoneNumber", { defaultValue: "Phone Number" })} {requirements?.requirePhone !== false && <span className="text-destructive">*</span>}
                              {requirements?.requirePhone === false && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                            </FormLabel>
                            <FormControl>
                              <Input type="tel" placeholder="(709) 000-0000" {...field} className="h-11" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* SECTION 2: Your Food Business */}
              {!globalApp && (
                <Card className="shadow-none mb-6">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-6 pb-3 border-b">
                      <h3 className="font-semibold">{t("yourFoodBusiness", { defaultValue: "Your Food Business" })}</h3>
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                      {sectionProgress.section2}%
                    </span>
                  </div>

                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">
                            {t("businessName", { defaultValue: "Business Name" })}{" "}
                            <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("businessNamePlaceholder", { defaultValue: "e.g., Sarah\'s Catering, Artisan Bakery Co." })}
                              {...field}
                              className="h-11"
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("businessNameHelp", { defaultValue: "What is your food business called? (If freelance, use your name)" })}
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="businessType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">
                            {t("typeOfFoodBusiness", { defaultValue: "Type of Food Business" })}{" "}
                            <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>
                          </FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder={t("selectBusinessType", { defaultValue: "-- Select your business type --" })} />
                              </SelectTrigger>
                              <SelectContent>
                                {businessTypes.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {t(type.key, { defaultValue: type.label })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="experience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">
                            {t("yearsOfExperience", { defaultValue: "Years of Experience" })} {requirements?.tier1_years_experience_required && <span className="text-destructive">*</span>}
                            {!requirements?.tier1_years_experience_required && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder={t("selectExperienceLevel", { defaultValue: "-- Select experience level --" })} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {experienceLevels.map((level) => (
                                <SelectItem key={level.value} value={level.value}>
                                  {t({"0-2": "expJustStarting", "2-5": "expGrowing", "5-10": "expEstablished", "10+": "expExpert"}[level.value] || "expJustStarting", { defaultValue: level.label })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {requirements?.requireBusinessDescription !== false && (
                      <FormField
                        control={form.control}
                        name="businessDescription"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("tellUsAboutBusiness", { defaultValue: "Tell Us About Your Business" })}
                              {requirements?.requireBusinessDescription && <span className="text-destructive">*</span>}
                              {!requirements?.requireBusinessDescription && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t("businessDescPlaceholder", { defaultValue: "Brief description of what you prepare, your target market, etc." })}
                                className="min-h-[80px] resize-none"
                                {...field}
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground mt-1">
                              {requirements?.requireBusinessDescription
                                ? t("businessDescHelpRequired", { defaultValue: "Please provide a brief description of your food business" })
                                : t("businessDescHelpOptional", { defaultValue: "Optional, but helps us connect you with suitable kitchen times" })}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* SECTION 3: Food Safety & Certifications - Info only for Step 1.
                   File uploads and expiry dates are collected in Step 2 since the
                   registration modal (which auto-submits Step 1) cannot upload files. */}
              {currentTier === 1 && (
                <Card className="shadow-none mb-6">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-6 pb-3 border-b">
                      <h3 className="font-semibold">{t("foodSafetyCertifications", { defaultValue: "Food Safety & Certifications" })}</h3>
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                        {t("step2OnlyShort", { defaultValue: "Step 2" })}
                      </span>
                    </div>

                    <div className="rounded-lg border p-4">
                      <div className="flex gap-2">
                        <Check className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-muted-foreground">
                          <p className="mb-2 font-medium text-foreground">
                            {t("docsRequiredForStep2Title", { defaultValue: "Documents will be requested in Step 2" })}
                          </p>
                          <p>
                            {t("docsRequiredForStep2Desc", {
                              defaultValue: "All chefs must upload a current Food Safety License (and any other documents this kitchen requires) in Step 2 after your request to apply is approved."
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* SECTION 4: Kitchen Usage */}
              <Card className="shadow-none">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6 pb-3 border-b">
                    <h3 className="font-semibold">{t("kitchenUsage", { defaultValue: "Kitchen Usage" })}</h3>
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                      {sectionProgress.section4}%
                    </span>
                  </div>

                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="usageFrequency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">
                            {t("howOftenNeedKitchen", { defaultValue: "How Often Do You Need Kitchen Space?" })} {requirements?.requireUsageFrequency !== false && <span className="text-destructive">*</span>}
                            {requirements?.requireUsageFrequency === false && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                          </FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder={t("selectFrequency", { defaultValue: "-- Select frequency --" })} />
                              </SelectTrigger>
                              <SelectContent>
                                {usageFrequencies.map((freq) => (
                                  <SelectItem key={freq.value} value={freq.value}>
                                    {t(freq.key, { defaultValue: freq.label })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="sessionDuration"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">
                            {t("typicalSessionLength", { defaultValue: "Typical Session Length" })} {requirements?.requireSessionDuration !== false && <span className="text-destructive">*</span>}
                            {requirements?.requireSessionDuration === false && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                          </FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder={t("selectDuration", { defaultValue: "-- Select duration --" })} />
                              </SelectTrigger>
                              <SelectContent>
                                {sessionDurations.map((dur) => (
                                  <SelectItem key={dur.value} value={dur.value}>
                                    {t({"2-4": "dur2to4", "4-8": "dur4to8", "8-12": "dur8to12", "12+": "dur12plus"}[dur.value] || "dur2to4", { defaultValue: dur.label })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Custom Fields Section */}
              {(() => {
                // Determine which fields to render based on tier
                let fieldsToRender: CustomField[] = [];
                if (currentTier === 1 && requirements?.tier1_custom_fields && Array.isArray(requirements.tier1_custom_fields)) {
                  fieldsToRender = requirements.tier1_custom_fields;
                } else if (requirements?.customFields && Array.isArray(requirements.customFields)) {
                  fieldsToRender = requirements.customFields;
                }

                if (fieldsToRender.length === 0) return null;

                // Required custom fields first, then optional
                const orderedFields = [...fieldsToRender].sort((a, b) => {
                  const ar = a.required ? 0 : 1;
                  const br = b.required ? 0 : 1;
                  return ar - br;
                });

                return (
                  <Card className="shadow-none">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-6 pb-3 border-b">
                        <h3 className="font-semibold">{t("additionalInfo", { defaultValue: "Additional Information" })}</h3>
                      </div>

                      <div className="space-y-4">
                        {orderedFields.map((field: CustomField) => {
                          if (!field || !field.id || !field.type) return null;

                          const fieldName = `custom_${field.id}` as keyof KitchenApplicationFormData;
                          return (
                            <FormField
                              key={field.id}
                              control={form.control}
                              name={fieldName}
                              render={({ field: formField }) => {
                                // Render the appropriate input based on field type
                                let inputElement = null;

                                if (field.type === 'text') {
                                  inputElement = (
                                    <Input
                                      {...formField}
                                      placeholder={field.placeholder}
                                      className="h-11"
                                      value={formField.value as string || ''}
                                    />
                                  );
                                } else if (field.type === 'textarea') {
                                  inputElement = (
                                    <Textarea
                                      {...formField}
                                      placeholder={field.placeholder}
                                      className="min-h-[80px] resize-none"
                                      value={formField.value as string || ''}
                                    />
                                  );
                                } else if (field.type === 'number') {
                                  inputElement = (
                                    <Input
                                      type="number"
                                      placeholder={field.placeholder}
                                      className="h-11"
                                      value={typeof formField.value === 'number' ? formField.value : (typeof formField.value === 'string' ? formField.value : '') as string | number}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        formField.onChange(val ? (isNaN(parseFloat(val)) ? undefined : parseFloat(val)) : undefined);
                                      }}
                                    />
                                  );
                                } else if (field.type === 'select' && field.options && Array.isArray(field.options)) {
                                  inputElement = (
                                    <Select
                                      onValueChange={formField.onChange}
                                      value={formField.value as string || ''}
                                    >
                                      <SelectTrigger className="h-11">
                                        <SelectValue placeholder={field.placeholder || `-- Select ${field.label} --`} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {field.options.map((option) => (
                                          <SelectItem key={option} value={option}>
                                            {option}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  );
                                } else if (field.type === 'checkbox') {
                                  if (field.options && Array.isArray(field.options) && field.options.length > 0) {
                                    // Multi-checkbox: show multiple checkboxes for each option
                                    inputElement = (
                                      <div className="space-y-3">
                                        {field.options.map((option) => {
                                          const selectedValues = (formField.value as string[]) || [];
                                          const isChecked = selectedValues.includes(option);
                                          return (
                                            <div key={option} className="flex items-center space-x-2">
                                              <Checkbox
                                                checked={isChecked}
                                                onCheckedChange={(checked) => {
                                                  const currentValues = (formField.value as string[]) || [];
                                                  if (checked) {
                                                    formField.onChange([...currentValues, option]);
                                                  } else {
                                                    formField.onChange(currentValues.filter(v => v !== option));
                                                  }
                                                }}
                                              />
                                              <Label className="text-sm font-normal text-muted-foreground cursor-pointer">
                                                {option}
                                              </Label>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  } else {
                                    // Single checkbox: show one checkbox
                                    inputElement = (
                                      <div className="flex items-center space-x-2">
                                        <Checkbox
                                          checked={formField.value as boolean || false}
                                          onCheckedChange={formField.onChange}
                                          />
                                        <Label className="text-sm font-normal text-muted-foreground">
                                          {field.placeholder || `I confirm ${field.label}`}
                                        </Label>
                                      </div>
                                    );
                                  }
                                } else if (field.type === 'date') {
                                  inputElement = (
                                    <Input
                                      {...formField}
                                      type="date"
                                      className="h-11"
                                      value={formField.value as string || ''}
                                    />
                                  );
                                } else if (field.type === 'file' || field.type === 'cloudflare_upload') {
                                  // File upload field - stores actual File object for upload on submit
                                  const existingFile = customFieldFiles[field.id];
                                  const hasFile = !!existingFile || !!formField.value;
                                  inputElement = (
                                    <div className="space-y-2">
                                      <label
                                        className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                                          hasFile 
                                            ? 'border-border bg-muted/30 hover:border-foreground/20' 
                                            : 'border-border hover:border-foreground/30'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                          <Upload className={`h-5 w-5 ${hasFile ? 'text-success' : ''}`} />
                                          <span className="text-sm">
                                            {existingFile ? existingFile.name : (formField.value ? t("fileUploadedClickToReplace", { defaultValue: "File uploaded - Click to replace" }) : (field.placeholder || t("clickToUploadFile", { defaultValue: "Click to upload file" })))}
                                          </span>
                                        </div>
                                        <input
                                          type="file"
                                          className="hidden"
                                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                              if (file.size > 10 * 1024 * 1024) {
                                                toast({
                                                  title: t("fileTooLarge", { defaultValue: "File Too Large" }),
                                                  description: t("maxFile10mb", { defaultValue: "Maximum file size is 10MB" }),
                                                  variant: "destructive",
                                                });
                                                return;
                                              }
                                              // Store actual File object in state for upload on form submit
                                              setCustomFieldFiles(prev => ({
                                                ...prev,
                                                [field.id]: file
                                              }));
                                              // Store filename in form for validation
                                              formField.onChange(file.name);
                                            }
                                          }}
                                        />
                                        <span className="text-xs text-muted-foreground mt-1">{t("fileFormatMax10MB_doc", { defaultValue: "PDF, JPG, PNG, DOC (max 10MB)" })}</span>
                                      </label>
                                      {existingFile && (
                                        <p className="text-xs text-success flex items-center gap-1">
                                          <Check className="h-3 w-3" />
                                          {t("readyToUpload", { defaultValue: "Ready to upload:" })} {existingFile.name}
                                        </p>
                                      )}
                                      {!existingFile && formField.value && (
                                        <p className="text-xs text-muted-foreground">{t("previouslyUploaded", { defaultValue: "Previously uploaded" })}</p>
                                      )}
                                    </div>
                                  );
                                }

                                // If no input element was created, return a fallback element
                                if (!inputElement) {
                                  return (
                                    <FormItem>
                                      <FormLabel className="text-sm font-medium">
                                        {field.label}
                                        {field.required && <span className="text-destructive">*</span>}
                                      </FormLabel>
                                      <FormControl>
                                        <div className="text-sm text-muted-foreground">{t("unsupportedFieldType", { defaultValue: "Unsupported field type:" })} {field.type}</div>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  );
                                }

                                return (
                                  <FormItem>
                                    <FormLabel className="text-sm font-medium">
                                      {field.label}
                                      {field.required && <span className="text-destructive">*</span>}
                                      {!field.required && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                                    </FormLabel>
                                    <FormControl>
                                      {inputElement}
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                );
                              }}
                            />
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* SECTION 5: Terms & Agreements */}
              <Card className="shadow-none">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6 pb-3 border-b">
                    <h3 className="font-semibold">{t("termsAndAgreements", { defaultValue: "Terms & Agreements" })}</h3>
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                      {sectionProgress.section5}%
                    </span>
                  </div>

                  <div className="space-y-4">
                    {/* Kitchen-specific Terms & Policies */}
                    {location.kitchenTermsUrl && (
                      <div className="rounded-lg border p-4 mb-4">
                        <div className="flex items-start gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-medium mb-1">
                              {location.name} {t("kitchenTermsAndPolicies", { defaultValue: "Kitchen Terms & Policies" })}
                            </h4>
                            <p className="text-sm text-muted-foreground mb-2">
                              {t("reviewKitchenTermsDesc", { defaultValue: "Please review the kitchen-specific terms, house rules, and policies before proceeding." })}
                            </p>
                            <AuthenticatedDocumentLink
                              url={location.kitchenTermsUrl}
                              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                            >
                              <FileText className="h-4 w-4" />
                              {t("viewKitchenTerms", { defaultValue: "View Kitchen Terms & Policies →" })}
                            </AuthenticatedDocumentLink>
                          </div>
                        </div>
                      </div>
                    )}

                    <FormField
                      control={form.control}
                      name="termsAgree"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="mt-1"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="text-sm text-muted-foreground font-normal cursor-pointer">
                              {t("agreeToLocalCooksPolicies1", { defaultValue: "I agree to Local Cooks\' kitchen usage policies and food safety standards" })}
                              {location.kitchenTermsUrl && t("agreeToLocalCooksPolicies2", { defaultValue: ", including the kitchen-specific terms and policies above" })},
                              {t("agreeToLocalCooksPolicies3", { defaultValue: " and understand that all chefs must maintain current food safety certifications." })}
                            </FormLabel>
                            <FormMessage />
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="accuracyAgree"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="mt-1"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="text-sm text-muted-foreground font-normal cursor-pointer">
                              {t("certifyInfoAccurate1", { defaultValue: "I certify that all information provided is accurate and complete." })}
                              {t("certifyInfoAccurate2", { defaultValue: "I understand that misrepresentation may result in account suspension." })}
                            </FormLabel>
                            <FormMessage />
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* TIER 2: Kitchen Coordination (shown when Tier 1 is approved and moving to Tier 2) */}
          {/* Note: Facility documents (floor plans, equipment, materials, ventilation) are sent by managers via chat */}
          {currentTier >= 2 && (
            <>
              <Card className="shadow-none">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6 border-b pb-3">
                    <div>
                      <h3 className="font-semibold">{t("step2KitchenCoordination", { defaultValue: "Step 2: Kitchen Coordination" })}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{t("uploadDocsCoordinate", { defaultValue: "Upload required documents and coordinate with the manager" })}</p>
                    </div>
                    <Badge variant={application?.tier2_completed_at ? "success" : "outline"} className="font-medium">
                      {application?.tier2_completed_at ? t("submitted", { defaultValue: "Submitted" }) : t("inProgress", { defaultValue: "In progress" })}
                    </Badge>
                  </div>

                  {/* Show submitted confirmation when Tier 2 is already completed */}
                  {application?.tier2_completed_at ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border p-4">
                        <div className="flex items-center gap-3">
                          <Check className="h-6 w-6 text-success" />
                          <div>
                            <p className="font-medium">{t("docsSubmittedSuccessfully", { defaultValue: "Documents Submitted Successfully" })}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {t("step2DocsAwaitingReview", { defaultValue: "Your Step 2 documents have been submitted and are awaiting manager review." })}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-muted rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">
                          <strong>{t("whatHappensNext", { defaultValue: "What happens next?" })}</strong><br />
                          {t("managerWillReviewDocs1", { defaultValue: "The manager will review your submitted documents. They may reach out via chat if additional information is needed." })}
                          {t("managerWillReviewDocs2", { defaultValue: "Once approved, you\'ll have full access to book this kitchen." })}
                        </p>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {t("submittedOn", { defaultValue: "Submitted on:" })} {new Date(application.tier2_completed_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="rounded-lg border p-4 mb-4">
                        <p className="text-sm text-muted-foreground">
                          <strong>{t("note", { defaultValue: "Note:" })}</strong> {t("uploadDocsManagerWillShare", { defaultValue: "Upload the required documents below. The manager will share facility information via chat." })}
                        </p>
                      </div>

                      {needsPhoneOnStep2 && (
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-medium">
                                {t("phoneNumber", { defaultValue: "Phone Number" })}{" "}
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <p className="text-xs text-muted-foreground mb-2">
                                {t("phoneNeededForStep2", {
                                  defaultValue: "We don’t have a phone number on your request to apply. Please add one so the kitchen can reach you.",
                                })}
                              </p>
                              <FormControl>
                                <Input type="tel" placeholder="(709) 000-0000" {...field} value={field.value ?? ""} className="h-11" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Food Safety License — mandatory on Step 2 (request-to-apply only asks yes/no).
                          Stored in foodSafetyLicenseUrl; distinct from establishment license / insurance. */}
                      <div>
                        <div className="mb-6 rounded-lg border p-4">
                          <div className="flex gap-2">
                            <Check className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-muted-foreground">
                              {t("allChefsMustHaveFoodSafetyLicense", { defaultValue: "All chefs must upload a current Food Safety License to use our kitchens." })}
                            </p>
                          </div>
                        </div>

                        <Label className="text-sm font-medium block mb-2">
                          {t("foodSafetyLicenseLabel", { defaultValue: "Food Safety License" })}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <p className="text-xs text-muted-foreground mb-3">
                          {t("uploadFoodSafetyLicenseDesc", { defaultValue: "Upload a photo or PDF of your current Food Safety License (must be valid and current)" })}
                        </p>

                        {existingFoodHandlerUrl && !foodHandlerFile && (
                          <div className="flex items-center gap-3 p-3 border rounded-lg mb-3">
                            <Check className="h-5 w-5 text-success" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">{t("foodSafetyLicense", { defaultValue: "Food Safety License" })}</p>
                              <p className="text-xs text-muted-foreground">{t("previouslyUploadedApproved", { defaultValue: "Previously uploaded - approved" })}</p>
                              <a
                                href={existingFoodHandlerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline"
                              >
                                {t("viewLicense", { defaultValue: "View license" })}
                              </a>
                            </div>
                          </div>
                        )}

                        <label
                          htmlFor="step2-foodSafetyLicense"
                          className={`flex items-center justify-center gap-3 p-5 border-2 border-dashed rounded-lg cursor-pointer transition-all
                            ${foodHandlerFile
                              ? 'border-success/40 bg-success/10'
                              : existingFoodHandlerUrl
                                ? 'border-border bg-muted'
                                : 'border-border bg-muted hover:border-foreground/30 hover:bg-muted'
                            }`}
                        >
                          <FileText className={`h-5 w-5 text-muted-foreground`} />
                          <div className="text-left">
                            <p className="text-sm font-medium">
                              {foodHandlerFile
                                ? foodHandlerFile.name
                                : existingFoodHandlerUrl
                                  ? t("replaceExistingLicense", { defaultValue: "Replace existing license" })
                                  : t("clickToUploadLicense", { defaultValue: "Click to upload license" })
                              }
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {existingFoodHandlerUrl ? t("uploadNewFileToReplace", { defaultValue: "Upload new file to replace" }) : t("fileFormatMax5MB", { defaultValue: "PDF, JPG, PNG (max 5MB)" })}
                            </p>
                          </div>
                          {foodHandlerFile && <Check className="h-5 w-5 text-muted-foreground ml-auto" />}
                        </label>
                        <input
                          type="file"
                          id="step2-foodSafetyLicense"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={handleFoodHandlerFileChange}
                          className="hidden"
                        />

                        {foodHandlerFile && (
                          <div className="flex items-center gap-2 mt-2 p-2 bg-muted rounded text-muted-foreground text-sm">
                            <Check className="h-4 w-4" />
                            {t("newFoodSafetyLicenseUploaded", { defaultValue: "New Food Safety License uploaded - will replace existing" })}
                          </div>
                        )}
                      </div>

                      <FormField
                        control={form.control}
                        name="foodHandlerCertExpiry"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("foodSafetyLicenseExpiryLabel", { defaultValue: "Food Safety License Expiry Date" })}{" "}
                              <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input type="date" {...field} className="h-11" />
                            </FormControl>
                            <p className="text-xs text-muted-foreground mt-1">
                              {t("licenseValid6Months", { defaultValue: "Your license must be valid for at least 6 months" })}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Food Establishment License/Permit */}
                        <div>
                          <Label className="text-sm font-medium block mb-2">
                            {t("foodEstablishmentLicenseLabel", { defaultValue: "Food Establishment License/Permit" })}
                            {requirements?.tier2_food_establishment_cert_required && <span className="text-destructive">*</span>}
                            {!requirements?.tier2_food_establishment_cert_required && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                          </Label>
                          <p className="text-xs text-muted-foreground mb-3">
                            {t("foodEstablishmentLicenseDesc", { defaultValue: "If you operate as a registered food business, upload proof of license." })}
                          </p>

                          {/* Show existing file if available */}
                          {existingBusinessLicenseUrl && !businessLicenseFile && (
                            <div className="flex items-center gap-3 p-3 border rounded-lg mb-3">
                              <Check className="h-5 w-5 text-success" />
                              <div className="flex-1">
                                <p className="text-sm font-medium">{t("businessLicense", { defaultValue: "Business License" })}</p>
                                <p className="text-xs text-muted-foreground">{t("previouslyUploadedApproved", { defaultValue: "Previously uploaded - approved" })}</p>
                                <a
                                  href={existingBusinessLicenseUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline"
                                >
                                  {t("viewLicense", { defaultValue: "View license" })}
                                </a>
                              </div>
                            </div>
                          )}

                          <label
                            htmlFor="businessLicense"
                            className={`flex items-center justify-center gap-3 p-5 border-2 border-dashed rounded-lg cursor-pointer transition-all
                            ${fileErrors.businessLicense
                                ? 'border-destructive/50 bg-muted/30'
                                : businessLicenseFile
                                ? 'border-success/40 bg-success/10'
                                : existingBusinessLicenseUrl
                                  ? 'border-border bg-muted'
                                  : 'border-border bg-muted hover:border-foreground/30 hover:bg-muted'
                              }`}
                          >
                            <Upload className={`h-5 w-5 ${businessLicenseFile || existingBusinessLicenseUrl ? 'text-muted-foreground' : 'text-muted-foreground'}`} />
                            <div className="text-left">
                              <p className="text-sm font-medium">
                                {businessLicenseFile
                                  ? businessLicenseFile.name
                                  : existingBusinessLicenseUrl
                                    ? t("replaceExistingLicense", { defaultValue: "Replace existing license" })
                                    : t("clickToUploadLicense", { defaultValue: "Click to upload license" })
                                }
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {existingBusinessLicenseUrl ? t("uploadNewFileToReplace", { defaultValue: "Upload new file to replace" }) : t("fileFormatMax5MB", { defaultValue: "PDF, JPG, PNG (max 5MB)" })}
                              </p>
                            </div>
                            {businessLicenseFile && <Check className="h-5 w-5 text-muted-foreground ml-auto" />}
                          </label>
                          <input
                            type="file"
                            id="businessLicense"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleBusinessLicenseFileChange}
                            className="hidden"
                          />

                          {businessLicenseFile && (
                            <div className="flex items-center gap-2 mt-2 p-2 bg-muted rounded text-muted-foreground text-sm">
                              <Check className="h-4 w-4" />
                              {t("newBusinessLicenseUploaded", { defaultValue: "New Business License uploaded - will replace existing" })}
                            </div>
                          )}
                          {fileErrors.businessLicense && (
                            <p className="text-sm font-medium text-destructive mt-2">{fileErrors.businessLicense}</p>
                          )}
                        </div>

                      {/* Food Establishment Expiry Date */}
                        <FormField
                          control={form.control}
                          name="foodEstablishmentCertExpiry"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-medium">
                                {t("foodEstablishmentExpiryLabel", { defaultValue: "Food Establishment License Expiry Date" })}
                                {requirements?.tier2_food_establishment_expiry_required && <span className="text-destructive">*</span>}
                                {!requirements?.tier2_food_establishment_expiry_required && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                              </FormLabel>
                              <FormControl>
                                <Input type="date" {...field} className="h-11" />
                              </FormControl>
                              <p className="text-xs text-muted-foreground mt-1">
                                {requirements?.tier2_food_establishment_expiry_required
                                  ? t("enterFoodEstExpiry", { defaultValue: "Enter the expiry date for your food establishment license" })
                                  : t("enterFoodEstExpiryOptional", { defaultValue: "Optional - Enter if you have a food establishment license" })}
                              </p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                      {/* Insurance Document */}
                        <div className="pt-4 border-t border-gray-100">
                          <Label className="text-sm font-medium block mb-2">
                            {t("insuranceDocument", { defaultValue: "Insurance Document" })}
                            {requirements?.tier2_insurance_document_required && <span className="text-destructive">*</span>}
                            {!requirements?.tier2_insurance_document_required && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                          </Label>
                          <p className="text-xs text-muted-foreground mb-3">
                            {t("uploadLiabilityInsurance", { defaultValue: "Upload your current commercial liability insurance document." })}
                          </p>
                          <label
                            htmlFor="insuranceDoc"
                            className={`flex items-center justify-center gap-3 p-5 border-2 border-dashed rounded-lg cursor-pointer transition-all
                            ${fileErrors.insurance
                                ? 'border-destructive/50 bg-muted/30'
                                : insuranceFile
                                ? 'border-success/40 bg-success/10'
                                : 'border-border bg-muted hover:border-foreground/30 hover:bg-muted'
                              }`}
                          >
                            <Upload className={`h-5 w-5 ${insuranceFile ? 'text-muted-foreground' : 'text-muted-foreground'}`} />
                            <div className="text-left">
                              <p className="text-sm font-medium">
                                {insuranceFile ? insuranceFile.name : t("clickToUploadInsurance", { defaultValue: "Click to upload insurance document" })}
                              </p>
                              <p className="text-xs text-muted-foreground">{t("fileFormatMax10MB", { defaultValue: "PDF, JPG, PNG (max 10MB)" })}</p>
                            </div>
                          </label>
                          <input
                            type="file"
                            id="insuranceDoc"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleInsuranceFileChange}
                            className="hidden"
                          />
                          {fileErrors.insurance && (
                            <p className="text-sm font-medium text-destructive mt-2">{fileErrors.insurance}</p>
                          )}
                        </div>

                      {/* Kitchen Experience Description */}
                      {requirements?.tier2_kitchen_experience_required && (
                        <div className="pt-4 border-t border-gray-100">
                          <FormField
                            control={form.control}
                            name="kitchenExperienceDescription"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-sm font-medium">
                                  {t("kitchenExpDescLabel", { defaultValue: "Kitchen Experience Description" })}
                                  <span className="text-destructive">*</span>
                                </FormLabel>
                                <FormControl>
                                  <Textarea
                                    {...field}
                                    placeholder={t("kitchenExpDescPlaceholder", { defaultValue: "Describe your experience working in commercial kitchens, including types of establishments, roles, and duration..." })}
                                    className="min-h-[100px] resize-none"
                                    value={field.value || ''}
                                  />
                                </FormControl>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {t("kitchenExpDescHelp", { defaultValue: "Please describe your commercial kitchen experience, including any relevant training or certifications." })}
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}

                      {/* Tier 2 Custom Fields */}
                      {requirements?.tier2_custom_fields && Array.isArray(requirements.tier2_custom_fields) && requirements.tier2_custom_fields.length > 0 && (
                        <div className="pt-4 border-t border-gray-100">
                          <p className="text-sm font-medium text-muted-foreground mb-4">{t("additionalRequirements", { defaultValue: "Additional Requirements" })}</p>
                          <div className="space-y-4">
                            {requirements.tier2_custom_fields.map((field: CustomField) => {
                              if (!field || !field.id || !field.type) return null;
                              const fieldName = `custom_${field.id}` as keyof KitchenApplicationFormData;
                              return (
                                <FormField
                                  key={field.id}
                                  control={form.control}
                                  name={fieldName}
                                  render={({ field: formField }) => {
                                    let inputElement = null;
                                    if (field.type === 'text') {
                                      inputElement = (
                                        <Input
                                          {...formField}
                                          placeholder={field.placeholder}
                                          className="h-11"
                                          value={formField.value as string || ''}
                                        />
                                      );
                                    } else if (field.type === 'textarea') {
                                      inputElement = (
                                        <Textarea
                                          {...formField}
                                          placeholder={field.placeholder}
                                          className="min-h-[80px] resize-none"
                                          value={formField.value as string || ''}
                                        />
                                      );
                                    } else if (field.type === 'number') {
                                      inputElement = (
                                        <Input
                                          type="number"
                                          placeholder={field.placeholder}
                                          className="h-11"
                                          value={formField.value !== undefined ? String(formField.value) : ''}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            formField.onChange(val ? (isNaN(parseFloat(val)) ? undefined : parseFloat(val)) : undefined);
                                          }}
                                        />
                                      );
                                    } else if (field.type === 'select' && field.options && Array.isArray(field.options)) {
                                      inputElement = (
                                        <Select
                                          onValueChange={formField.onChange}
                                          value={formField.value as string || ''}
                                        >
                                          <SelectTrigger className="h-11">
                                            <SelectValue placeholder={field.placeholder || `-- Select ${field.label} --`} />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {field.options.map((option) => (
                                              <SelectItem key={option} value={option}>
                                                {option}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      );
                                    } else if (field.type === 'checkbox') {
                                      if (field.options && Array.isArray(field.options) && field.options.length > 0) {
                                        inputElement = (
                                          <div className="space-y-3">
                                            {field.options.map((option) => {
                                              const selectedValues = (formField.value as string[]) || [];
                                              const isChecked = selectedValues.includes(option);
                                              return (
                                                <div key={option} className="flex items-center space-x-2">
                                                  <Checkbox
                                                    checked={isChecked}
                                                    onCheckedChange={(checked) => {
                                                      const currentValues = (formField.value as string[]) || [];
                                                      if (checked) {
                                                        formField.onChange([...currentValues, option]);
                                                      } else {
                                                        formField.onChange(currentValues.filter(v => v !== option));
                                                      }
                                                    }}
                                          />
                                                  <Label className="text-sm font-normal text-muted-foreground cursor-pointer">
                                                    {option}
                                                  </Label>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      } else {
                                        inputElement = (
                                          <div className="flex items-center space-x-2">
                                            <Checkbox
                                              checked={formField.value as boolean || false}
                                              onCheckedChange={formField.onChange}
                                          />
                                            <Label className="text-sm font-normal text-muted-foreground">
                                              {field.placeholder || `I confirm ${field.label}`}
                                            </Label>
                                          </div>
                                        );
                                      }
                                    } else if (field.type === 'date') {
                                      inputElement = (
                                        <Input
                                          {...formField}
                                          type="date"
                                          className="h-11"
                                          value={formField.value as string || ''}
                                        />
                                      );
                                    } else if (field.type === 'file' || field.type === 'cloudflare_upload') {
                                      // File upload field - stores actual File object for upload on submit
                                      const existingFile = customFieldFiles[field.id];
                                      const hasFile = !!existingFile || !!formField.value;
                                      inputElement = (
                                        <div className="space-y-2">
                                          <label
                                            className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                                              hasFile 
                                                ? 'border-border bg-muted/30 hover:border-foreground/20' 
                                                : 'border-border hover:border-foreground/30'
                                            }`}
                                          >
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                              <Upload className={`h-5 w-5 ${hasFile ? 'text-success' : ''}`} />
                                              <span className="text-sm">
                                                {existingFile ? existingFile.name : (formField.value ? t("fileUploadedClickToReplace", { defaultValue: "File uploaded - Click to replace" }) : (field.placeholder || t("clickToUploadFile", { defaultValue: "Click to upload file" })))}
                                              </span>
                                            </div>
                                            <input
                                              type="file"
                                              className="hidden"
                                              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                                              onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                  if (file.size > 10 * 1024 * 1024) {
                                                    toast({
                                                      title: t("fileTooLarge", { defaultValue: "File Too Large" }),
                                                      description: t("maxFile10mb", { defaultValue: "Maximum file size is 10MB" }),
                                                      variant: "destructive",
                                                    });
                                                    return;
                                                  }
                                                  // Store actual File object in state for upload on form submit
                                                  setCustomFieldFiles(prev => ({
                                                    ...prev,
                                                    [field.id]: file
                                                  }));
                                                  // Store filename in form for validation
                                                  formField.onChange(file.name);
                                                }
                                              }}
                                            />
                                            <span className="text-xs text-muted-foreground mt-1">{t("fileFormatMax10MB_doc", { defaultValue: "PDF, JPG, PNG, DOC (max 10MB)" })}</span>
                                          </label>
                                          {existingFile && (
                                            <p className="text-xs text-success flex items-center gap-1">
                                              <Check className="h-3 w-3" />
                                              {t("readyToUpload", { defaultValue: "Ready to upload:" })} {existingFile.name}
                                            </p>
                                          )}
                                          {!existingFile && formField.value && (
                                            <p className="text-xs text-muted-foreground">{t("previouslyUploaded", { defaultValue: "Previously uploaded" })}</p>
                                          )}
                                        </div>
                                      );
                                    }

                                    // If no input element was created, show unsupported type message
                                    if (!inputElement) {
                                      return (
                                        <FormItem>
                                          <FormLabel className="text-sm font-medium">
                                            {field.label}
                                            {field.required && <span className="text-destructive">*</span>}
                                          </FormLabel>
                                          <FormControl>
                                            <div className="text-sm text-muted-foreground">{t("unsupportedFieldType", { defaultValue: "Unsupported field type:" })} {field.type}</div>
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      );
                                    }

                                    return (
                                      <FormItem>
                                        <FormLabel className="text-sm font-medium">
                                          {field.label}
                                          {field.required && <span className="text-destructive">*</span>}
                                          {!field.required && <span className="text-muted-foreground text-xs ml-2">{t("optional", { defaultValue: "(Optional)" })}</span>}
                                        </FormLabel>
                                        <FormControl>
                                          {inputElement}
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    );
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* Submit Button */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel || (() => window.history.back())}
              className="flex-shrink-0"
            >
              {t("cancelBtn", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="submit"
              data-testid="kitchen-application-submit"
              disabled={isSubmitting}
              className="flex-1 h-12 text-base font-semibold"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  {t("submitting", { defaultValue: "Submitting..." })}
                </>
              ) : (
                <>
                  {t("submitApplicationBtn", { defaultValue: "Submit Application" })}
                  <span className="ml-2">→</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
