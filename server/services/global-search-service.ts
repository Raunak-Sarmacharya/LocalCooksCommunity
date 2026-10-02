import { pool } from "../db";
import { tLocale } from "../i18n";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppLocale } from "@shared/i18n";
import type { GeneratedSearchContentDocument, GlobalSearchResult, SearchPortal } from "@shared/search";
import { kitchenIsVisibleToChefs, licenseAllowsBookings } from "@shared/kitchen-license";
import {
  createSearchSnippet,
  isLikelyTypo,
  mergeSearchResults,
  scoreStaticDocument,
} from "./global-search-utils";

function loadGeneratedSearchContent(): readonly GeneratedSearchContentDocument[] {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "shared/search-content.generated.json"),
    join(moduleDirectory, "search-content.generated.json"),
    join(moduleDirectory, "../../shared/search-content.generated.json"),
  ];
  const path = candidates.find(existsSync);
  if (!path) return [];
  return JSON.parse(readFileSync(path, "utf8")) as GeneratedSearchContentDocument[];
}

const GENERATED_SEARCH_CONTENT = loadGeneratedSearchContent();

type NavigationDefinition = {
  portal: SearchPortal;
  view: string;
  titleKey?: string;
  namespace?: "chef" | "manager";
  title?: string;
  body: string;
  parent?: string;
};

const NAVIGATION_DOCUMENTS: NavigationDefinition[] = [
  { portal: "chef", view: "overview", namespace: "chef", titleKey: "shellOverview", body: "dashboard home status next steps progress", parent: "Chef portal" },
  { portal: "chef", view: "bookings", namespace: "chef", titleKey: "shellMyBookings", body: "booking reservations schedule check in check out dates reference codes", parent: "Chef portal" },
  { portal: "chef", view: "discover-kitchens", namespace: "chef", titleKey: "shellDiscoverKitchens", body: "find search commercial kitchens locations amenities equipment storage", parent: "Chef portal" },
  { portal: "chef", view: "kitchen-applications", namespace: "chef", titleKey: "shellMyKitchens", body: "kitchen access applications approvals locations", parent: "Chef portal" },
  { portal: "chef", view: "applications", namespace: "chef", titleKey: "shellMyApplication", body: "application certification food safety documents approval", parent: "Chef portal" },
  { portal: "chef", view: "messages", namespace: "chef", titleKey: "shellMessages", body: "chat conversations manager messages", parent: "Chef portal" },
  { portal: "chef", view: "training", namespace: "chef", titleKey: "shellTraining", body: "microlearning videos lessons certificates training progress", parent: "Chef portal" },
  { portal: "chef", view: "transactions", namespace: "chef", titleKey: "shellMyTransactions", body: "payments receipts charges refunds billing transactions", parent: "Chef portal" },
  { portal: "chef", view: "issues-refunds", namespace: "chef", titleKey: "shellResolutionCenter", body: "damage claims disputes overstay penalties issues refunds", parent: "Chef portal" },
  { portal: "chef", view: "profile", namespace: "chef", titleKey: "shellProfile", body: "account personal information settings password profile", parent: "Chef portal" },
  { portal: "manager", view: "overview", namespace: "manager", titleKey: "navDashboard", body: "dashboard overview business status activity", parent: "Manager portal" },
  { portal: "manager", view: "bookings", namespace: "manager", titleKey: "navBookings", body: "booking reservations calendar chefs check in check out reference codes", parent: "Manager portal" },
  { portal: "manager", view: "availability", namespace: "manager", titleKey: "navAvailability", body: "opening hours blocked dates schedule kitchen availability", parent: "Manager portal" },
  { portal: "manager", view: "pricing", namespace: "manager", titleKey: "navPricing", body: "rates fees hourly daily weekly kitchen pricing taxes", parent: "Manager portal" },
  { portal: "manager", view: "settings", namespace: "manager", titleKey: "cmdKitchenSettings", body: "location booking rules licence facility documents check in checkout policies", parent: "Manager portal" },
  { portal: "manager", view: "settings-license", title: "Kitchen licence", body: "licence upload expiry approval compliance", parent: "Kitchen settings" },
  { portal: "manager", view: "settings-facility-docs", title: "Facility documents", body: "floor plans ventilation specifications materials terms documents", parent: "Kitchen settings" },
  { portal: "manager", view: "settings-booking-rules", title: "Booking rules", body: "cancellation minimum window daily limits booking policies", parent: "Kitchen settings" },
  { portal: "manager", view: "storage-listings", namespace: "manager", titleKey: "cmdStorageListings", body: "cold freezer dry storage dimensions shelves temperature rules", parent: "Manager portal" },
  { portal: "manager", view: "equipment-listings", namespace: "manager", titleKey: "cmdEquipmentListings", body: "ovens mixers fryers appliances rentals equipment inventory", parent: "Manager portal" },
  { portal: "manager", view: "applications", namespace: "manager", titleKey: "navApplications", body: "chef applications documents approvals certifications", parent: "Manager portal" },
  { portal: "manager", view: "revenue", namespace: "manager", titleKey: "navRevenue", body: "earnings payouts sales revenue reports", parent: "Manager portal" },
  { portal: "manager", view: "payments", namespace: "manager", titleKey: "cmdPaymentsBilling", body: "Stripe payouts transactions charges refunds billing", parent: "Manager portal" },
  { portal: "manager", view: "messages", title: "Messages", body: "chat chef conversations communications", parent: "Manager portal" },
  { portal: "manager", view: "profile", namespace: "manager", titleKey: "shellProfile", body: "account contact information password profile", parent: "Manager portal" },
  { portal: "admin", view: "applications", title: "Chef applications", body: "applicant contact certification documents approval review", parent: "Admin" },
  { portal: "admin", view: "kitchen-licenses", title: "Kitchen licences", body: "manager location licence approval expiry compliance", parent: "Admin" },
  { portal: "admin", view: "damage-claims", title: "Damage claims", body: "evidence disputes chef response resolution charges", parent: "Admin" },
  { portal: "admin", view: "transactions", title: "Transactions", body: "payments Stripe charges refunds booking references", parent: "Admin" },
  { portal: "admin", view: "email-log", title: "Email log", body: "sent delivered failed messages communication history", parent: "Admin" },
  { portal: "admin", view: "platform-settings", title: "Platform settings", body: "fees policies configuration booking defaults", parent: "Admin" },
];

