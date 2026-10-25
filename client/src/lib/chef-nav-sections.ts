import { addIcon } from "@iconify/react";
import { KITCHEN_TOUR_ICON_NAME } from "@/components/ui/manager-icons";
import { CHEF_APPLICATION_ICON } from "@/components/ui/application-icons";
import { KITCHEN_ICON_NAME } from "@/components/ui/kitchen-icon";

addIcon("fluent:person-link-16-filled", {"width": 16, "height": 16, "body": "<path fill=\"currentColor\" d=\"M5.975 13.924C3.459 13.537 2 11.746 2 10v-.5A1.5 1.5 0 0 1 3.5 8h5a3.5 3.5 0 0 0-2.525 5.924M7 1.5A2.75 2.75 0 1 1 7 7a2.75 2.75 0 0 1 0-5.5M8.5 9a2.5 2.5 0 0 0 0 5H9a.5.5 0 0 0 0-1h-.5a1.5 1.5 0 0 1 0-3H9a.5.5 0 0 0 0-1zM12 9a.5.5 0 0 0 0 1h.5a1.5 1.5 0 0 1 0 3H12a.5.5 0 0 0 0 1h.5a2.5 2.5 0 0 0 0-5zm-4 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5\"/>"});

export type ChefNavItemId =
  | "overview"
  | "applications"
  | "training"
  | "seller-revenue"
  | "my-account"
  | "kitchen-applications"
  | "kitchen-requests"
  | "discover-kitchens"
  | "viewings"
  | "bookings"
  | "storage"
  | "messages"
  | "notifications"
  | "issues-refunds"
  | "transactions";

export type ChefNavItem = {
  id: ChefNavItemId;
  labelKey: string;
  /** Iconify id, e.g. mdi:view-dashboard-outline */
  icon: string;
  /** Pages that belong to this item: they light it up and show as tabs on its pages, never as sidebar rows. */
  members?: ChefNavItem[];
  /** The item's own page as the first tab (e.g. Kitchens › "Find"). */
  tabLabelKey?: string;
};

export type ChefNavSection = {
  id: string;
  titleKey?: string;
  items: ChefNavItem[];
};

/** Breadcrumb crumb; `navId` marks a sidebar parent — crumbs after it expand under that item. */
export type ChefBreadcrumb = {
  label: string;
  href?: string;
  onClick?: () => void;
  navId?: string;
};

/** Same hierarchy as ChefSidebar — single source for sidebar + breadcrumbs. Each item appears only once it is relevant (see use-chef-sidebar-hidden-items). */
export const chefNavSections: ChefNavSection[] = [
  {
    id: "section-main",
    items: [
      { id: "overview", labelKey: "shellHome", icon: "mdi:home-outline" },
      {
        id: "discover-kitchens", labelKey: "shellKitchens", icon: KITCHEN_ICON_NAME, tabLabelKey: "tabFind",
        members: [
          { id: "kitchen-requests", labelKey: "shellMyKitchens", icon: CHEF_APPLICATION_ICON },
          { id: "kitchen-applications", labelKey: "shellApprovedKitchens", icon: KITCHEN_ICON_NAME },
          { id: "viewings", labelKey: "shellKitchenTours", icon: KITCHEN_TOUR_ICON_NAME },
        ],
      },
      {
        id: "bookings", labelKey: "shellBookings", icon: "mdi:calendar-month-outline", tabLabelKey: "tabUpcoming",
        members: [{ id: "storage", labelKey: "shellStorage", icon: "mdi:warehouse" }],
      },
      {
        id: "applications", labelKey: "shellSelling", icon: "mdi:storefront-outline", tabLabelKey: "tabApplication",
        members: [
          { id: "training", labelKey: "shellTraining", icon: "mdi:school-outline" },
          { id: "seller-revenue", labelKey: "shellMyEarnings", icon: "mdi:cash-multiple" },
          { id: "my-account", labelKey: "shellLinkedAccounts", icon: "fluent:person-link-16-filled" },
        ],
      },
      { id: "messages", labelKey: "shellMessages", icon: "mdi:message-outline" },
      {
        id: "transactions", labelKey: "shellPayments", icon: "mdi:credit-card-outline", tabLabelKey: "tabReceipts",
        members: [{ id: "issues-refunds", labelKey: "shellResolutionCenter", icon: "mdi:alert-outline" }],
      },
    ],
  },
];

/** The sidebar item a view belongs to: itself, or the item that owns it. */
export function chefNavOwner(view: string): ChefNavItem | undefined {
  for (const section of chefNavSections) {
    const item = section.items.find((i) => i.id === view || i.members?.some((m) => m.id === view));
    if (item) return item;
  }
  return undefined;
}

export function findChefNavSectionForView(view: string): ChefNavSection | undefined {
  return chefNavSections.find((section) => section.items.some((item) => item.id === view || item.members?.some((member) => member.id === view)));
}
export function findChefNavItem(view: string): ChefNavItem | undefined {
  for (const section of chefNavSections) {
    const item = section.items.find((i) => i.id === view);
    if (item) return item;
    const member = section.items.flatMap((i) => i.members || []).find((i) => i.id === view);
    if (member) return member;
  }
  return undefined;
}

/** Crumbs after the active sidebar item — nested context under that item (never the item itself). */
export function sidebarBranchForView(
  breadcrumbs: ChefBreadcrumb[] | undefined,
  activeView: string
): ChefBreadcrumb[] {
  if (!breadcrumbs?.length) return [];
  // Last match wins when Dashboard/Overview both carry navId "overview"
  const idx = breadcrumbs.map((c) => c.navId).lastIndexOf(activeView);
  if (idx < 0) return [];
  return breadcrumbs
    .slice(idx + 1)
    .filter((c) => Boolean(c.label?.trim()) && c.navId !== activeView);
}
