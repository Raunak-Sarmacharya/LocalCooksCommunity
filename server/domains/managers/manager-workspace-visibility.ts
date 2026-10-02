interface WorkspaceCounts {
  publishedKitchens: number;
  bookings: number;
  tours: number;
  storageBookings: number;
  storageInventory: number;
  applications: number;
  payments: number;
}

export function managerWorkspaceVisibility(counts: WorkspaceCounts) {
  const hasRevenueHistory = counts.bookings > 0 || counts.storageBookings > 0 || counts.payments > 0;
  return {
    showBookings: counts.publishedKitchens > 0 || counts.bookings > 0 || counts.tours > 0,
    showStorageBookings: counts.storageInventory > 0 || counts.storageBookings > 0,
    showApplications: counts.publishedKitchens > 0 || counts.applications > 0,
    showRevenue: counts.publishedKitchens > 0 || hasRevenueHistory,
    hasRevenueHistory,
  };
}
