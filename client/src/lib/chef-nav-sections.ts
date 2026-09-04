export type ChefNavItemId =
  | "overview"
  | "applications"
  | "training"
  | "seller-revenue"
  | "my-account"
  | "kitchen-applications"
  | "discover-kitchens"
  | "bookings"
  | "messages"
  | "issues-refunds";

export type ChefNavItem = {
  id: ChefNavItemId;
  labelKey: string;
  /** Iconify MDI id, e.g. mdi:view-dashboard-outline */
  icon: string;
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

/** Same hierarchy as ChefSidebar — single source for sidebar + breadcrumbs. */
export const chefNavSections: ChefNavSection[] = [
  {
    id: "section-home",
    items: [
      { id: "overview", labelKey: "shellOverview", icon: "mdi:view-dashboard-outline" },
      { id: "applications", labelKey: "shellMyApplication", icon: "mdi:file-document-outline" },
      { id: "training", labelKey: "shellTraining", icon: "mdi:school-outline" },
    ],
  },
  {
    id: "section-selling",
    titleKey: "shellSelling",
    items: [
      { id: "seller-revenue", labelKey: "shellMyEarnings", icon: "mdi:cash-multiple" },
      { id: "my-account", labelKey: "shellLinkedAccounts", icon: "mdi:storefront-outline" },
    ],
  },
  {
    id: "section-kitchens",
    titleKey: "shellKitchens",
    items: [
      { id: "kitchen-applications", labelKey: "shellMyKitchens", icon: "mdi:office-building-outline" },
      { id: "discover-kitchens", labelKey: "shellDiscoverKitchens", icon: "mdi:magnify" },
      { id: "bookings", labelKey: "shellMyBookings", icon: "mdi:calendar-month-outline" },
    ],
  },
  {
    id: "section-inbox",
    titleKey: "shellInbox",
    items: [
      { id: "messages", labelKey: "shellMessages", icon: "mdi:message-outline" },
      { id: "issues-refunds", labelKey: "shellResolutionCenter", icon: "mdi:alert-outline" },
    ],
  },
];

export function findChefNavSectionForView(view: string): ChefNavSection | undefined {
  return chefNavSections.find((section) => section.items.some((item) => item.id === view));
}

export function findChefNavItem(view: string): ChefNavItem | undefined {
  for (const section of chefNavSections) {
    const item = section.items.find((i) => i.id === view);
    if (item) return item;
  }
  return undefined;
}

/** Crumbs after the active sidebar item — shown as a nested drawer under that item. */
export function sidebarBranchForView(
  breadcrumbs: ChefBreadcrumb[] | undefined,
  activeView: string
): ChefBreadcrumb[] {
  if (!breadcrumbs?.length) return [];
  const idx = breadcrumbs.findIndex((c) => c.navId === activeView);
  if (idx < 0) return [];
  return breadcrumbs.slice(idx + 1).filter((c) => Boolean(c.label?.trim()));
}
