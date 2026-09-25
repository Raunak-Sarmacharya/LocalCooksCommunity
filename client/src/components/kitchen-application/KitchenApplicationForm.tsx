import { logger } from "@/lib/logger";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEmailVerificationGuard } from "@/hooks/use-email-verification-guard";
import { useChefKitchenApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Building2, CalendarDays, Check, Clock, FileText, Info, Loader2, MapPin, Send, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type FieldErrors, useForm, useWatch } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { phoneNumberSchema, normalizePhoneNumber, isValidNorthAmericanPhone } from "@shared/phone-validation";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tt } from "@/i18n/common-ns";
import { DateField } from "@/components/ui/date-field";
import { DocumentUploadField } from "./DocumentUploadField";
import {
  ApplicationProgress,
  type ProgressItem,
  type ProgressItemState,
} from "./ApplicationProgress";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoChip } from "@/components/chef/info-chip";
import { VerifiedDocumentChip } from "@/components/common/VerifiedDocumentChip";
import { ChefPageHeader } from "@/components/chef/ui";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { FormLegend } from "@/components/ui/form-legend";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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

/**
 * Yes/No answer built on the shadcn RadioGroup the manager onboarding wizard uses
 * (`RadioGroup` + `RadioGroupItem` inside a `<label>`). Same selection language as
 * the wizard's preferred-contact-method row, so the two flows read as one product.
 */
function YesNoChoice({
  value,
  onChange,
  ariaLabel,
  yesLabel,
  noLabel,
  className,
}: {
  value: "yes" | "no" | "notSure";
  onChange: (value: "yes" | "no") => void;
  ariaLabel: string;
  yesLabel: string;
  noLabel: string;
  className?: string;
}) {
  const optionClass = (selected: boolean) =>
    cn(
      "flex min-w-20 cursor-pointer items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 transition-colors",
      selected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30",
    );
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as "yes" | "no")}
      aria-label={ariaLabel}
      className={cn("flex flex-nowrap gap-2", className)}
    >
      <label htmlFor={`${ariaLabel}-yes`} className={optionClass(value === "yes")}>
        <RadioGroupItem value="yes" id={`${ariaLabel}-yes`} className="shrink-0" />
        <span className="text-sm">{yesLabel}</span>
      </label>
      <label htmlFor={`${ariaLabel}-no`} className={optionClass(value === "no")}>
        <RadioGroupItem value="no" id={`${ariaLabel}-no`} className="shrink-0" />
        <span className="text-sm">{noLabel}</span>
      </label>
    </RadioGroup>
  );
}

/**
 * A date control shaped exactly like the form's other inputs: one line, `h-10`, value on the left
 * and the calendar affordance on the right. The label is rendered by the caller with `FormLabel`,
 * the same as every other field — a stacked label *inside* the control made this one 4px taller
 * than its row neighbours and read unlike anything else on the page.
 */
function KitchenDocumentDatePicker({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selected && !Number.isNaN(selected.getTime())
              ? selected.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
              : placeholder ?? tt("selectDate")}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[320px] rounded-xl p-2">
          <UICalendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (!date) return;
              const y = date.getFullYear();
              const m = String(date.getMonth() + 1).padStart(2, "0");
              const d = String(date.getDate()).padStart(2, "0");
              onChange(`${y}-${m}-${d}`);
              setOpen(false);
            }}
            disabled={(date) => date < today}
            className="w-full bg-transparent p-1"
            classNames={{
              months: "flex flex-col space-y-0 w-full",
              month: "space-y-2 w-full",
              table: "w-full border-collapse table-fixed",
              head_cell: "text-muted-foreground font-normal text-xs text-center pb-0.5 w-[14.28%]",
              row: "mt-0.5",
              day: "h-8 w-8 max-w-[32px] mx-auto p-0 font-normal text-xs rounded-full hover:bg-muted transition-colors flex items-center justify-center",
              cell: cn(
                "relative z-0 h-8 p-0 text-center text-xs",
                "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:border-2 [&:has([aria-selected])]:before:border-[#F51042]"
              ),
            }}
          />
      </PopoverContent>
    </Popover>
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
import { REQUEST_TO_APPLY_BUSINESS_TYPES, REQUEST_TO_APPLY_FREQUENCIES } from "./request-to-apply-fields";

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

/**
 * The form's DOM id. The Cancel/Submit pair lives on the sticky rail, which is a SIBLING of the
 * form rather than a child of it, so the submit button drives it through `form={FORM_ID}` instead
 * of nesting. That is what lets the actions stay pinned while the fields scroll.
 */
const FORM_ID = "kitchen-application-form";

/**
 * Whether a requirement-driven field is REQUIRED by this kitchen.
 *
 * `defaultRequired` MUST be that flag's own server default from
 * `getLocationRequirementsWithDefaults()` (`server/domains/locations/location.service.ts`), and
 * passing it is not optional. The payload normally sends real booleans, but when a key is absent
 * this has to fall back to the same default the validator uses rather than guessing.
 *
 * Guessing LOW is the dangerous direction. `requireBusinessName` and `requireBusinessType` both
 * default to TRUE, and both were previously labelled a hardcoded "(Optional)" — so the UI invited
 * the chef to skip a field the server then rejected at submit. A bare `!flag` has the same failure
 * mode whenever a key is missing, which is why every call site states its default explicitly.
 */
function isRequiredField(flag: boolean | undefined, defaultRequired: boolean): boolean {
  return typeof flag === "boolean" ? flag : defaultRequired;
}

/**
 * The required/optional marker on a requirement-driven field label.
 *
 * A destructive asterisk when the kitchen requires the field; a quiet "(Optional)" when it does not.
 * ONE component instead of a pair of hand-written conditions at every label, because that is exactly
 * how the two halves drifted apart: several fields grew an "(Optional)" tag with no matching
 * asterisk, and `requireBusinessName` / `requireBusinessType` were labelled "(Optional)" outright
 * while the server treated them as mandatory.
 *
 * `defaultRequired` is the flag's server default - see `isRequiredField` above.
 */
