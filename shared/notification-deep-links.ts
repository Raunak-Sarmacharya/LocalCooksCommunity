/**
 * Canonical in-app notification deep links + legacy URL normalization.
 * Used by notification.service (write) and notification centers (click).
 */

export type NotificationRole = "chef" | "manager";

export function chefDashboardView(view: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ view, ...extra });
  return `/dashboard?${params.toString()}`;
}

export function managerDashboardView(view: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ view, ...extra });
  return `/manager/dashboard?${params.toString()}`;
}

export function chefBookingHref(bookingId: number | string): string {
  return `/booking/${bookingId}`;
}

export function managerBookingHref(bookingId: number | string): string {
  return `/manager/booking/${bookingId}`;
}

export function chefMessagesHref(conversationId?: string): string {
  return conversationId
    ? chefDashboardView("messages", { conversation: conversationId })
    : chefDashboardView("messages");
}

export function managerMessagesHref(conversationId?: string): string {
  return conversationId
    ? managerDashboardView("messages", { conversation: conversationId })
    : managerDashboardView("messages");
}

export function chefIssuesHref(tab?: "damage-claims" | "overstay-penalties"): string {
  return tab
    ? chefDashboardView("issues-refunds", { tab })
    : chefDashboardView("issues-refunds");
}

/** Legacy chef ?view= aliases → current shell views. */
const CHEF_VIEW_ALIASES: Record<string, string> = {
  discover: "discover-kitchens",
  payments: "issues-refunds",
  storage: "bookings",
  claims: "issues-refunds",
  "damage-claims": "issues-refunds",
};

/** Legacy manager ?view= aliases. */
const MANAGER_VIEW_ALIASES: Record<string, string> = {
  storage: "storage-checkouts",
};

/**
 * Normalize a stored action_url so clicks land on current routes.
 * Returns null for empty input.
 */
export function normalizeNotificationActionUrl(actionUrl: string | null | undefined): string | null {
  if (!actionUrl || !actionUrl.trim()) return null;

  let url = actionUrl.trim();

  // Absolute same-origin paths sometimes stored with host — keep path+search only.
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      url = `${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    // keep as-is
  }

  // External payment / 3DS URLs — leave alone.
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  // Legacy manager booking-dashboard → manager/dashboard
  if (url.startsWith("/manager/booking-dashboard")) {
    url = url.replace("/manager/booking-dashboard", "/manager/dashboard");
  }

  // Broken placeholder from old message-received route
  if (url === "/manager/booking/:id" || url.startsWith("/manager/applications?chat=")) {
    return managerMessagesHref();
  }

  const qIndex = url.indexOf("?");
  const path = qIndex >= 0 ? url.slice(0, qIndex) : url;
  const search = qIndex >= 0 ? url.slice(qIndex + 1) : "";

  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    const params = new URLSearchParams(search);
    const view = params.get("view");
    if (view && CHEF_VIEW_ALIASES[view]) {
      params.set("view", CHEF_VIEW_ALIASES[view]);
      return `${path}?${params.toString()}`;
    }
    return url;
  }

  if (path === "/manager/dashboard" || path.startsWith("/manager/dashboard/")) {
    const params = new URLSearchParams(search);
    const view = params.get("view");
    if (view && MANAGER_VIEW_ALIASES[view]) {
      params.set("view", MANAGER_VIEW_ALIASES[view]);
      return `${path}?${params.toString()}`;
    }
    return url;
  }

  return url;
}

type Meta = Record<string, unknown> | null | undefined;

function metaNum(meta: Meta, key: string): number | undefined {
  const v = meta?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function metaStr(meta: Meta, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Resolve the best href for a notification: normalize stored URL, else infer from type+metadata.
 */
export function resolveNotificationHref(opts: {
  role: NotificationRole;
  type?: string | null;
  actionUrl?: string | null;
  metadata?: Meta;
}): string | null {
  const normalized = normalizeNotificationActionUrl(opts.actionUrl);
  if (normalized) return normalized;

  const type = opts.type || "";
  const meta = opts.metadata;
  const bookingId = metaNum(meta, "bookingId");
  const conversationId = metaStr(meta, "conversationId");
  const locationId = metaNum(meta, "locationId");

  if (opts.role === "chef") {
    if (conversationId || type === "message_received") return chefMessagesHref(conversationId);
    if (bookingId && (type.startsWith("booking_") || type.startsWith("kitchen_") || type === "payment_received")) {
      return chefBookingHref(bookingId);
    }
    if (type.startsWith("damage_claim") || type === "storage_checkout_claim_filed") {
      return chefIssuesHref("damage-claims");
    }
    if (type.startsWith("overstay_") || type === "payment_refunded") {
      return chefIssuesHref("overstay-penalties");
    }
    if (type.startsWith("storage_") || type.includes("storage")) {
      return chefDashboardView("bookings");
    }
    if (type.startsWith("application_") || type === "welcome") {
      if (type === "welcome") return chefDashboardView("discover-kitchens");
      if (type === "application_approved" && locationId) return `/kitchen-requirements/${locationId}`;
      return chefDashboardView("kitchen-applications");
    }
    if (type === "training_reminder") return chefDashboardView("training");
    if (type.includes("viewing")) return chefDashboardView("viewings");
    return chefDashboardView("overview");
  }

  // manager
  if (conversationId || type === "message_received") return managerMessagesHref(conversationId);
  if (bookingId && (type.startsWith("booking_") || type.startsWith("kitchen_"))) {
    return managerBookingHref(bookingId);
  }
  if (type.startsWith("damage_claim")) return managerDashboardView("damage-claims");
  if (type.startsWith("overstay_")) return managerDashboardView("overstays");
  if (type.startsWith("storage_checkout") || type === "storage_extension_approved") {
    return managerDashboardView("storage-checkouts");
  }
  if (type.startsWith("application_") || type === "application_new") {
    return managerDashboardView("applications");
  }
  if (type.startsWith("license_")) return managerDashboardView("settings");
  if (type.includes("viewing")) return managerDashboardView("viewings");
  if (type === "payment_received" || type === "payment_failed") {
    return managerDashboardView("revenue");
  }
  return managerDashboardView("overview");
}
