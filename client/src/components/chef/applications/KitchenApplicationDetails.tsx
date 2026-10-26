import { Fragment } from "react";
import { formatPreferredSchedule } from "@/lib/preferred-schedule";
import { fromCalendarDate } from "@/lib/calendar-date";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { VerifiedDocumentChip } from "@/components/common/VerifiedDocumentChip";
import type { KitchenApplicationWithLocation } from "@/hooks/use-chef-kitchen-applications";
import { parseBusinessInfo, formatExperience } from "@/utils/parseBusinessInfo";
import { getKitchenDisplayStatus } from "./status";
import { REQUEST_TO_APPLY_BUSINESS_TYPES, REQUEST_TO_APPLY_FREQUENCIES } from "@/components/kitchen-application/request-to-apply-fields";
import { ApplicationDocumentRows } from "./MyDocuments";
import { customDocumentFields, isKitchenDocument } from "@shared/location-booking-eligibility";
import { formatPhoneForDisplay } from "@shared/phone-validation";

export interface ApplicationCustomField { id: string; label: string; type?: string }
export interface ApplicationFieldDefinitions { tier1_custom_fields?: ApplicationCustomField[]; tier2_custom_fields?: ApplicationCustomField[] }

export function KitchenApplicationDetails({ app, display, onBookKitchen, compact = false, requirements, showActions = true, hideDocuments = false, hideFeedback = false }: {
  app: KitchenApplicationWithLocation;
  display: ReturnType<typeof getKitchenDisplayStatus>;
  onBookKitchen: (locationId: number, locationName: string, address?: string) => void;
  compact?: boolean;
  requirements?: ApplicationFieldDefinitions;
  showActions?: boolean;
  /** The kitchen page lists documents in their own section above. */
  hideDocuments?: boolean;
  /** Declined: the kitchen page quotes the note in its next-step panel. */
  hideFeedback?: boolean;
}) {
  const { t, i18n } = useTranslation("chef");
  const { t: tKitchen } = useTranslation("kitchen");
  const tier = (app.tier_data || {}) as Record<string, any>;
  const documents = tier.step2 || tier.tier2 || {};
  const business = parseBusinessInfo(app.businessDescription);
  const businessType = REQUEST_TO_APPLY_BUSINESS_TYPES.find(option => option.value === business?.businessType);
  const frequency = REQUEST_TO_APPLY_FREQUENCIES.find(option => option.value === business?.usageFrequency);
  const durations: Record<string, [string, string]> = { "2-4": ["dur2to4", "2–4 hours"], "4-8": ["dur4to8", "4–8 hours"], "8-12": ["dur8to12", "8–12 hours (full day)"], "12+": ["dur12plus", "12+ hours (extended)"] };
  const duration = business?.sessionDuration ? durations[business.sessionDuration] : undefined;
  const date = (value: string | Date | null | undefined) => value && !Number.isNaN(fromCalendarDate(value).getTime()) ? fromCalendarDate(value).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" }) : t("apptabNotProvided", "Not provided");
  const value = (item: unknown): string => item == null || item === "" ? t("apptabNotProvided", "Not provided") : typeof item === "boolean" ? item ? t("apptabYes", "Yes") : t("apptabNo", "No") : Array.isArray(item) ? item.map(value).join(", ") : typeof item === "object" ? Object.values(item).map(value).join(", ") : String(item);
  const fields = (items: [string, unknown][]) => <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{items.map(([label, item]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{value(item)}</dd></div>)}</dl>;
  const section = (title: string, children: React.ReactNode) => <section className="rounded-xl border bg-card p-5 sm:p-6"><h2 className="mb-5 text-base font-semibold">{title}</h2>{children}</section>;
  const custom = (answers: Record<string, unknown> | undefined, definitions: ApplicationCustomField[] | undefined) => {
    if (!answers || !Object.keys(answers).length) return null;
    return <dl className="grid gap-4 sm:grid-cols-2">{Object.entries(answers).map(([id, answer], index) => {
      const field = definitions?.find(item => item.id === id);
      const label = field?.label || t("applicationAdditionalAnswer", { defaultValue: "Additional answer {number}", number: index + 1 });
      const file = typeof answer === "string" && (field?.type === "file" || /^(?:https?:\/\/|\/api\/files\/)/i.test(answer) && /(?:\/documents\/|\/api\/files\/|\.(?:pdf|png|jpe?g|webp|docx?)(?:[?#]|$))/i.test(answer));
      return <div key={id} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{file ? <SecureDocumentLink url={answer as string} label={t("apptabViewDocument", "View document")} showExternalIcon={false} /> : value(answer)}</dd></div>;
    })}</dl>;
  };
  const tierFiles = Object.entries((tier.tierFiles || {}) as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1]);
  const otherDocuments = Object.entries((documents.documents || {}) as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1]);
  const fileLabel = (key: string) => key === "tier2_insurance_document" ? t("apptabInsuranceDocument", "Insurance document") : key.replace(/^tier\d+_/, "").replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const renderDocument = (label: string, url: string, status?: string | null, expiry?: string | null) => <div className="rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium capitalize">{label}</h3>{status && <VerifiedDocumentChip status={status} url={url} expiry={expiry} />}</div><div className="mt-2"><SecureDocumentLink url={url} label={t("apptabViewDocument", "View document")} showExternalIcon={false} /></div>{expiry && <p className="mt-2 text-xs text-muted-foreground">{t("apptabExpiryDate", "Expiry date")}: {date(expiry)}</p>}</div>;
  return <div className="min-w-0 space-y-6" data-testid="kitchen-application-details">
    {!compact && section(t("applicationOverview", "Application overview"), fields([[t("apptabApplicationId", "Application ID"), `APPLICATION-${app.id}`], [t("apptabSubmitted", "Submitted"), date(app.createdAt)], [t("apptabStatus", "Status"), display.label], [t("apptabCurrentProgress", "Current progress"), display.stepCaption]]))}
    {section(t("apptabPersonalInfo", "About you"), fields([[t("apptabFullName", "Full name"), app.fullName], [t("apptabEmail", "Email"), app.email], [t("apptabPhone", "Phone"), app.phone ? formatPhoneForDisplay(app.phone) : null]]))}
    {section(t("apptabBusinessInfo", "Your food business"), fields([
      [t("apptabBusinessName", "Business name"), business?.businessName || (app.shopName !== "Shop Not Named" ? app.shopName : null)],
      [t("apptabBusinessType", "Business type"), businessType ? tKitchen(businessType.key, businessType.fallback) : business?.businessType],
      ...(app.shopAddress && app.shopAddress !== "Address Not Provided" ? [[t("applicationBusinessAddress", "Business address"), app.shopAddress] as [string, unknown]] : []),
      [t("apptabExperience", "Experience"), business?.experience ? formatExperience(business.experience) : app.cookingExperience],
      [t("apptabDescription", "Description"), business?.description],
      [t("apptabUsageFrequency", "Usage frequency"), frequency ? tKitchen(frequency.key, frequency.fallback) : business?.usageFrequency],
      [t("apptabSessionDuration", "Session duration"), duration ? tKitchen(duration[0], duration[1]) : business?.sessionDuration],
      [t("apptabPreferredDays", "Preferred days"), formatPreferredSchedule(business?.preferredSchedule, i18n.language, t("fullDay", "Full day"))],
      // The yes/no answer from the request; once documents are listed below it would only repeat them.
      ...(app.documents?.length ? [] : [[t("apptabFoodSafetyLicense", "Food safety certification"), app.foodSafetyLicense === "yes" ? t("apptabYes", "Yes") : app.foodSafetyLicense === "no" ? t("apptabNo", "No") : t("apptabNotSure", "Not sure")] as [string, unknown]]),
    ]))}
    {custom(app.customFieldsData as Record<string, unknown>, requirements?.tier1_custom_fields) && section(t("applicationRequestAnswers", "Additional request information"), custom(app.customFieldsData as Record<string, unknown>, requirements?.tier1_custom_fields))}
    {hideDocuments ? (() => {
      // Documents are listed above on the kitchen page; the answers to the kitchen's own questions stay here.
      // The kitchen's own documents (and their "__expiry" dates) are listed above, not as unlabelled answers.
      const documentIds = (requirements?.tier2_custom_fields || []).filter((field: any) => isKitchenDocument(field)).map(field => field.id);
      const answerData = Object.fromEntries(Object.entries((tier.tier2_custom_fields_data || {}) as Record<string, unknown>)
        .filter(([id]) => !documentIds.includes(id.replace(/__expiry$/, ""))));
      const answers = custom(answerData, requirements?.tier2_custom_fields?.filter((field: any) => !isKitchenDocument(field)));
      const experience = tier.kitchen_experience_description || documents.kitchenExperienceDescription;
      return answers || experience ? section(t("kaRequirementAnswers", "Your answers to the kitchen"), <div className="space-y-4">{experience && fields([[t("applicationKitchenExperience", "Kitchen experience"), experience]])}{answers}</div>) : null;
    })() : app.documents?.length ? section(t("kitchenDocuments", "Booking requirements"), <div className="space-y-4">
      {app.documentsWaivedAt && <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{t("mdWaivedLocation", "This location doesn’t need documents from you")}</p>}
      <ApplicationDocumentRows app={app} viewLink={key => { const url = key.startsWith("custom:") ? customDocumentFields(app as any, key.slice(7)).url : key === "foodSafetyLicense" ? app.foodSafetyLicenseUrl : key === "foodEstablishmentCert" ? app.foodEstablishmentCertUrl : (app as any).insuranceUrl; return url ? <SecureDocumentLink url={url} label={t("apptabViewDocument", "View document")} showExternalIcon={false} /> : null; }} />
      {/* The kitchen's own uploads and answers stay listed below. */}
      {[...tierFiles.filter(([key]) => key !== "tier2_insurance_document"), ...otherDocuments].map(([key, url]) => <Fragment key={key}>{renderDocument(fileLabel(key), url)}</Fragment>)}
      {(tier.kitchen_experience_description || documents.kitchenExperienceDescription) && fields([[t("applicationKitchenExperience", "Kitchen experience"), tier.kitchen_experience_description || documents.kitchenExperienceDescription]])}
      {/* Documents are listed above; only the answers here. */}
      {custom(tier.tier2_custom_fields_data, requirements?.tier2_custom_fields?.filter((field: any) => !isKitchenDocument(field)))}
    </div>) : section(t("kitchenDocuments", "Booking requirements"), <div className="space-y-4">
      {app.foodSafetyLicenseUrl && renderDocument(t("apptabFoodSafetyLicense", "Food safety certificate"), app.foodSafetyLicenseUrl, app.foodSafetyLicenseStatus, app.foodSafetyLicenseExpiry || business?.foodHandlerCertExpiry)}
      {app.foodEstablishmentCertUrl && renderDocument(t("apptabFoodEstablishmentCert", "Food establishment licence"), app.foodEstablishmentCertUrl, app.foodEstablishmentCertStatus, app.foodEstablishmentCertExpiry || business?.foodEstablishmentCertExpiry)}
      {[...tierFiles, ...otherDocuments].map(([key, url]) => <Fragment key={key}>{renderDocument(fileLabel(key), url)}</Fragment>)}
      {!app.foodSafetyLicenseUrl && !app.foodEstablishmentCertUrl && !tierFiles.length && !otherDocuments.length && <p className="text-sm text-muted-foreground">{t("applicationNoDocuments", "No documents submitted yet.")}</p>}
      {(tier.kitchen_experience_description || documents.kitchenExperienceDescription) && fields([[t("applicationKitchenExperience", "Kitchen experience"), tier.kitchen_experience_description || documents.kitchenExperienceDescription]])}
      {(app.government_license_number || documents.governmentLicenseNumber) && fields([[t("apptabLicenseNumber", "Licence number"), app.government_license_number || documents.governmentLicenseNumber], [t("apptabReceivedDate", "Received date"), date(app.government_license_received_date || documents.governmentLicenseReceivedDate)], [t("apptabExpiryDate", "Expiry date"), date(app.government_license_expiry_date || documents.governmentLicenseExpiryDate)]])}
      {custom(tier.tier2_custom_fields_data, requirements?.tier2_custom_fields)}
    </div>)}
    {app.feedback && !hideFeedback && section(t("applicationFeedback", "Application feedback"), <p className="whitespace-pre-wrap break-words text-sm">{app.feedback}</p>)}
    {showActions && <div className="flex flex-wrap gap-2">{display.actionKind === "book" && <Button onClick={() => onBookKitchen(app.locationId, app.location?.name || "Kitchen", app.location?.address)}>{t("apptabBookKitchen", "Book kitchen")}</Button>}{display.actionKind === "complete-step" && <Button asChild><Link href={`/apply-kitchen/${app.locationId}`}>{t("continueKitchenApplication", "Continue application")}</Link></Button>}{display.actionKind === "discover" && <Button variant="outline" asChild><Link href={`/apply-kitchen/${app.locationId}`}>{t("kdApplyAgain", "Apply again")}</Link></Button>}</div>}
  </div>;
}
