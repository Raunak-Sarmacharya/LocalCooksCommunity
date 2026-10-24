interface WorkspaceCounts {
  publishedKitchens: number;
  bookings: number;
  tours: number;
  /** Listed kitchens with tours switched on. */
  tourKitchens: number;
  toursNeedingAction: number;
  storageBookings: number;
  storageInventory: number;
  applications: number;
  payments: number;
}

export function managerWorkspaceVisibility(counts: WorkspaceCounts) {
  const hasRevenueHistory = counts.bookings > 0 || counts.storageBookings > 0 || counts.payments > 0;
  return {
    showBookings: counts.publishedKitchens > 0 || counts.bookings > 0,
    // Like Bookings and Storage: shown once tours are switched on for a listed kitchen, or while any tour exists (owner, Oct 24).
    showTours: counts.tourKitchens > 0 || counts.tours > 0,
    toursNeedingAction: counts.toursNeedingAction,
    showStorageBookings: counts.storageInventory > 0 || counts.storageBookings > 0,
    showApplications: counts.publishedKitchens > 0 || counts.applications > 0,
    showRevenue: counts.publishedKitchens > 0 || hasRevenueHistory,
    hasRevenueHistory,
  };
}
