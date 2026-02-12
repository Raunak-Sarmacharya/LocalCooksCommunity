/**
 * Shared Status Design System
 * 
 * Centralizes all status-to-color/icon mappings across the chef dashboard.
 * Import this instead of defining status configs inline per component.
 */

import {
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  Loader2,
  FileCheck,
  Ban,
  CreditCard,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type StatusCategory = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

export interface StatusConfig {
  label: string;
  category: StatusCategory;
  icon: LucideIcon;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  badgeClassName: string;
}

// Shared color classes per category
const categoryStyles: Record<StatusCategory, { badgeVariant: StatusConfig["badgeVariant"]; badgeClassName: string }> = {
  success: { badgeVariant: "default", badgeClassName: "bg-green-600 hover:bg-green-600 text-white border-green-600" },
  warning: { badgeVariant: "secondary", badgeClassName: "bg-amber-100 text-amber-800 border-amber-200" },
  danger: { badgeVariant: "destructive", badgeClassName: "" },
  info: { badgeVariant: "secondary", badgeClassName: "bg-blue-100 text-blue-800 border-blue-200" },
  neutral: { badgeVariant: "outline", badgeClassName: "bg-muted text-muted-foreground" },
  accent: { badgeVariant: "secondary", badgeClassName: "bg-purple-100 text-purple-800 border-purple-200" },
};

function makeStatus(label: string, category: StatusCategory, icon: LucideIcon): StatusConfig {
  const style = categoryStyles[category];
  return { label, category, icon, badgeVariant: style.badgeVariant, badgeClassName: style.badgeClassName };
}

// ── Application Statuses ──
export const applicationStatuses: Record<string, StatusConfig> = {
  approved: makeStatus("Approved", "success", CheckCircle),
  inReview: makeStatus("In Review", "warning", Clock),
  rejected: makeStatus("Rejected", "danger", XCircle),
  cancelled: makeStatus("Cancelled", "neutral", Ban),
  pending: makeStatus("Pending", "warning", Clock),
};

// ── Kitchen Booking Statuses ──
export const kitchenBookingStatuses: Record<string, StatusConfig> = {
  pending: makeStatus("Pending Approval", "warning", Clock),
  confirmed: makeStatus("Confirmed", "success", CheckCircle),
  completed: makeStatus("Completed", "success", ShieldCheck),
  cancelled: makeStatus("Declined", "danger", XCircle),
  cancellation_requested: makeStatus("Cancel Requested", "warning", AlertTriangle),
};

// ── Storage Booking Statuses ──
export const storageBookingStatuses: Record<string, StatusConfig> = {
  pending: makeStatus("Pending Approval", "warning", Clock),
  confirmed: makeStatus("Active", "success", CheckCircle),
  completed: makeStatus("Cleared", "success", ShieldCheck),
  cancelled: makeStatus("Cancelled", "neutral", XCircle),
};

// ── Payment Statuses ──
export const paymentStatuses: Record<string, StatusConfig> = {
  succeeded: makeStatus("Paid", "success", CheckCircle),
  paid: makeStatus("Paid", "success", CheckCircle),
  pending: makeStatus("Pending", "warning", Clock),
  processing: makeStatus("Processing", "info", Loader2),
  failed: makeStatus("Failed", "danger", XCircle),
  refunded: makeStatus("Refunded", "accent", CreditCard),
  partially_refunded: makeStatus("Partial Refund", "accent", CreditCard),
  canceled: makeStatus("No Charge", "neutral", Ban),
};

// ── Document Statuses ──
export const documentStatuses: Record<string, StatusConfig> = {
  approved: makeStatus("Approved", "success", CheckCircle),
  pending: makeStatus("Pending", "warning", Clock),
  rejected: makeStatus("Rejected", "danger", XCircle),
  not_uploaded: makeStatus("Not Uploaded", "neutral", FileCheck),
};

// ── Damage Claim Statuses ──
export const damageClaimStatuses: Record<string, StatusConfig> = {
  submitted: makeStatus("Awaiting Response", "warning", AlertTriangle),
  chef_accepted: makeStatus("Accepted", "info", CheckCircle),
  chef_disputed: makeStatus("Disputed", "danger", XCircle),
  under_review: makeStatus("Under Review", "info", Clock),
  approved: makeStatus("Approved", "warning", CheckCircle),
  partially_approved: makeStatus("Partially Approved", "warning", CheckCircle),
  rejected: makeStatus("Rejected", "neutral", XCircle),
  charge_pending: makeStatus("Payment Processing", "info", Loader2),
  charge_succeeded: makeStatus("Charged", "danger", CreditCard),
  charge_failed: makeStatus("Charge Failed", "neutral", XCircle),
  escalated: makeStatus("Payment Required", "danger", AlertTriangle),
  resolved: makeStatus("Resolved", "neutral", CheckCircle),
  expired: makeStatus("Expired", "neutral", Clock),
};

/**
 * Generic lookup — returns the config or a neutral fallback.
 */
export function getStatusConfig(
  statusMap: Record<string, StatusConfig>,
  status: string
): StatusConfig {
  return statusMap[status] || makeStatus(status, "neutral", Clock);
}
