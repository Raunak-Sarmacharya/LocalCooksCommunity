/**
 * Seller application (owner, Oct 27): which documents apply to a kitchen setting, and where the chef is in the six
 * steps from applying to an open shop. One source for the chef's Selling page, Home, admin and emails.
 *
 * Two document slots, kept from the original table:
 *  - foodSafety (food_safety_license_*): food safety certificate. Commercial kitchens need it from an NL-approved course;
 *    home cooks are exempt from that rule, so it is recommended there.
 *  - kitchen (food_establishment_cert_*): the kitchen's own paper. Commercial: that kitchen's Food Establishment Licence,
 *    not needed when they cook in a Local Cooks kitchen (it's on file with the kitchen). Home: the one-time Home-based
 *    Food Industry Registration with Service NL. Not sure yet: decided on the call.
 */
import type { SellerDocumentKey } from "./schema";

export type SellerDocumentState = "missing" | "requested" | "uploaded" | "approved" | "rejected";
export type SellerDocument = {
  key: SellerDocumentKey;
  /** Multipart field name the upload routes take. */
  field: "foodSafetyLicense" | "foodEstablishmentCert";
  kind: "foodSafetyTraining" | "foodSafety" | "establishmentLicence" | "homeRegistration";
  recommended: boolean;
  url: string | null;
  state: SellerDocumentState;
};

type ApplicationLike = {
  status: string;
  kitchenPreference: string;
  commercialKitchen?: string | null;
  foodSafetyLicenseUrl?: string | null;
  foodSafetyLicenseStatus?: string | null;
  foodEstablishmentCertUrl?: string | null;
  foodEstablishmentCertStatus?: string | null;
  documentsRequested?: string[] | null;
  documentsRequestedAt?: string | Date | null;
  phpShopCreated?: boolean | null;
};

const stateOf = (url: string | null | undefined, status: string | null | undefined, requested: boolean): SellerDocumentState =>
  !url ? (requested ? "requested" : "missing") : status === "approved" ? "approved" : status === "rejected" ? "rejected" : "uploaded";

/** The documents that apply to this application's kitchen setting (plus any file already on file). */
export function sellerDocuments(app: ApplicationLike): SellerDocument[] {
  const requested = app.documentsRequested ?? [];
  const commercial = app.kitchenPreference === "commercial";
  const docs: SellerDocument[] = [{
    key: "foodSafety", field: "foodSafetyLicense", kind: commercial ? "foodSafetyTraining" : "foodSafety",
    recommended: app.kitchenPreference === "home", url: app.foodSafetyLicenseUrl ?? null,
    state: stateOf(app.foodSafetyLicenseUrl, app.foodSafetyLicenseStatus, requested.includes("foodSafety")),
  }];
  const kitchenKind = app.kitchenPreference === "home" ? "homeRegistration"
    : commercial && app.commercialKitchen !== "localcooks" ? "establishmentLicence" : null;
  if (kitchenKind || app.foodEstablishmentCertUrl || requested.includes("kitchen")) {
    docs.push({
      key: "kitchen", field: "foodEstablishmentCert", kind: kitchenKind ?? "establishmentLicence", recommended: false,
      url: app.foodEstablishmentCertUrl ?? null,
      state: stateOf(app.foodEstablishmentCertUrl, app.foodEstablishmentCertStatus, requested.includes("kitchen")),
    });
  }
  return docs;
}

/** True when the commercial kitchen is a Local Cooks kitchen, so its licence is already on file. */
export const kitchenLicenceOnFile = (app: ApplicationLike) => app.kitchenPreference === "commercial" && app.commercialKitchen === "localcooks";

export type SellerStepId = "apply" | "call" | "documents" | "shop" | "paid" | "open";
export type SellerStepState = "done" | "current" | "upcoming";
export type SellerProgress = {
  outcome: "active" | "rejected" | "cancelled";
  steps: { id: SellerStepId; state: SellerStepState }[];
  current: SellerStepId | null;
  /** Documents the chef still has to send because Local Cooks asked (or asked again). */
  owed: SellerDocument[];
};

/**
 * Where the chef is. Before approval: the call, until Local Cooks asks for documents; then documents (owed, or with
 * Local Cooks to check). After approval: any document still owed, then the shop (Local Cooks creates it), payouts
 * (Stripe, in the shop) and opening (menu, in the shop). Approving never waits on documents.
 */
export function sellerProgress(app: ApplicationLike, { stripeConnected = false } = {}): SellerProgress {
  const outcome = app.status === "rejected" ? "rejected" : app.status === "cancelled" ? "cancelled" : "active";
  const owed = sellerDocuments(app).filter((doc) => doc.state === "requested" || doc.state === "rejected");
  const order: SellerStepId[] = ["apply", "call", "documents", "shop", "paid", "open"];
  const current: SellerStepId | null = outcome !== "active" ? null
    : owed.length ? "documents"
    : app.status !== "approved" ? (app.documentsRequestedAt ? "documents" : "call")
    : !app.phpShopCreated ? "shop" : !stripeConnected ? "paid" : "open";
  const at = current ? order.indexOf(current) : 1;
  const steps = order.map((id, index) => ({ id, state: (index < at ? "done" : index === at && current ? "current" : "upcoming") as SellerStepState }));
  return { outcome, steps, current, owed };
}

/** Plain English names for emails and admin (the app uses i18n keys for the same kinds). */
export const SELLER_DOCUMENT_NAMES: Record<SellerDocument["kind"], string> = {
  foodSafetyTraining: "Food safety training certificate",
  foodSafety: "Food safety certificate",
  establishmentLicence: "Kitchen's Food Establishment Licence",
  homeRegistration: "Home-based Food Industry Registration",
};
