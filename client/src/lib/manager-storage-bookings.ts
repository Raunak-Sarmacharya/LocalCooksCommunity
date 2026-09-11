export interface ManagerStorageBooking {
  id: number;
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
