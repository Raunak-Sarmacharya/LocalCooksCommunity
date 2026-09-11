import type { AppLocale, I18nNamespace } from "@shared/i18n";
import enCommon from "@shared/i18n/locales/en-CA/common.json";
import enAuth from "@shared/i18n/locales/en-CA/auth.json";
import enErrors from "@shared/i18n/locales/en-CA/errors.json";
import enLanding from "@shared/i18n/locales/en-CA/landing.json";
import enBooking from "@shared/i18n/locales/en-CA/booking.json";
import enChef from "@shared/i18n/locales/en-CA/chef.json";
import enKitchen from "@shared/i18n/locales/en-CA/kitchen.json";
import enManager from "@shared/i18n/locales/en-CA/manager.json";
import enAdmin from "@shared/i18n/locales/en-CA/admin.json";
import enEmail from "@shared/i18n/locales/en-CA/email.json";
import enSms from "@shared/i18n/locales/en-CA/sms.json";
import enPdf from "@shared/i18n/locales/en-CA/pdf.json";
import enLegal from "@shared/i18n/locales/en-CA/legal.json";
import enMicrolearning from "@shared/i18n/locales/en-CA/microlearning.json";

/**
 * Type-safe i18next resources derived from en-CA catalogs (source of truth).
 */
export const enCaResources = {
  common: enCommon,
  auth: enAuth,
  errors: enErrors,
  landing: enLanding,
  booking: enBooking,
  chef: enChef,
  kitchen: enKitchen,
  manager: enManager,
  admin: enAdmin,
  email: enEmail,
  sms: enSms,
  pdf: enPdf,
  legal: enLegal,
  microlearning: enMicrolearning,
} as const;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof enCaResources;
  }
}

export type TranslationResources = typeof enCaResources;
export type { AppLocale, I18nNamespace };
