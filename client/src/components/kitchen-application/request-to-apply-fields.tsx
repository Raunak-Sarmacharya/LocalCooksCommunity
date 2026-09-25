/**
 * Shared “Request to apply” (Tier 1) field options + compact form.
 * Used by registration/preview auth modal and /apply-kitchen so both paths stay uniform.
 */
import { useTranslation } from "react-i18next";
import { FormLegend } from "@/components/ui/form-legend";
import { DateField } from "@/components/ui/date-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DocumentUploadField } from "./DocumentUploadField";
import { cn } from "@/lib/utils";

export const REQUEST_TO_APPLY_BUSINESS_TYPES = [
  { value: "catering", key: "btCatering", fallback: "Catering & Events" },
  { value: "bakery", key: "btBakery", fallback: "Bakery & Baked Goods" },
  { value: "meal-prep", key: "btMealPrep", fallback: "Meal Prep & Meal Plans" },
  { value: "specialty", key: "btSpecialty", fallback: "Specialty/Artisanal Foods" },
  { value: "pasta", key: "btPasta", fallback: "Pasta & Noodles" },
  { value: "sauce", key: "btSauce", fallback: "Sauces & Condiments" },
  { value: "prepared", key: "btPrepared", fallback: "Prepared Meals" },
  { value: "other", key: "btOther", fallback: "Other" },
] as const;

export const REQUEST_TO_APPLY_FREQUENCIES = [
  { value: "weekly", key: "freqWeekly", fallback: "Weekly (regular user)" },
  { value: "few-times-month", key: "freqFewTimesMonth", fallback: "A few times a month" },
  { value: "monthly", key: "freqMonthly", fallback: "Monthly or less" },
  { value: "occasionally", key: "freqOccasionally", fallback: "Occasionally" },
  { value: "not-sure", key: "freqNotSureYet", fallback: "Not sure yet" },
] as const;

export type RequestToApplyDraft = {
  fullName: string;
  phone: string;
  shopName: string;
  businessType: string;
  businessDescription: string;
  foodSafetyLicense: "yes" | "no" | "notSure";
  foodSafetyLicenseExpiry: string;
  usageFrequency: string;
};

export const EMPTY_REQUEST_TO_APPLY_DRAFT: RequestToApplyDraft = {
  fullName: "",
  phone: "",
  shopName: "",
  businessType: "",
  businessDescription: "",
  foodSafetyLicense: "notSure",
  foodSafetyLicenseExpiry: "",
  usageFrequency: "",
};

/** Required fields first, then optional — used by UI order + tests. */
export const REQUEST_TO_APPLY_FIELD_ORDER = {
  required: ["fullName", "usageFrequency", "phone", "foodSafetyLicense"] as const,
  optional: [
    "shopName",
    "businessType",
    "businessDescription",
  ] as const,
};

