/**
 * Shared “Request to apply” (Tier 1) field options + compact form.
 * Used by registration/preview auth modal and /apply-kitchen so both paths stay uniform.
 */
import { useTranslation } from "react-i18next";

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
  usageFrequency: string;
};

export const EMPTY_REQUEST_TO_APPLY_DRAFT: RequestToApplyDraft = {
  fullName: "",
  phone: "",
  shopName: "",
  businessType: "",
  businessDescription: "",
  foodSafetyLicense: "notSure",
  usageFrequency: "",
};

/** Required fields first, then optional — used by UI order + tests. */
export const REQUEST_TO_APPLY_FIELD_ORDER = {
  required: ["fullName", "usageFrequency"] as const,
  optional: [
    "phone",
    "shopName",
    "businessType",
    "businessDescription",
    "foodSafetyLicense",
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
}: {
  draft: RequestToApplyDraft;
  onChange: (patch: Partial<RequestToApplyDraft>) => void;
  email?: string;
}) {
  const { t } = useTranslation("kitchen");

  return (
    <div className="space-y-3" data-testid="request-to-apply-fields">
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

      {/* —— Optional —— */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("phoneNumber")}{" "}
          <span className="text-muted-foreground text-xs font-normal">
            {t("optional", "(Optional)")}
          </span>
        </label>
        <input
          data-testid="rta-phone"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          type="tel"
        />
      </div>
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
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {t("haveFoodSafetyLicense", "Do you have a Food Safety License?")}{" "}
          <span className="text-muted-foreground text-xs font-normal">
            {t("optional", "(Optional)")}
          </span>
        </label>
        <select
          data-testid="rta-food-safety"
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
          value={draft.foodSafetyLicense}
          onChange={(e) =>
            onChange({
              foodSafetyLicense: e.target.value as RequestToApplyDraft["foodSafetyLicense"],
            })
          }
        >
          <option value="yes">{t("optionYes", "Yes")}</option>
          <option value="no">{t("optionNo", "No")}</option>
          <option value="notSure">{t("optionNotSure", "Not sure")}</option>
        </select>
      </div>
    </div>
  );
}
