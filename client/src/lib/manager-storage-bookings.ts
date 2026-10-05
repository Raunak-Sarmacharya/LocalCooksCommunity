export interface ManagerStorageBooking {
  id: number;
  kitchenBookingId?: number | null;
  chefId?: number | null;
  referenceCode: string | null;
  storageName: string;
  storageType: string;
  kitchenName: string;
  locationName: string;
  chefName: string;
  startDate: string;
  endDate: string;
  status: string;
  totalPrice: string | number;
  currency: string;
  createdAt: string;
  updatedAt?: string;
  assistanceHistory?: Array<{ actorId: number; action: string; reason: string; actualAt?: string; recordedAt: string }>;
}

export function inheritStorageChef<T extends { id: number; kitchenBookingId?: number | null; chefId?: number | null; chefName?: string }>(rows: T[], parents: Array<{ id: number; chefId?: number; chefName?: string; storageItems?: Array<{ id: number; storageBookingId?: number }> }>): T[] {
  const byBooking = new Map(parents.map(parent => [parent.id, parent]));
  const byStorage = new Map<number, typeof parents[number]>();
  for (const parent of parents) for (const item of parent.storageItems ?? []) byStorage.set(item.storageBookingId ?? item.id, parent);
  return rows.map(row => {
    const parent = row.kitchenBookingId ? byBooking.get(row.kitchenBookingId) : byStorage.get(row.id);
    if (!parent?.chefName?.trim() || parent.chefName.includes("@")) return row;
    return { ...row, chefName: parent.chefName.trim(), chefId: parent.chefId ?? row.chefId };
  });
}

export function filterManagerStorageBookings(
  bookings: ManagerStorageBooking[],
  status: string,
  location: string,
  now = new Date(),
) {
  return bookings.filter((booking) => {
    if (location !== "all" && booking.locationName !== location) return false;
    if (status === "all") return true;
    if (status === "upcoming") {
      return !["cancelled", "completed"].includes(booking.status) && new Date(booking.endDate) >= now;
    }
    if (status === "past") {
      return ["cancelled", "completed"].includes(booking.status) || new Date(booking.endDate) < now;
    }
    return booking.status === status;
  });
}
