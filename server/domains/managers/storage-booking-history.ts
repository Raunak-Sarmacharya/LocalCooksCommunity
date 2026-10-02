interface StorageHistoryRow {
  id: number;
  kitchenBookingId?: number | null;
  chefId?: number | null;
  referenceCode: string | null;
  storageName: string;
  storageType: string;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  locationName: string;
  chefName: string;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
  totalPrice: string | number;
  currency: string | null;
  createdAt: Date | string;
}
interface KitchenHistory {
  id?: number;
  chefId?: number | null;
  status: string;
  storageItems: unknown;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  locationName: string;
  chefName: string | null;
  currency: string | null;
  createdAt: Date;
}

// Deleted inventory can cascade-delete a storage row. The parent booking's
// immutable add-on snapshot still documents its cancelled history.
export function includeCancelledStorageHistory(rows: StorageHistoryRow[], parents: KitchenHistory[]): StorageHistoryRow[] {
  const history = new Map(rows.map((row) => [row.id, row]));
  for (const parent of parents) {
    if (!Array.isArray(parent.storageItems)) continue;
    for (const item of parent.storageItems) {
      if (!item || typeof item !== "object" || !Number.isInteger(item.id) || item.id <= 0 || history.has(item.id)) continue;
      if (item.status !== "cancelled" && parent.status !== "cancelled") continue;
      if (typeof item.startDate !== "string" || typeof item.endDate !== "string" ||
        !Number.isFinite(Date.parse(item.startDate)) || !Number.isFinite(Date.parse(item.endDate))) continue;
      history.set(item.id, {
        id: item.id, kitchenBookingId: parent.id, chefId: parent.chefId, referenceCode: null, storageName: item.name ?? "—", storageType: item.storageType ?? "—",
        kitchenId: parent.kitchenId, kitchenName: parent.kitchenName,
        locationId: parent.locationId, locationName: parent.locationName, chefName: parent.chefName ?? "—",
        startDate: item.startDate, endDate: item.endDate, status: "cancelled",
        totalPrice: item.totalPrice ?? 0, currency: parent.currency, createdAt: parent.createdAt,
      });
    }
  }
  return Array.from(history.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