type DatabaseSearchRow = {
  type: "location" | "kitchen" | "storage" | "equipment";
  source_id: number;
  title: string;
  body: string;
  view: string;
  score: number | string;
  location_id: number;
  kitchen_id: number | null;
  kitchen_active: boolean | null;
  listing_status: string | null;
  kitchen_license_url: string | null;
  kitchen_license_status: string | null;
  kitchen_license_expiry: string | null;
  fuzzy: boolean;
};

function navigationResults(query: string, portal: SearchPortal, locale: AppLocale): GlobalSearchResult[] {
  return NAVIGATION_DOCUMENTS.flatMap((document) => {
    if (document.portal !== portal) return [];
    const title = document.titleKey
      ? tLocale(locale, document.titleKey, { ns: document.namespace })
      : document.title!;
    const searchableBody = `${title} ${document.body}`;
    const score = scoreStaticDocument(title, searchableBody, query);
    const fuzzy = !score && isLikelyTypo(title, query);
    if (!score && !fuzzy) return [];
    const baseUrl = portal === "chef" ? "/dashboard" : portal === "manager" ? "/manager/booking-dashboard" : "/admin";
    return [{
      id: `navigation:${portal}:${document.view}`,
      type: "navigation" as const,
      title,
      snippet: createSearchSnippet(document.body, query),
      url: `${baseUrl}?${portal === "admin" ? "section" : "view"}=${encodeURIComponent(document.view)}`,
      view: document.view,
      breadcrumb: [
        { label: document.parent ?? portal },
        { label: title },
      ],
      score: fuzzy ? 1 : score,
      fuzzy,
    }];
  });
}

function resourceResults(query: string, portal: SearchPortal, locale: AppLocale): GlobalSearchResult[] {
  const audiences = portal === "admin" ? ["manager"] : [portal];
  return GENERATED_SEARCH_CONTENT.flatMap((document) => {
    if (document.locale !== locale || !audiences.includes(document.audience)) return [];
    const score = scoreStaticDocument(document.title, document.body, query);
    const fuzzy = !score && isLikelyTypo(document.title, query);
    if (!score && !fuzzy) return [];
    const localizedPath = `/${document.locale}/resources`;
    return [{
      id: `resource:${document.id}`,
      type: "navigation" as const,
      title: document.title,
      snippet: createSearchSnippet(document.body, query),
      url: `${localizedPath}#${document.anchor}`,
      breadcrumb: [
        { label: document.collection, url: localizedPath },
        { label: document.title },
      ],
      score: fuzzy ? 0.8 : score + 0.5,
      fuzzy,
    }];
  });
}