function RequirementMarker({
  flag,
  defaultRequired,
}: {
  flag: boolean | undefined;
  defaultRequired: boolean;
}) {
  const { t } = useTranslation("kitchen");
  if (isRequiredField(flag, defaultRequired)) {
    return <span className="text-destructive">*</span>;
  }
  return (
    <span className="ml-2 text-xs text-muted-foreground">
      {t("optional", { defaultValue: "(Optional)" })}
    </span>
  );
}

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
  // A refusal at submit time would waste a long, multi-step form. The guard blocks
  // the submission; `blocked` drives an early notice so the chef knows up front.
  const { blocked: emailUnverified, guard, gate } = useEmailVerificationGuard();
  const { createApplication, refetch } = useChefKitchenApplications();
  const { application, hasApplication, refetch: refetchLocationApp } = useChefKitchenApplicationForLocation(location.id);
  const { data: chefProfile, isLoading: isLoadingChefProfile } = useQuery<{ phone?: string | null }>({
    queryKey: ["/api/chef/my-profile"],
    queryFn: async () => {
      const { auth } = await import("@/lib/firebase");
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/chef/my-profile", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Failed to load chef profile");
      return response.json();
    },
  });

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
  const [foodSafetyAnswer, setFoodSafetyAnswer] = useState<"yes" | "no" | "notSure">(application?.foodSafetyLicense || "notSure");
  const [businessLicenseFile, setBusinessLicenseFile] = useState<File | null>(null);
  const [existingFoodHandlerUrl, setExistingFoodHandlerUrl] = useState<string | null>(application?.foodSafetyLicenseUrl || null);
  useEffect(() => {
    setExistingFoodHandlerUrl(application?.foodSafetyLicenseUrl || null);
    setFoodSafetyAnswer(application?.foodSafetyLicense || "notSure");
  }, [application?.foodSafetyLicenseUrl, application?.foodSafetyLicense]);
  const [existingBusinessLicenseUrl, setExistingBusinessLicenseUrl] = useState<string | null>(application?.foodEstablishmentCertUrl || null);
  useEffect(() => {
    setExistingBusinessLicenseUrl(application?.foodEstablishmentCertUrl || null);
  }, [application?.foodEstablishmentCertUrl]);
  // Tier 2 file uploads
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [fileErrors, setFileErrors] = useState<{
    businessLicense?: string;
    insurance?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  
  // Custom field file uploads - map of field ID to File object
  const [customFieldFiles, setCustomFieldFiles] = useState<Record<string, File>>({});



  // Split user's display name into first and last
  const nameParts = user?.displayName?.split(' ') || ['', ''];
  const defaultFirstName = nameParts[0] || '';
  const defaultLastName = nameParts.slice(1).join(' ') || '';

  /*
   * Whether a phone number is already on file, which decides if the field blocks submission.
   *
   * ⚠️ Declared HERE, above the schema memo, and that placement is load-bearing. A `useMemo`
   * FACTORY RUNS DURING THE RENDER BODY — it is not deferred — so reading a binding declared
   * further down this component body from inside the factory is a temporal-dead-zone crash
   * ("Cannot access 'X' before initialization"). The schema memo below reads this at two sites,
   * and the progress checklist needs the same answer, so there is exactly one definition here.
   */
  const hasPhoneOnFile = Boolean(
    chefProfile?.phone || application?.phone || globalApp?.phone
  );

  // Dynamic schema generation based on requirements
  const dynamicSchema = useMemo(() => {
    if (!requirements) return baseKitchenApplicationSchema;

    // For Tier 2+, make all Tier 1 fields optional since they're already submitted
    const isTier2OrHigher = currentTier >= 2 || !!globalApp;
    // Keep Step 2 compatible with older requests that predate phone collection.
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
        phone: hasPhoneOnFile ? optionalPhone : requiredPhone,
        businessName: optionalText,
        businessType: optionalText,
        experience: optionalText,
        businessDescription: z.string().optional(),
        foodHandlerCertExpiry: z.string().optional(),
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
      phone: hasPhoneOnFile ? optionalPhone : requiredPhone,
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
  }, [requirements, currentTier, t, application?.phone, globalApp, chefProfile?.phone]);

  const needsPhoneInForm =
    !isLoadingChefProfile &&
    !chefProfile?.phone &&
    !application?.phone &&
    !globalApp?.phone;
  const getDefaultValues = useMemo(() => {
    // Start with default values from user data
    const defaults: any = {
      firstName: defaultFirstName,
      lastName: defaultLastName,
      email: user?.email || "",
      phone: chefProfile?.phone || "",
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
      defaults.phone = chefProfile?.phone || application.phone || '';

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
  }, [requirements, defaultFirstName, defaultLastName, user?.email, application, currentTier, globalApp, chefProfile?.phone]);

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

  // Anchors + refs the progress list needs to jump to a field.
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  //
  // The two Section-5 agreements are not `useWatch`ed (they are declared below the checklist, so
  // reading them there would be a read-before-declare), so their live value is mirrored here.
  // Writing a ref during render is safe and is what makes the progress row update on the same
  // render as the tick, rather than one behind.
  const termsAgreeRef = useRef<boolean | null>(null);
  const accuracyAgreeRef = useRef<boolean | null>(null);
  const registerSection = useCallback((id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  }, []);

  const goToSection = useCallback((id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /**
   * The checklist behind the one progress bar, split into what BLOCKS submission and what does not.
   *
   * Every entry is driven off the location's own requirements payload rather than a hardcoded list,
   * because which fields are mandatory is a per-kitchen decision made by admins and managers. A
   * field the kitchen did not ask for must never sit in the required group, or the bar would refuse
   * to read "ready" on a form that submits perfectly well.
   *
   * `requireFoo !== false` (not `=== true`) for the flags whose default is required: the payload
   * always sends real booleans, but a missing key must fail OPEN (treated as required) rather than
   * silently marking a mandatory field optional.
   *
   * The `requestToApply` row is intentionally NOT part of `requiredItems` — it is the submit action
   * itself, so counting it would mean the bar could never reach 100% before you submit, which is
   * exactly the "am I allowed to submit?" question this card exists to answer. It is attached to
   * the optional group as a status row and flipped to `waiting` once the application exists.
   *
   * A plain function rather than a `useMemo`: `watchedValues` from `useWatch` is a fresh object on
   * every render, so a memo here could never hit its cache and would only add indirection. The cost
   * of recomputing is a handful of array pushes.
   */
  const buildProgress = () => {
    const has = (key: keyof KitchenApplicationFormData) => {
      const value = watchedValues[key];
      if (typeof value === "boolean") return value;
      return Boolean(value && String(value).trim());
    };

    // ---- Tier 2: what the KITCHEN asks for before you may book. ----
    if (currentTier >= 2) {
      const required: ProgressItem[] = [];
      const optional: ProgressItem[] = [];

      if (requirements?.tier2_food_establishment_cert_required) {
        required.push({
          id: "foodEstablishment",
          label: t("foodEstablishmentLicenseLabel", { defaultValue: "Food Establishment License/Permit" }),
          state: businessLicenseFile || existingBusinessLicenseUrl ? "done" : "todo",
        });
      }

      if (requirements?.tier2_food_establishment_expiry_required) {
        required.push({
          id: "foodEstablishmentExpiry",
          label: t("foodEstablishmentExpiryLabel", { defaultValue: "Food Establishment License Expiry Date" }),
          state: has("foodEstablishmentCertExpiry") ? "done" : "todo",
        });
      }

      if (requirements?.tier2_insurance_document_required) {
        required.push({
          id: "insurance",
          label: t("insuranceDocument", { defaultValue: "Insurance Document" }),
          state: insuranceFile ? "done" : "todo",
        });
      }

      if (requirements?.tier2_kitchen_experience_required) {
        required.push({
          id: "kitchenExperience",
          label: t("kitchenExpDescLabel", { defaultValue: "Kitchen Experience Description" }),
          state: has("kitchenExperienceDescription") ? "done" : "todo",
        });
      }
      /*
       * Food safety certificate.
       *
       * Added because this field is BOTH rendered in tier 2 AND enforced by the submit handler
       * (`requireFoodHandlerCert` blocks unless the answer is "yes" and a certificate is attached),
       * yet the rail had no row for it - so the bar could read 100% "ready" on a form that the
       * submit handler then rejected. A "ready" bar that lies is worse than no bar.
       *
       * The state mirrors those same gates: answer "yes", a certificate on file (fresh upload or
       * existing), and, once one is attached, an expiry that is filled in and not in the past.
       */
      const certAttached = Boolean(foodHandlerFile || existingFoodHandlerUrl);
      const certExpiryRaw = String(watchedValues.foodHandlerCertExpiry ?? "").trim();
      const certDayStart = new Date();
      certDayStart.setHours(0, 0, 0, 0);
      const certExpiryOk =
        !certAttached || (certExpiryRaw !== "" && new Date(certExpiryRaw) >= certDayStart);
      const certOk =
        (!requirements?.requireFoodHandlerCert || (foodSafetyAnswer === "yes" && certAttached)) &&
        certExpiryOk;
      if (requirements?.requireFoodHandlerCert || certAttached) {
        required.push({
          id: "foodSafetyCert",
          label: t("foodSafetyCertificate", { defaultValue: "Food safety certificate" }),
          state: certOk ? "done" : "todo",
        });
      }

      (Array.isArray(requirements?.tier2_custom_fields) ? requirements.tier2_custom_fields : []).forEach(
        (field: CustomField) => {
          if (!field?.id || !field.type) return;
          const value = watchedValues[`custom_${field.id}` as keyof KitchenApplicationFormData];
          const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
          const item: ProgressItem = {
            id: `custom_${field.id}`,
            label: field.label,
            state: filled ? "done" : "todo",
          };
          // A required custom field is required; an optional one must not be counted.
          (field.required ? required : optional).push(item);
        },
      );

      return {
        requiredItems: required,
        optionalItems: optional,
        requestRow: {
          id: "tier1",
          label: t("progressRequestToApply", { defaultValue: "Request to apply" }),
          hint: application?.tier2_completed_at
            ? t("progressApproved", { defaultValue: "Approved" })
            : t("progressUnderReview", { defaultValue: "With LocalCooks for review" }),
          state: "waiting" as ProgressItemState,
        } as ProgressItem,
        canSubmit: required.every((item) => item.state !== "todo"),
      };
    }

    // ---- Tier 1: the request to apply. ----
    const required: ProgressItem[] = [];
    const optional: ProgressItem[] = [];
    const push = (list: ProgressItem[], item: ProgressItem) => list.push(item);

    const r = requirements;
    // Reads a requirements flag, failing OPEN (treated as required) when the key is absent.
    const ask = (flag: boolean | undefined, fallback: boolean): boolean =>
      typeof flag === "boolean" ? flag : fallback;

    // About You — name/email are per-kitchen flags; phone is always required unless already on file.
    const needsPhone = !hasPhoneOnFile;
    const aboutYouDone =
      (!ask(r?.requireFirstName, true) || has("firstName")) &&
      (!ask(r?.requireLastName, true) || has("lastName")) &&
      (!ask(r?.requireEmail, true) || has("email")) &&
      (!needsPhone || has("phone"));
    push(required, {
      id: "aboutYou",
      label: t("aboutYou", { defaultValue: "About You" }),
      state: aboutYouDone ? "done" : "todo",
      onNavigate: () => goToSection("aboutYou"),
    });

    // Your Food Business — business name/type/description/experience are all flag-driven.
    const businessFlags: Array<{ flag: boolean; key: keyof KitchenApplicationFormData }> = [
      { flag: ask(r?.requireBusinessName, false), key: "businessName" },
      { flag: ask(r?.requireBusinessType, false), key: "businessType" },
      { flag: ask(r?.requireBusinessDescription, false), key: "businessDescription" },
      { flag: ask(r?.tier1_years_experience_required, false), key: "experience" },
    ];
    const askedBusiness = businessFlags.filter((f) => f.flag);
    const optionalBusiness = businessFlags.filter((f) => !f.flag);
    if (askedBusiness.length > 0) {
      push(required, {
        id: "foodBusiness",
        label: t("yourFoodBusiness", { defaultValue: "Your Food Business" }),
        state: askedBusiness.every((f) => has(f.key)) ? "done" : "todo",
        onNavigate: () => goToSection("foodBusiness"),
      });
    }
    optionalBusiness.forEach((f) => {
      /*
       * The SAME i18n keys the form labels itself use, so a rail row and the field it points at
       * cannot drift apart. `businessDescLabel` was a rail-only key: that is exactly how the rail
       * came to read "Business Description" while the form read "Tell Us About Your Business".
       */
      const labelKey: Record<string, string> = {
        businessName: "businessName",
        businessType: "typeOfFoodBusiness",
        businessDescription: "tellUsAboutBusiness",
        experience: "yearsOfExperience",
      };
      push(optional, {
        id: `opt_${f.key}`,
        label: t(labelKey[f.key] ?? String(f.key), { defaultValue: String(f.key) }),
        state: has(f.key) ? "done" : "todo",
        onNavigate: () => goToSection("foodBusiness"),
      });
    });

    /*
     * Food safety.
     *
     * The two conditions here mirror the ACTUAL submit gates in the submit handler, nothing more,
     * nothing less:
     *   1. the yes/no answer must not be "notSure";
     *   2. if a certificate was attached, it must carry an expiry date.
     *
     * Deliberately NOT requireFoodHandlerCert: at this stage the certificate upload is optional
     * regardless of that flag, and the real validator never blocks on a missing upload (document
     * collection happens later, with the kitchen). Requiring it here would peg the bar below 100%
     * on a form that submits perfectly well - the exact failure this card exists to prevent.
     */
    const hasFoodSafetyAnswer = foodSafetyAnswer !== "notSure";
    const attachedCert = Boolean(foodHandlerFile || existingFoodHandlerUrl);
    const certExpiryOk = !attachedCert || Boolean(has("foodHandlerCertExpiry"));
    push(required, {
      id: "foodSafety",
      label: t("foodSafetyCertifications", { defaultValue: "Food Safety & Certifications" }),
      hint: hasFoodSafetyAnswer
        ? undefined
        : t("progressNeedAnswer", { defaultValue: "Answer the certificate question" }),
      state: hasFoodSafetyAnswer && certExpiryOk ? "done" : "todo",
      onNavigate: () => goToSection("foodSafety"),
    });

    // Kitchen Usage — both flags default to required but are individually switchable.
    const asksUsage = r?.requireUsageFrequency !== false;
    const asksSession = r?.requireSessionDuration !== false;
    if (asksUsage || asksSession) {
      const usageDone =
        (!asksUsage || has("usageFrequency")) && (!asksSession || has("sessionDuration"));
      const entry: ProgressItem = {
        id: "kitchenUsage",
        label: t("kitchenUsage", { defaultValue: "Kitchen Usage" }),
        state: usageDone ? "done" : "todo",
        onNavigate: () => goToSection("kitchenUsage"),
      };
      if (asksUsage && asksSession) {
        push(required, entry);
      } else {
        push(optional, { ...entry, label: t("kitchenUsage", { defaultValue: "Kitchen Usage" }) });
      }
    }

    // Tier-1 custom fields, split by each field's own `required` bit.
    const tier1CustomFields = Array.isArray(r?.tier1_custom_fields) ? r.tier1_custom_fields : [];
    tier1CustomFields.forEach((field: CustomField) => {
      if (!field?.id || !field.type) return;
      const value = watchedValues[`custom_${field.id}` as keyof KitchenApplicationFormData];
      const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
      const item: ProgressItem = {
        id: `custom_${field.id}`,
        label: field.label,
        state: filled ? "done" : "todo",
      };
      (field.required ? required : optional).push(item);
    });

    // Agreements — always required for a valid submission, so never optional.
    push(required, {
      id: "terms",
      label: t("termsAndAgreements", { defaultValue: "Terms & Agreements" }),
      // Read BEFORE the render-time `Ref` assignment, so this is current on every keystroke.
      state: termsAgreeRef.current === true && accuracyAgreeRef.current === true ? "done" : "todo",
      onNavigate: () => goToSection("terms"),
    });

    return {
      requiredItems: required,
      optionalItems: optional,
      requestRow: {
        id: "requestToApply",
        label: t("requestToApply", { defaultValue: "Request to apply" }),
        hint: hasApplication
          ? t("progressUnderReview", { defaultValue: "With LocalCooks for review" })
          : t("progressNotSubmitted", { defaultValue: "Sent when you submit this form" }),
        state: hasApplication ? ("waiting" as ProgressItemState) : ("todo" as ProgressItemState),
      } as ProgressItem,
      canSubmit: required.every((item) => item.state !== "todo"),
    };
  };

  const { requiredItems, optionalItems, requestRow, canSubmit } = buildProgress();

  const requiredRemaining = requiredItems.filter((item) => item.state === "todo");

  const phaseTitle = currentTier >= 2
    ? t("step2Coordinate", { defaultValue: "Kitchen documents" })
    : t("requestToApply", { defaultValue: "Request to apply" });

  /**
   * The lines under the bar.
   *
   * Always an array so each idea gets its own row instead of being run together into one paragraph,
   * and always derived — the first line names what is actually outstanding rather than assuming the
   * form is empty.
   */
  const phaseCaptions = (() => {
    if (currentTier >= 2) {
      return application?.tier2_completed_at
        ? [t("progressDocsSubmitted", { defaultValue: "Submitted and awaiting the kitchen’s review." })]
        : [
            t("progressDocsCaption", { defaultValue: "Documents this kitchen asks for before you can book." }),
            t("progressDocsReviewLine", { defaultValue: "Your kitchen reviews these before you can book time." }),
          ];
    }
    if (hasApplication) {
      return [
        t("progressWaitingCaption", { defaultValue: "Your request is with LocalCooks. Nothing else is needed from you." }),
        t("progressReviewWindow", { defaultValue: "Your request to apply gets reviewed within 24 hours." }),
      ];
    }
    if (requiredRemaining.length === 0) {
      return [
        t("progressAllSetCaption", { defaultValue: "Everything required is filled in. You can send your request to apply." }),
        t("progressReviewWindow", { defaultValue: "Your request to apply gets reviewed within 24 hours." }),
      ];
    }
    /*
     * Name what is actually outstanding instead of telling the chef to look "above".
     *
     * On a form this long the missing item is usually several screens away, so a generic "fill these
     * in" is an instruction with no destination. The list directly below already marks each item, so
     * this line just has to say which ones they are.
     */
    return [
      t("appProgressStillNeeded", {
        defaultValue: "Still needed: {items}",
        items: requiredRemaining.map((item) => item.label).join(", "),
      }),
      t("progressReviewWindow", { defaultValue: "Your request to apply gets reviewed within 24 hours." }),
    ];
  })();

  /**
   * Cancel + Submit, rendered onto the sticky bar rather than at the bottom of the form.
   *
   * `form={FORM_ID}` is doing real work: this markup is a sibling of the `<form>`, not inside it, so
   * the submit button has to be told which form to submit. Without it the button would be inert —
   * and because the bar is sticky, the actions are reachable from anywhere in a very long form.
   *
   * Submit is disabled until every REQUIRED item is done, which is the same predicate that drives
   * the bar to 100% — one source of truth, so the button can never disagree with the bar.
   */
  const applicationActions = (
    <div className="flex w-full items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => setDiscardOpen(true)}
        size="sm"
        className="shrink-0"
      >
        {currentTier >= 2
          ? t("backBtn", { defaultValue: "Back" })
          : t("cancelBtn", { defaultValue: "Cancel" })}
      </Button>
      <Button
        type="submit"
        form={FORM_ID}
        data-testid="kitchen-application-submit"
        disabled={isSubmitting || !canSubmit}
        size="sm"
        className="flex-1"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t("submitting", { defaultValue: "Submitting..." })}
          </>
        ) : (
          <>
            {currentTier >= 2
              ? t("submitDocuments", { defaultValue: "Submit documents" })
              : t("submitApplicationBtn", { defaultValue: "Submit application" })}
            <span className="ml-2">→</span>
          </>
        )}
      </Button>
    </div>
  );

  /*
   * The props both tracker instances share, so the wide and the rail copy can never drift apart.
   * Declared last on purpose: it depends on `phaseTitle`, `phaseCaptions` and `applicationActions`,
   * all of which are declared above. Reading any of them earlier would be a temporal-dead-zone
   * crash, which is the same failure this whole block was restructured to fix.
   *
   * `canSubmit` also gates the submit button inside `applicationActions`, and both come from the
   * one `buildProgress()` result that drives the bar to 100%, so the bar and button can never
   * disagree.
   */
  const trackerProps = {
    title: phaseTitle,
    items: requiredItems,
    optionalItems: optionalItems,
    statusItem: requestRow,
    captions: phaseCaptions,
    footer:
      currentTier >= 2 && application?.tier2_completed_at
        ? t("progressAlreadyDone", { defaultValue: "Already sent and approved — resubmitting only updates the documents above." })
        : undefined,
    actions: applicationActions,
  };

  /*
   * Whether the registration hand-off already supplied a whole section.
   *
   * Sections 1 and 2 are hidden when a global application exists, because re-asking for data the chef
   * already gave at registration is noise. But "already asked" is not "already answered": the hand-off
   * carries name/email/phone ONLY, so a chef with a global application and no business data was shown
   * a rail naming "Your Food Business" as needed with NO input on the page able to satisfy it - a
   * checklist item that could never be cleared. The gate is therefore "was it collected AND is it
   * complete", so a section only hides when there is genuinely nothing left to fill in.
   */
  const collected = (keys: Array<keyof KitchenApplicationFormData>) =>
    keys.every((key) => {
      const value = (getDefaultValues as Record<string, unknown>)[key as string];
      return typeof value === "boolean" ? value : Boolean(value && String(value).trim());
    });

  const showAboutYou = !globalApp || !collected(["firstName", "lastName", "email", "phone"]);
  const showFoodBusiness =
    !globalApp || !collected(["businessName", "businessType", "experience", "businessDescription"]);


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

    if (currentTier === 1 && foodSafetyAnswer === "notSure") {
      toast({ title: t("answerFoodSafety", { defaultValue: "Please answer yes or no about food safety certification" }), variant: "destructive" });
      return;
    }
    if (foodHandlerFile && !data.foodHandlerCertExpiry) {
      form.setError("foodHandlerCertExpiry", { message: t("valFoodSafetyExpiryReq", { defaultValue: "Certificate expiry date is required with an upload" }) });
      return;
    }

    // Validate file uploads and expiry dates ONLY for Tier 2 (manager approval step).
    // In Tier 1 (auto-submitted from registration), the user cannot upload files
    // from the registration modal, so we must not block submission on missing
    // document uploads. These are collected later in Tier 2.
    if (currentTier >= 2) {
      if (requirements?.requireFoodHandlerCert && (foodSafetyAnswer !== "yes" || (!foodHandlerFile && !existingFoodHandlerUrl))) {
        toast({
          title: t("missingDoc", { defaultValue: "Missing Document" }),
          description: t("uploadFoodSafetyLicense", { defaultValue: "Please upload your Food Safety License" }),
          variant: "destructive",
        });
        return;
      }

      if (foodSafetyAnswer === 'yes' && (foodHandlerFile || existingFoodHandlerUrl) && !data.foodHandlerCertExpiry?.trim()) {
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

      const expiryDate = new Date(data.foodHandlerCertExpiry || "");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (foodSafetyAnswer === 'yes' && (foodHandlerFile || existingFoodHandlerUrl) && expiryDate < today) {
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
      formData.append("phone", chefProfile?.phone || data.phone || application?.phone || "");
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
      formData.append("foodSafetyLicense", foodSafetyAnswer === "notSure" ? "no" : foodSafetyAnswer);
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
      setFoodSafetyAnswer("yes");
      form.setValue('foodHandlerCertExpiry', '');
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
      <div className="mx-auto max-w-xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border bg-card px-6 py-12 text-center shadow-sm"
        >
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-8 ring-primary/5">
            <Check className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight">{t("applicationSubmitted", { defaultValue: "Application submitted" })}</h2>
          <p className="mx-auto mb-8 max-w-md text-muted-foreground">
            {t("applicationSubmittedDesc", { defaultValue: "Thank you! We\'ve received your kitchen application and will review it within 24 hours. Check your email for updates." })}
          </p>

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
  if (isLoadingRequirements || isLoadingChefProfile) {
    return (
      <div className="max-w-[700px] mx-auto py-12 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative space-y-6 pb-12">
      {/* Early notice so an unverified chef does not fill a long, multi-step form
          only to be refused at submit. Non-blocking: the form stays usable. */}
      {emailUnverified && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-foreground">
              {t("applyEmailUnverifiedTitle", {
                defaultValue: "Verify your email before submitting",
              })}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("applyEmailUnverifiedBody", {
                defaultValue:
                  "You can fill this in now, but the application cannot be submitted until your email address is confirmed.",
              })}
            </p>
          </div>
        </div>
      )}

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
        title={currentTier >= 2
          ? t("kitchenDocuments", { defaultValue: "Kitchen documents" })
          : t("requestToApply", { defaultValue: "Request to apply" })}
        description={currentTier >= 2
          ? t("kitchenDocumentsFor", { defaultValue: "Documents required by {name}", name: location.name })
          : t("requestToApplyAt", {
          defaultValue: "Request to apply at {name}",
          name: location.name,
        })}
        className="mb-0"
      />

      <FormLegend />

      {/*
       * Below `lg` there is no rail, and a form this long cannot lose its progress readout
       * entirely — a tablet is where the chef is most likely to need it.
       *
       * Two instances rather than one reflowed element: the rail has to be a grid SIBLING of
       * the task to sit beside it, and a sibling cannot also be a block thrown ABOVE it.
       *
       * In normal flow, not sticky: this slot is full-width, so making it stick would need the
       * opaque full-bleed chrome that smeared in the rail. It scrolls away with the page.
       */}
      <div className="lg:hidden">
        <ApplicationProgress {...trackerProps} />
      </div>

      {/* Two columns on lg+: the task on the left, progress and context on the right. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">

      {/* MAIN COLUMN — the task itself. The rail never holds a field. */}
      <div className="min-w-0">

      <Form {...form}>
        <form
          id={FORM_ID}
          onSubmit={form.handleSubmit(async (data) => {
            await guard(() => onSubmit(data));
          }, handleInvalidSubmit)}
          className="space-y-6"
        >
          {/* TIER 1 SECTIONS - Only show when on Tier 1 */}
          {currentTier === 1 && (
            <>
              {/* SECTION 1: About You - Hide if global app has collected this */}
              {showAboutYou && (
                <Card className="shadow-none" ref={registerSection("aboutYou")}>
                  <CardContent className="p-6">
                    <div className="mb-4 border-b pb-3">
                      <h3 className="font-semibold">{t("aboutYou", { defaultValue: "About You" })}</h3>
                    </div>

                    {/* Names are short, so they share a row; the email is long and gets its own. */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">
                              {t("firstName", { defaultValue: "First Name" })}{" "}
                              <RequirementMarker flag={requirements?.requireFirstName} defaultRequired={true} />
                            </FormLabel>
                            <FormControl>
                              <Input {...field} className="h-10" />
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
                              {t("lastName", { defaultValue: "Last Name" })}{" "}
                              <RequirementMarker flag={requirements?.requireLastName} defaultRequired={true} />
                            </FormLabel>
                            <FormControl>
                              <Input {...field} className="h-10" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-medium">
                              {t("emailAddress", { defaultValue: "Email Address" })}{" "}
                              <RequirementMarker flag={requirements?.requireEmail} defaultRequired={true} />
                            </FormLabel>
                            <FormControl>
                              <Input type="email" {...field} className="h-10" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {needsPhoneInForm && (
                      <div className="mt-4 grid gap-4">
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-medium">
                                {t("phoneNumber", { defaultValue: "Phone number" })}{" "}
                                {/*
                                  A plain asterisk, deliberately NOT `<RequirementMarker flag={requirements?.requirePhone} />`.
                                  The Tier-1 schema requires phone whenever none is on file
                                  (`hasPhoneOnFile ? optionalPhone : requiredPhone`) and ignores `requirePhone` entirely,
                                  so a requirement-driven tag would print "(Optional)" on a field that still blocks
                                  submit. This input only renders when a number is genuinely missing, and in that state
                                  it is always mandatory.
                                */}
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <p className="text-xs leading-5 text-muted-foreground">
                                {t("phoneMissingFromProfile", { defaultValue: "Add a phone number so the kitchen can contact you about your application." })}
                              </p>
                              <FormControl>
                                <Input
                                  type="tel"
                                  inputMode="tel"
                                  autoComplete="tel"
                                  placeholder="(709) 000-0000"
                                  {...field}
                                  value={field.value || ""}
                                  className="h-10 sm:max-w-xs"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* SECTION 2: Your Food Business */}
              {showFoodBusiness && (
                <Card className="shadow-none mb-6" ref={registerSection("foodBusiness")}>
                  <CardContent className="p-6">
                    <div className="mb-4 border-b pb-3">
                      <h3 className="font-semibold">{t("yourFoodBusiness", { defaultValue: "Your Food Business" })}</h3>
                    </div>

                    {/* Two columns: the two selects pair up, the free-text fields span both. */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="businessName"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-medium">
                              {t("businessName", { defaultValue: "Business Name" })}{" "}{" "}
                              <RequirementMarker flag={requirements?.requireBusinessName} defaultRequired={true} />
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t("businessNamePlaceholder", { defaultValue: "e.g., Sarah\'s Catering, Artisan Bakery Co." })}
                                {...field}
                                className="h-10"
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
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
                              {t("typeOfFoodBusiness", { defaultValue: "Business Type" })}{" "}{" "}
                              <RequirementMarker flag={requirements?.requireBusinessType} defaultRequired={true} />
                            </FormLabel>
                            <FormControl>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-10">
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
                              {t("yearsOfExperience", { defaultValue: "Years of Experience" })}{" "}
                              <RequirementMarker flag={requirements?.tier1_years_experience_required} defaultRequired={false} />
                            </FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-10">
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

                      {/*
                       * Always rendered; `RequirementMarker` says whether the kitchen requires it.
                       *
                       * It used to be gated on `requireBusinessDescription !== false`, which hid it precisely when the
                       * admin marked it OPTIONAL - while the rail listed it in the optional group anyway. The chef was
                       * shown a field they could never fill. "Optional" must mean "you may fill this in", not "hidden".
                      */}
                      <FormField
                        control={form.control}
                        name="businessDescription"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-medium">
                              {t("tellUsAboutBusiness", { defaultValue: "Business Description" })}{" "}
                              <RequirementMarker flag={requirements?.requireBusinessDescription} defaultRequired={false} />
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t("businessDescPlaceholder", { defaultValue: "Brief description of what you prepare, your target market, etc." })}
                                className="min-h-[72px] resize-none"
                                {...field}
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                              {requirements?.requireBusinessDescription
                                ? t("businessDescHelpRequired", { defaultValue: "Please provide a brief description of your food business" })
                                : t("businessDescHelpOptional", { defaultValue: "Optional, but helps us connect you with suitable kitchen times" })}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Optional certificate at the initial request; a selected file needs its expiry. */}
              {currentTier === 1 && (
                <Card className="shadow-none mb-6" ref={registerSection("foodSafety")}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b">
                      <h3 className="font-semibold">{t("foodSafetyCertifications", { defaultValue: "Food Safety & Certifications" })}</h3>
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                        {t("optionalAtStep1", { defaultValue: "Upload is optional here" })}
                      </span>
                    </div>

                    {/* Question and answer share one line — the pills never need their own row. */}
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                      <div className="min-w-0">
                        <Label className="block text-sm font-medium">
                          {t("haveFoodSafetyLicense", { defaultValue: "Do you have a food safety certificate?" })}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {t("foodSafetyLicenseHelp", { defaultValue: "A valid certificate helps kitchens approve you faster." })}
                        </p>
                      </div>
                      <YesNoChoice
                        className="shrink-0"
                        ariaLabel="initial-food-safety-answer"
                        value={foodSafetyAnswer}
                        onChange={(answer) => {
                          setFoodSafetyAnswer(answer);
                          if (answer !== "yes") {
                            setFoodHandlerFile(null);
                            form.setValue("foodHandlerCertExpiry", "");
                          }
                        }}
                        yesLabel={t("optionYes", { defaultValue: "Yes" })}
                        noLabel={t("optionNo", { defaultValue: "No" })}
                      />
                    </div>

                    {foodSafetyAnswer === "yes" && (
                      <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <p className="text-sm font-medium">
                            {t("foodSafetyCertificate", { defaultValue: "Food safety certificate" })}{" "}
                            <span className="text-xs font-normal text-muted-foreground">{t("optional", { defaultValue: "(Optional)" })}</span>
                          </p>
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            {t("optionalCertificateUpload", { defaultValue: "Add it now, or provide it when a kitchen requires it." })}
                          </p>
                        </div>

                        <DocumentUploadField
                          id="initial-food-safety-upload"
                          accept=".pdf,.jpg,.jpeg,.png"
                          file={foodHandlerFile}
                          label={t("chooseFile", { defaultValue: "Choose file" })}
                          hint={t("certificateFileHint", { defaultValue: "PDF, JPG or PNG \u00b7 up to 5 MB" })}
                          chooseLabel={t("chooseFile", { defaultValue: "Choose file" })}
                          changeLabel={t("changeFile", { defaultValue: "Change" })}
                          onChange={handleFoodHandlerFileChange}
                          onRemove={() => setFoodHandlerFile(null)}
                          removeLabel={t("removeFile", { defaultValue: "Remove file" })}
                        />
                        {foodHandlerFile && <FormField control={form.control} name="foodHandlerCertExpiry" render={({ field }) => <FormItem><FormLabel className="text-sm font-medium">{t("foodSafetyLicenseExpiryLabel", { defaultValue: "Certificate expiry date" })}{" "}{/* Required whenever it is shown: attaching a certificate without an expiry is rejected. */}<span className="text-destructive">*</span></FormLabel><FormControl><KitchenDocumentDatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>} />}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* SECTION 4: Kitchen Usage */}
              <Card className="shadow-none" ref={registerSection("kitchenUsage")}>
                <CardContent className="p-6">
                  <div className="mb-4 border-b pb-3">
                    <h3 className="font-semibold">{t("kitchenUsage", { defaultValue: "Kitchen Usage" })}</h3>
                  </div>

                  {/* Two short selects pair up on one row each. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="usageFrequency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">
                            {t("howOftenNeedKitchen", { defaultValue: "How Often Do You Need Kitchen Space?" })}{" "}
                            <RequirementMarker flag={requirements?.requireUsageFrequency} defaultRequired={true} />
                          </FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="h-10">
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
                            {t("typicalSessionLength", { defaultValue: "Typical Session Length" })}{" "}
                            <RequirementMarker flag={requirements?.requireSessionDuration} defaultRequired={true} />
                          </FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger className="h-10">
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
                      <div className="flex items-center justify-between mb-4 pb-3 border-b">
                        <h3 className="font-semibold">{t("additionalInfo", { defaultValue: "Additional Information" })}</h3>
                      </div>

                      {/* Two columns: short inputs pair up; textareas and uploads take the full width. */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {orderedFields.map((field: CustomField) => {
                          if (!field || !field.id || !field.type) return null;

                          const fieldName = `custom_${field.id}` as keyof KitchenApplicationFormData;
                          // A control that wants real width gets it; everything short shares a row.
                          const spansFullWidth = ["textarea", "file", "cloudflare_upload"].includes(field.type)
                            || (field.type === "checkbox" && Array.isArray(field.options) && field.options.length > 2);
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
                                      className="h-10"
                                      value={formField.value as string || ''}
                                    />
                                  );
                                } else if (field.type === 'textarea') {
                                  inputElement = (
                                    <Textarea
                                      {...formField}
                                      placeholder={field.placeholder}
                                      className="min-h-[72px] resize-none"
                                      value={formField.value as string || ''}
                                    />
                                  );
                                } else if (field.type === 'number') {
                                  inputElement = (
                                    <Input
                                      type="number"
                                      placeholder={field.placeholder}
                                      className="h-10"
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
                                      <SelectTrigger className="h-10">
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
                                      <div className="space-y-2.5">
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
                                    <DateField
                                      value={(formField.value as string) || ''}
                                      onChange={formField.onChange}
                                      placeholder={tt("selectDate")}
                                      // Applicant-supplied dates may be in the past.
                                      minToday={false}
                                      className="h-10 w-full"
                                    />
                                  );
                                } else if (field.type === 'file' || field.type === 'cloudflare_upload') {
                                  const existingFile = customFieldFiles[field.id];
                                  inputElement = (
                                    <DocumentUploadField
                                      id={`custom-${field.id}`}
                                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                                      file={existingFile ?? null}
                                      label={field.placeholder || t("clickToUploadFile", { defaultValue: "Click to upload file" })}
                                      hint={t("fileFormatMax10MB_doc", { defaultValue: "PDF, JPG, PNG, DOC (max 10MB)" })}
                                      existingHint={t("previouslyUploaded", { defaultValue: "Previously uploaded" })}
                                      existingName={!existingFile && formField.value ? (typeof formField.value === "string" ? formField.value : t("documentAlreadyOnFile", { defaultValue: "Document already on file" })) : null}
                                      chooseLabel={t("chooseFile", { defaultValue: "Choose file" })}
                                      changeLabel={t("changeFile", { defaultValue: "Change file" })}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        if (file.size > 10 * 1024 * 1024) {
                                          toast({
                                            title: t("fileTooLarge", { defaultValue: "File Too Large" }),
                                            description: t("maxFile10mb", { defaultValue: "Maximum file size is 10MB" }),
                                            variant: "destructive",
                                          });
                                          return;
                                        }
                                        setCustomFieldFiles(prev => ({ ...prev, [field.id]: file }));
                                        formField.onChange(file.name);
                                      }}
                                      onRemove={existingFile ? () => { setCustomFieldFiles(prev => { const next = { ...prev }; delete next[field.id]; return next; }); formField.onChange(""); } : undefined}
                                      removeLabel={t("removeFile", { defaultValue: "Remove file" })}
                                    />
                                  );
                                }

                                // If no input element was created, return a fallback element
                                if (!inputElement) {
                                  return (
                                    <FormItem className={spansFullWidth ? "sm:col-span-2" : undefined}>
                                      <FormLabel className="text-sm font-medium">
                                        {field.label}
                                        <RequirementMarker flag={field.required} defaultRequired={false} />
                                      </FormLabel>
                                      <FormControl>
                                        <div className="text-sm text-muted-foreground">{t("unsupportedFieldType", { defaultValue: "Unsupported field type:" })} {field.type}</div>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  );
                                }

                                return (
                                  <FormItem className={spansFullWidth ? "sm:col-span-2" : undefined}>
                                    <FormLabel className="text-sm font-medium">
                                      {field.label}
                                      <RequirementMarker flag={field.required} defaultRequired={false} />
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
            </>
          )}

          {/* TIER 2: Kitchen Coordination (shown when Tier 1 is approved and moving to Tier 2) */}
          {/* Note: Facility documents (floor plans, equipment, materials, ventilation) are sent by managers via chat */}
          {currentTier >= 2 && (
            <>
              <Card className="rounded-xl shadow-none">
                <CardContent className="p-4 sm:p-5">
                  {/* Show submitted confirmation when Tier 2 is already completed */}
                  {application?.tier2_completed_at ? (
                    <div className="space-y-4">
                      <div className="rounded-[1.35rem] border p-4">
                        <div className="flex items-center gap-3">
                          <Check className="h-6 w-6 text-primary" />
                          <div>
                            <p className="font-medium">{t("docsSubmittedSuccessfully", { defaultValue: "Documents Submitted Successfully" })}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {t("documentsAwaitingManagerReview", { defaultValue: "Your documents have been submitted and are awaiting manager review." })}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-muted rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">
                          <strong>{t("whatHappensNext", { defaultValue: "What happens next?" })}</strong><br />
                          {t("managerWillReviewDocs1", { defaultValue: "The manager will review your submitted documents. They may reach out via messages on Local Cooks if additional information is needed. " })}
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
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 rounded-xl border bg-background p-4 text-sm">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-foreground">{t("whatHappensNext", { defaultValue: "What happens next" })}</p>
                          <p className="mt-0.5 leading-5 text-muted-foreground">Coordinate with the kitchen manager in Local Cooks messages to obtain your Food Establishment Licence for this premises. Upload it here with your other kitchen documents, then submit for manager review.</p>
                          {application?.chat_conversation_id && <a className="mt-2 inline-block font-medium text-primary underline" href={`/dashboard?view=messages&conversation=${encodeURIComponent(application.chat_conversation_id)}`}>Message the kitchen manager</a>}
                        </div>
                      </div>

                      {needsPhoneInForm && (
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem className="rounded-xl border p-4">
                              <FormLabel className="text-sm font-medium">
                                {t("phoneNumber", { defaultValue: "Phone number" })} <span className="text-destructive">*</span>
                              </FormLabel>
                              <p className="text-xs leading-5 text-muted-foreground">
                                {t("phoneMissingFromProfile", { defaultValue: "Add a phone number so the kitchen can contact you about your application." })}
                              </p>
                              <FormControl>
                                <Input
                                  type="tel"
                                  inputMode="tel"
                                  autoComplete="tel"
                                  placeholder="(709) 000-0000"
                                  {...field}
                                  value={field.value || ""}
                                  className="h-10 sm:max-w-xs"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Kitchen document sections span the full form width. */}
                      <div className="grid gap-4 sm:grid-cols-2 items-start">
                      {/* The answer and document from the initial request carry into this step. */}
                      <div className="rounded-xl border p-4 sm:col-span-2">
                        <div>
                          <div className="min-w-0">
                            <Label className="block text-sm font-medium">
                              Food safety certificate <RequirementMarker flag={requirements?.requireFoodHandlerCert} defaultRequired={true} />
                            </Label>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                              {isRequiredField(requirements?.requireFoodHandlerCert, true) ? 'This kitchen asks for a current certificate and its expiry date.' : 'You can share a certificate if you have one. Any document from your first request stays on file.'}
                            </p>
                          </div>
                          <YesNoChoice
                            className="my-3"
                            ariaLabel="step2-food-safety-answer"
                            value={foodSafetyAnswer}
                            onChange={(answer) => {
                              setFoodSafetyAnswer(answer);
                              if (answer !== "yes") { setFoodHandlerFile(null); }
                            }}
                            yesLabel={t("optionYes", { defaultValue: "Yes" })}
                            noLabel={t("optionNo", { defaultValue: "No" })}
                          />
                        </div>
                        {foodSafetyAnswer === 'yes' && <>

                        {existingFoodHandlerUrl && !foodHandlerFile && (
                          <div className="mb-3 flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-3">
                            <Check className="h-5 w-5 text-primary" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{t("foodSafetyLicense", { defaultValue: "Food Safety License" })}</p>
                              <p className="text-xs text-muted-foreground">Already uploaded with your request</p>
                              {(application?.foodSafetyLicenseStatus !== 'approved' || (application?.foodSafetyLicenseExpiry && Date.parse(application.foodSafetyLicenseExpiry) < Date.now() - 86400000)) && <p className="text-xs text-muted-foreground">{application?.foodSafetyLicenseExpiry && Date.parse(application.foodSafetyLicenseExpiry) < Date.now() - 86400000 ? 'Expired — replace this certificate' : application?.foodSafetyLicenseStatus === 'rejected' ? 'Needs a replacement' : 'Review pending'}</p>}
                              <a
                                href={existingFoodHandlerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline"
                              >
                                {t("viewLicense", { defaultValue: "View license" })}
                              </a>
                            </div>
                            <VerifiedDocumentChip status={application?.foodSafetyLicenseStatus} url={existingFoodHandlerUrl} expiry={application?.foodSafetyLicenseExpiry} />
                          </div>
                        )}

                        <DocumentUploadField
                          id="step2-foodSafetyLicense"
                          accept=".pdf,.jpg,.jpeg,.png"
                          file={foodHandlerFile}
                          existingName={existingFoodHandlerUrl ? t("foodSafetyLicense", { defaultValue: "Food Safety License" }) : null}
                          label={t("clickToUploadLicense", { defaultValue: "Click to upload license" })}
                          hint={t("fileFormatMax5MB", { defaultValue: "PDF, JPG, PNG (max 5MB)" })}
                          existingHint={t("currentFileKeptUnlessChanged", { defaultValue: "Your current file stays on record unless you choose another" })}
                          chooseLabel={t("chooseFile", { defaultValue: "Choose file" })}
                          changeLabel={t("changeFile", { defaultValue: "Change file" })}
                          onChange={handleFoodHandlerFileChange}
                          onRemove={() => setFoodHandlerFile(null)}
                          removeLabel={t("removeFile", { defaultValue: "Remove file" })}
                        />

                      {(foodHandlerFile || existingFoodHandlerUrl) && <FormField
                        control={form.control}
                        name="foodHandlerCertExpiry"
                        render={({ field }) => (
                          <FormItem className="mt-3">
                            <FormLabel className="text-sm font-medium">
                              {t("foodSafetyLicenseExpiryLabel", { defaultValue: "Certificate expiry date" })}{" "}
                              <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <KitchenDocumentDatePicker
                                value={field.value}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />}
                      </>}
                      </div>

                      {/* Food Establishment License/Permit */}
                        <div className="rounded-xl border p-4 sm:col-span-2">
                          <Label className="text-sm font-medium block">
                            {t("foodEstablishmentLicenseLabel", { defaultValue: "Food Establishment License/Permit" })}{" "}
                            <RequirementMarker flag={requirements?.tier2_food_establishment_cert_required} defaultRequired={true} />
                          </Label>
                          <p className="mt-0.5 mb-3 text-xs leading-5 text-muted-foreground">
                            Upload your Food Establishment Licence for this premises. If you are still obtaining it, coordinate with the kitchen manager in messages and return here when it is ready.
                          </p>

                          {/* Show existing file if available */}
                          {existingBusinessLicenseUrl && !businessLicenseFile && (
                            <div className="mb-3 flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-3">
                              <Check className="h-5 w-5 text-primary" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{t("businessLicense", { defaultValue: "Business License" })}</p>
                                <p className="text-xs text-muted-foreground">{t("documentAlreadyOnFile", { defaultValue: "Document already on file" })}</p>
                                <a
                                  href={existingBusinessLicenseUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline"
                                >
                                  {t("viewLicense", { defaultValue: "View license" })}
                                </a>
                              </div>
                              <VerifiedDocumentChip status={application?.foodEstablishmentCertStatus} url={existingBusinessLicenseUrl} expiry={application?.foodEstablishmentCertExpiry} />
                            </div>
                          )}

                          <DocumentUploadField
                            id="businessLicense"
                            accept=".pdf,.jpg,.jpeg,.png"
                            file={businessLicenseFile}
                            existingName={existingBusinessLicenseUrl ? t("businessLicense", { defaultValue: "Business License" }) : null}
                            label={t("clickToUploadLicense", { defaultValue: "Click to upload license" })}
                            hint={t("fileFormatMax5MB", { defaultValue: "PDF, JPG, PNG (max 5MB)" })}
                            existingHint={t("currentFileKeptUnlessChanged", { defaultValue: "Your current file stays on record unless you choose another" })}
                            chooseLabel={t("chooseFile", { defaultValue: "Choose file" })}
                            changeLabel={t("changeFile", { defaultValue: "Change file" })}
                            onChange={handleBusinessLicenseFileChange}
                            onRemove={existingBusinessLicenseUrl ? undefined : () => setBusinessLicenseFile(null)}
                            removeLabel={t("removeFile", { defaultValue: "Remove file" })}
                            className={fileErrors.businessLicense ? "rounded-xl ring-1 ring-destructive/40" : undefined}
                          />

                          {fileErrors.businessLicense && (
                            <p className="text-sm font-medium text-destructive mt-2">{fileErrors.businessLicense}</p>
                          )}

                          {/* Expiry belongs with the licence it describes, not in a card of its own. */}
                          <div className="mt-3 border-t pt-3">
                            <FormField
                              control={form.control}
                              name="foodEstablishmentCertExpiry"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-sm font-medium">
                                    {t("foodEstablishmentExpiryLabel", { defaultValue: "Food Establishment License Expiry Date" })}{" "}
                                    <RequirementMarker flag={requirements?.tier2_food_establishment_expiry_required} defaultRequired={false} />
                                  </FormLabel>
                                  <FormControl>
                                    <KitchenDocumentDatePicker
                                      value={field.value}
                                      onChange={field.onChange}
                                    />
                                  </FormControl>
                                  <p className="text-xs text-muted-foreground">
                                    {requirements?.tier2_food_establishment_expiry_required
                                      ? t("enterFoodEstExpiry", { defaultValue: "Enter the expiry date for your food establishment license" })
                                      : t("enterFoodEstExpiryOptional", { defaultValue: "Optional - Enter if you have a food establishment license" })}
                                  </p>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>

                      {/* Insurance Document */}
                        <div className="rounded-xl border p-4 sm:col-span-2">
                          <Label className="text-sm font-medium block">
                            {t("insuranceDocument", { defaultValue: "Insurance Document" })}{" "}
                            <RequirementMarker flag={requirements?.tier2_insurance_document_required} defaultRequired={false} />
                          </Label>
                          <p className="mt-0.5 mb-3 text-xs leading-5 text-muted-foreground">
                            {t("uploadLiabilityInsurance", { defaultValue: "Upload your current commercial liability insurance document." })}
                          </p>
                          <DocumentUploadField
                            id="insuranceDoc"
                            accept=".pdf,.jpg,.jpeg,.png"
                            file={insuranceFile}
                            label={t("clickToUploadInsurance", { defaultValue: "Click to upload insurance document" })}
                            hint={t("fileFormatMax10MB", { defaultValue: "PDF, JPG, PNG (max 10MB)" })}
                            chooseLabel={t("chooseFile", { defaultValue: "Choose file" })}
                            changeLabel={t("changeFile", { defaultValue: "Change file" })}
                            onChange={handleInsuranceFileChange}
                            onRemove={() => setInsuranceFile(null)}
                            removeLabel={t("removeFile", { defaultValue: "Remove file" })}
                            className={fileErrors.insurance ? "rounded-xl ring-1 ring-destructive/40" : undefined}
                          />
                          {fileErrors.insurance && (
                            <p className="text-sm font-medium text-destructive mt-2">{fileErrors.insurance}</p>
                          )}
                        </div>
                      </div>

                      {/* Kitchen Experience Description */}
                      {requirements?.tier2_kitchen_experience_required && (
                        <div className="rounded-xl border p-4 sm:col-span-2">
                          <FormField
                            control={form.control}
                            name="kitchenExperienceDescription"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-sm font-medium">
                                  {t("kitchenExpDescLabel", { defaultValue: "Kitchen Experience Description" })}{" "}
                                  <RequirementMarker flag={requirements?.tier2_kitchen_experience_required} defaultRequired={false} />
                                </FormLabel>
                                <FormControl>
                                  <Textarea
                                    {...field}
                                    placeholder={t("kitchenExpDescPlaceholder", { defaultValue: "Describe your experience working in commercial kitchens, including types of establishments, roles, and duration..." })}
                                    className="min-h-[80px] resize-none"
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
                        <div className="rounded-xl border p-4 sm:col-span-2">
                          <p className="mb-4 text-sm font-semibold text-foreground">{t("additionalRequirements", { defaultValue: "Additional requirements" })}</p>
                          {/* Two columns: short inputs pair up; textareas and uploads take the full width. */}
                          <div className="grid gap-4 sm:grid-cols-2">
                            {requirements.tier2_custom_fields.map((field: CustomField) => {
                              if (!field || !field.id || !field.type) return null;
                              const fieldName = `custom_${field.id}` as keyof KitchenApplicationFormData;
                              // A control that wants real width gets it; everything short shares a row.
                              const spansFullWidth = ["textarea", "file", "cloudflare_upload"].includes(field.type)
                                || (field.type === "checkbox" && Array.isArray(field.options) && field.options.length > 2);
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
                                          className="h-10"
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
                                          className="h-10"
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
                                          <SelectTrigger className="h-10">
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
                                          <div className="space-y-2">
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
                                        <DateField
                                          value={(formField.value as string) || ''}
                                          onChange={formField.onChange}
                                          placeholder={tt("selectDate")}
                                          // Applicant-supplied dates may be in the past.
                                          minToday={false}
                                          className="h-10 w-full"
                                        />
                                      );
                                    } else if (field.type === 'file' || field.type === 'cloudflare_upload') {
                                      const existingFile = customFieldFiles[field.id];
                                      inputElement = (
                                        <DocumentUploadField
                                          id={`custom2-${field.id}`}
                                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                                          file={existingFile ?? null}
                                          label={field.placeholder || t("clickToUploadFile", { defaultValue: "Choose a file" })}
                                          hint={t("fileFormatMax10MB_doc", { defaultValue: "PDF, JPG, PNG, DOC (max 10MB)" })}
                                          existingHint={t("documentAlreadyOnFile", { defaultValue: "Document already on file" })}
                                          existingName={!existingFile && formField.value ? (typeof formField.value === "string" ? formField.value : t("documentAlreadyOnFile", { defaultValue: "Document already on file" })) : null}
                                          chooseLabel={t("chooseFile", { defaultValue: "Choose file" })}
                                          changeLabel={t("changeFile", { defaultValue: "Change file" })}
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            if (file.size > 10 * 1024 * 1024) {
                                              toast({
                                                title: t("fileTooLarge", { defaultValue: "File Too Large" }),
                                                description: t("maxFile10mb", { defaultValue: "Maximum file size is 10MB" }),
                                                variant: "destructive",
                                              });
                                              return;
                                            }
                                            setCustomFieldFiles(prev => ({ ...prev, [field.id]: file }));
                                            formField.onChange(file.name);
                                          }}
                                          onRemove={existingFile ? () => { setCustomFieldFiles(prev => { const next = { ...prev }; delete next[field.id]; return next; }); formField.onChange(""); } : undefined}
                                          removeLabel={t("removeFile", { defaultValue: "Remove file" })}
                                        />
                                      );
                                    }

                                    // If no input element was created, show unsupported type message
                                    if (!inputElement) {
                                      return (
                                        <FormItem className={spansFullWidth ? "sm:col-span-2" : undefined}>
                                          <FormLabel className="text-sm font-medium">
                                            {field.label}
                                            <RequirementMarker flag={field.required} defaultRequired={false} />
                                          </FormLabel>
                                          <FormControl>
                                            <div className="text-sm text-muted-foreground">{t("unsupportedFieldType", { defaultValue: "Unsupported field type:" })} {field.type}</div>
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      );
                                    }

                                    return (
                                      <FormItem className={spansFullWidth ? "sm:col-span-2" : undefined}>
                                        <FormLabel className="text-sm font-medium">
                                          {field.label}
                                          <RequirementMarker flag={field.required} defaultRequired={false} />
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

          {/* SECTION 5: Terms & Agreements — intentionally the last block before
              Submit. It is Tier 1 content, so it stays gated on currentTier === 1. */}
          {currentTier === 1 && (
          <Card className="shadow-none" ref={registerSection("terms")}>
            <CardContent className="p-6">
              <div className="mb-6 border-b pb-3">
                <h3 className="font-semibold">{t("termsAndAgreements", { defaultValue: "Terms & Agreements" })}</h3>
              </div>

              <div className="space-y-4">
                {/* Kitchen-specific Terms & Policies */}
                {location.kitchenTermsUrl && (
                  <div className="rounded-[1.35rem] border p-4 mb-4">
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
                  render={({ field }) => {
                    termsAgreeRef.current = field.value === true;
                    return (
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
                          {/* The policies are named, so they have to be openable. The link is
                              the platform terms; the kitchen's own terms are linked above. */}
                          {t("agreeToLocalCooksPoliciesPrefix", { defaultValue: "I agree to Local Cooks\'" })}{" "}
                          <a
                            href="/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                          >
                            {t("platformTermsAndConditions", { defaultValue: "kitchen usage policies and food safety standards" })}
                          </a>
                          {location.kitchenTermsUrl && t("agreeToLocalCooksPolicies2", { defaultValue: ", including the kitchen-specific terms and policies above" })},
                          {t("agreeToLocalCooksPolicies3", { defaultValue: " and understand that all chefs must maintain current food safety certifications." })}
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                    );
                  }}
                />

                <FormField
                  control={form.control}
                  name="accuracyAgree"
                  render={({ field }) => {
                    accuracyAgreeRef.current = field.value === true;
                    return (
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
                          {t("certifyInfoAccurate1", { defaultValue: "I certify that all information provided is accurate and complete." })}{" "}
                          {/* "Misrepresentation" is a term of the privacy/accuracy policy, so the
                              reader can check what it commits them to before ticking. */}
                          {t("certifyInfoAccuratePrefix", { defaultValue: "I understand that misrepresentation may result in account suspension, as described in the" })}{" "}
                          <a
                            href="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                          >
                            {t("privacyPolicy", { defaultValue: "Privacy Policy" })}
                          </a>
                          .
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                    );
                  }}
                />
              </div>
            </CardContent>
          </Card>
          )}

        </form>
      </Form>

      </div>

      {/*
       * RAIL — the progress tracker, beside the task rather than above it.
       *
       * An `aside`, and sticky. It annotates the form instead of being part of it, and on a
       * form this long a readout that scrolls away is a readout that is only read once.
       *
       * Hidden under `lg` on purpose: two columns at tablet width leave the form too narrow
       * to read, and stacking the rail would push every field another screen down.
       */}
      <aside className="hidden min-w-0 lg:sticky lg:top-6 lg:block">
        <ApplicationProgress {...trackerProps} />
      </aside>

      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardKitchenDocumentsTitle", { defaultValue: "Leave without submitting?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("discardKitchenDocumentsDesc", { defaultValue: "Files and changes selected on this page will not be saved." })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keepEditing", { defaultValue: "Keep editing" })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false);
                if (onCancel) onCancel();
                else window.history.back();
              }}
            >
              {t("leavePage", { defaultValue: "Leave page" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {gate}
    </div>
  );
}