/** Split "First Last" for kitchen-application APIs that expect firstName/lastName. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function RequestToApplyFields({
  draft,
  onChange,
  email,
  certificateFile,
  onCertificateFileChange,
}: {
  draft: RequestToApplyDraft;
  onChange: (patch: Partial<RequestToApplyDraft>) => void;
  email?: string;
  certificateFile?: File | null;
  onCertificateFileChange?: (file: File | null) => void;
}) {
  const { t } = useTranslation("kitchen");

  return (
    <div className="space-y-3" data-testid="request-to-apply-fields">
      <FormLegend />
      {/* —— Required —— */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("applyFormFullName", "Full name")}{" "}
          <span className="text-destructive">*</span>
        </label>
        <input
          data-testid="rta-full-name"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.fullName}
          onChange={(e) => onChange({ fullName: e.target.value })}
          placeholder={t("applyFormFullNamePlaceholder", "First and last name")}
        />
      </div>
      {email ? (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">{t("emailAddress")}</label>
          <input
            className="w-full px-4 py-2 border rounded-md bg-gray-50 text-gray-600"
            value={email}
            readOnly
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("howOftenNeedKitchen")} <span className="text-destructive">*</span>
        </label>
        <select
          data-testid="rta-usage-frequency"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.usageFrequency}
          onChange={(e) => onChange({ usageFrequency: e.target.value })}
        >
          <option value="">{t("selectFrequency", "Select frequency")}</option>
          {REQUEST_TO_APPLY_FREQUENCIES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.key, opt.fallback)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("phoneNumber")} <span className="text-destructive">*</span>
        </label>
        <input
          data-testid="rta-phone"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          type="tel"
          required
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">
          {t("haveFoodSafetyLicense", "Do you have a food safety certificate?")} <span className="text-destructive">*</span>
        </label>
        <p className="text-xs text-muted-foreground">
          {t("foodSafetyLicenseHelp", "A valid certificate helps kitchens approve you faster.")}
        </p>
        <RadioGroup
          value={draft.foodSafetyLicense === "notSure" ? "" : draft.foodSafetyLicense}
          onValueChange={(answer) => {
            onChange({ foodSafetyLicense: answer as "yes" | "no", ...(answer !== "yes" ? { foodSafetyLicenseExpiry: "" } : {}) });
            if (answer !== "yes") onCertificateFileChange?.(null);
          }}
          aria-label={t("haveFoodSafetyLicense", "Do you have a food safety certificate?")}
          className="flex flex-wrap gap-2"
        >
          <label htmlFor="rta-food-safety-yes" className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 transition-colors", draft.foodSafetyLicense === "yes" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30")}>
            <RadioGroupItem value="yes" id="rta-food-safety-yes" className="shrink-0" />
            <span className="text-sm">{t("optionYes", "Yes")}</span>
          </label>
          <label htmlFor="rta-food-safety-no" className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 transition-colors", draft.foodSafetyLicense === "no" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30")}>
            <RadioGroupItem value="no" id="rta-food-safety-no" className="shrink-0" />
            <span className="text-sm">{t("optionNo", "No")}</span>
          </label>
        </RadioGroup>
        <input
          data-testid="rta-food-safety"
          type="hidden"
          value={draft.foodSafetyLicense}
          readOnly
        />
      </div>
      {draft.foodSafetyLicense === "yes" && onCertificateFileChange && (
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("foodSafetyCertificate", "Food safety certificate")}{" "}
                <span className="font-normal text-muted-foreground">{t("optional", "(Optional)")}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("optionalCertificateUpload", "Add it now, or provide it when a kitchen requires it.")}
              </p>
            </div>
          </div>

          <DocumentUploadField
            id="request-food-safety-certificate"
            accept=".pdf,.jpg,.jpeg,.png"
            file={certificateFile ?? null}
            label={t("chooseFile", "Choose file")}
            hint={t("certificateFileHint", "PDF, JPG or PNG \u00b7 up to 5 MB")}
            chooseLabel={t("chooseFile", "Choose file")}
            changeLabel={t("changeFile", "Change")}
            onChange={(event) => onCertificateFileChange?.(event.target.files?.[0] || null)}
            onRemove={() => onCertificateFileChange?.(null)}
            removeLabel={t("removeFile", "Remove file")}
          />

          {certificateFile && (
            <div className="space-y-1.5 rounded-lg border border-border bg-background p-3">
              <label htmlFor="request-food-safety-expiry" className="block text-sm font-medium text-foreground">
                {t("foodSafetyLicenseExpiryLabel", "Certificate expiry date")} *{" "}
                <span className="font-normal text-muted-foreground">{t("optional", "(Optional)")}</span>
              </label>
              <DateField
                id="request-food-safety-expiry"
                value={draft.foodSafetyLicenseExpiry}
                onChange={(date) => onChange({ foodSafetyLicenseExpiry: date })}
                placeholder={t("foodSafetyLicenseExpiryLabel", "Choose expiry date")}
                className="w-full"
              />
            </div>
          )}
        </div>
      )}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("applyFormShopName", "Business / shop name")}{" "}
          <span className="text-muted-foreground text-xs font-normal">
            {t("optional", "(Optional)")}
          </span>
        </label>
        <input
          data-testid="rta-shop-name"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.shopName}
          onChange={(e) => onChange({ shopName: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("typeOfFoodBusiness")}{" "}
          <span className="text-muted-foreground text-xs font-normal">
            {t("optional", "(Optional)")}
          </span>
        </label>
        <select
          data-testid="rta-business-type"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.businessType}
          onChange={(e) => onChange({ businessType: e.target.value })}
        >
          <option value="">{t("selectBusinessType")}</option>
          {REQUEST_TO_APPLY_BUSINESS_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.key, opt.fallback)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("tellUsAboutBusiness")}{" "}
          <span className="text-muted-foreground text-xs font-normal">
            {t("optional", "(Optional)")}
          </span>
        </label>
        <input
          data-testid="rta-business-description"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.businessDescription}
          onChange={(e) => onChange({ businessDescription: e.target.value })}
        />
      </div>
    </div>
  );
}