export async function searchGlobally(options: {
  query: string;
  portal: SearchPortal;
  userId: number;
  locale: AppLocale;
  limit?: number;
}): Promise<GlobalSearchResult[]> {
  const { query, portal, userId, locale } = options;
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 20);
  const databaseLimit = Math.min(limit * 6, 120);
  const escapedQuery = query.toLowerCase().replace(/[\\%_]/g, "\\$&");
  const prefixPattern = `${escapedQuery}%`;
  const containsPattern = `%${escapedQuery}%`;

  const result = await pool.query<DatabaseSearchRow>(
    `WITH documents AS (
      SELECT 'location'::text AS type, l.id AS source_id, l.name AS title,
        l.id AS location_id, NULL::integer AS kitchen_id, NULL::boolean AS kitchen_active, NULL::text AS listing_status,
        l.kitchen_license_url, l.kitchen_license_status, l.kitchen_license_expiry::text,
        concat_ws(' ', l.address, l.description, l.cancellation_policy_message, l.overstay_policy_text) AS body,
        coalesce(l.name, '') || ' ' || coalesce(l.address, '') || ' ' || coalesce(l.description, '') || ' ' ||
          coalesce(l.cancellation_policy_message, '') || ' ' || coalesce(l.overstay_policy_text, '') AS searchable,
        coalesce(l.name, '') || ' ' || coalesce(l.address, '') || ' ' || coalesce(l.description, '') || ' ' ||
          coalesce(l.cancellation_policy_message, '') || ' ' || coalesce(l.overstay_policy_text, '') AS indexed_searchable,
        CASE WHEN $2 = 'admin' THEN 'kitchen-management' WHEN $2 = 'manager' THEN 'profile' ELSE 'discover-kitchens' END AS view
      FROM locations l
      WHERE $2 = 'admin'
        OR ($2 = 'manager' AND l.manager_id = $3)
        OR ($2 = 'chef' AND EXISTS (SELECT 1 FROM kitchens visible_k WHERE visible_k.location_id = l.id AND visible_k.is_active = true AND visible_k.listing_status = 'active'))
      UNION ALL
      SELECT 'kitchen', k.id, k.name,
        l.id, k.id, k.is_active, k.listing_status::text,
        l.kitchen_license_url, l.kitchen_license_status, l.kitchen_license_expiry::text,
        concat_ws(' ', l.name, l.address, k.description, k.amenities::text),
        coalesce(k.name, '') || ' ' || coalesce(k.description, '') || ' ' || coalesce(k.amenities::text, ''),
        coalesce(k.name, '') || ' ' || coalesce(k.description, ''),
        CASE WHEN $2 = 'admin' THEN 'kitchen-management' WHEN $2 = 'manager' THEN 'kitchens' ELSE 'discover-kitchens' END
      FROM kitchens k JOIN locations l ON l.id = k.location_id
      WHERE $2 = 'admin' OR ($2 = 'manager' AND l.manager_id = $3) OR ($2 = 'chef' AND k.is_active = true)
      UNION ALL
      SELECT 'storage', s.id, s.name,
        l.id, k.id, k.is_active, k.listing_status::text,
        l.kitchen_license_url, l.kitchen_license_status, l.kitchen_license_expiry::text,
        concat_ws(' ', l.name, k.name, s.storage_type::text, s.description, s.features::text,
          s.security_features::text, s.temperature_range, s.house_rules::text, s.prohibited_items::text),
        coalesce(s.name, '') || ' ' || coalesce(s.storage_type::text, '') || ' ' || coalesce(s.description, '') || ' ' ||
          coalesce(s.features::text, '') || ' ' || coalesce(s.security_features::text, '') || ' ' ||
          coalesce(s.temperature_range, '') || ' ' || coalesce(s.house_rules::text, '') || ' ' || coalesce(s.prohibited_items::text, ''),
        coalesce(s.name, '') || ' ' || coalesce(s.description, '') || ' ' || coalesce(s.temperature_range, ''),
        CASE WHEN $2 = 'admin' THEN 'kitchen-management' ELSE 'storage-listings' END
      FROM storage_listings s JOIN kitchens k ON k.id = s.kitchen_id JOIN locations l ON l.id = k.location_id
      WHERE $2 = 'admin' OR ($2 = 'manager' AND l.manager_id = $3)
        OR ($2 = 'chef' AND k.is_active = true AND s.is_active = true AND s.status::text IN ('approved', 'active'))
      UNION ALL
      SELECT 'equipment', e.id, btrim(coalesce(e.brand, '') || ' ' || coalesce(e.equipment_type, '')),
        l.id, k.id, k.is_active, k.listing_status::text,
        l.kitchen_license_url, l.kitchen_license_status, l.kitchen_license_expiry::text,
        concat_ws(' ', l.name, k.name, e.category::text, e.description, e.condition::text),
        coalesce(e.brand, '') || ' ' || coalesce(e.equipment_type, '') || ' ' || coalesce(e.category::text, '') || ' ' ||
          coalesce(e.description, '') || ' ' || coalesce(e.condition::text, ''),
        coalesce(e.brand, '') || ' ' || coalesce(e.equipment_type, '') || ' ' || coalesce(e.description, ''),
        CASE WHEN $2 = 'admin' THEN 'kitchen-management' ELSE 'equipment-listings' END
      FROM equipment_listings e JOIN kitchens k ON k.id = e.kitchen_id JOIN locations l ON l.id = k.location_id
      WHERE $2 = 'admin' OR ($2 = 'manager' AND l.manager_id = $3)
        OR ($2 = 'chef' AND k.is_active = true AND e.is_active = true AND e.status::text IN ('approved', 'active'))
    ), ranked AS (
      SELECT *,
        (CASE WHEN lower(title) = lower($1) THEN 12
          WHEN lower(title) LIKE $5 THEN 9
          WHEN lower(title) LIKE $6 THEN 7
          WHEN to_tsvector('simple', title) @@ websearch_to_tsquery('simple', $1) THEN 5
          WHEN to_tsvector('simple', searchable) @@ websearch_to_tsquery('simple', $1)
            OR lower(searchable) LIKE $6 THEN 4
          ELSE 1 END + LEAST(ts_rank_cd(to_tsvector('simple', searchable), websearch_to_tsquery('simple', $1)), 1)) AS score,
        NOT (to_tsvector('simple', searchable) @@ websearch_to_tsquery('simple', $1)
          OR lower(searchable) LIKE $6) AS fuzzy
      FROM documents
      WHERE to_tsvector('simple', indexed_searchable) @@ websearch_to_tsquery('simple', $1)
        OR lower(indexed_searchable) LIKE $6
        OR to_tsvector('simple', searchable) @@ websearch_to_tsquery('simple', $1)
        OR lower(searchable) LIKE $6
        OR (length($1) >= 4 AND lower(title) % lower($1))
    )
    SELECT type, source_id, title, body, view, score, fuzzy, location_id, kitchen_id, kitchen_active,
      listing_status, kitchen_license_url, kitchen_license_status, kitchen_license_expiry FROM ranked
    ORDER BY fuzzy ASC, score DESC, title ASC LIMIT $4`,
    [query, portal, userId, databaseLimit, prefixPattern, containsPattern],
  );

  const baseUrl = portal === "chef" ? "/dashboard" : portal === "manager" ? "/manager/booking-dashboard" : "/admin";
  const visibleRows = result.rows.filter((row) => portal !== "chef" ||
    (row.type === "location"
      ? licenseAllowsBookings({ kitchenLicenseUrl: row.kitchen_license_url, kitchenLicenseStatus: row.kitchen_license_status, kitchenLicenseExpiry: row.kitchen_license_expiry })
      : kitchenIsVisibleToChefs(
          { isActive: row.kitchen_active, listingStatus: row.listing_status },
          { kitchenLicenseUrl: row.kitchen_license_url, kitchenLicenseStatus: row.kitchen_license_status, kitchenLicenseExpiry: row.kitchen_license_expiry },
        )));
  const databaseResults: GlobalSearchResult[] = visibleRows.map((row) => ({
    id: `${row.type}:${row.source_id}`,
    type: row.type,
    title: row.title,
    snippet: createSearchSnippet(row.body, query),
    url: portal === "chef"
      ? `/kitchen-preview/${row.location_id}${row.kitchen_id ? `?kitchenId=${row.kitchen_id}` : ""}`
      : portal === "admin"
        ? `/admin/manage-locations?locationId=${row.location_id}`
        : `${baseUrl}?view=${encodeURIComponent(row.view)}${portal === "manager" && row.type === "location" ? "&tab=location" : ""}&locationId=${row.location_id}${row.kitchen_id ? `&kit=${row.kitchen_id}` : ""}${row.type === "storage" || row.type === "equipment" ? `&itemId=${row.source_id}` : ""}`,
    view: row.view,
    breadcrumb: [
      { label: portal === "chef" ? tLocale(locale, "shellDashboard", { ns: "chef" }) : portal === "manager" ? tLocale(locale, "navDashboard", { ns: "manager" }) : "Admin" },
      { label: row.type.charAt(0).toUpperCase() + row.type.slice(1) },
      { label: row.title },
    ],
    score: Number(row.score),
    fuzzy: row.fuzzy,
  }));

  return mergeSearchResults(
    databaseResults,
    [...navigationResults(query, portal, locale), ...resourceResults(query, portal, locale)],
    limit,
  );
}
