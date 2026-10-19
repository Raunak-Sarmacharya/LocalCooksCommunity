/**
 * `/manager/storage/:id` — one storage rental, wrapped in the shared manager shell so the sidebar,
 * header and notifications are present on desktop and on a phone.
 */
import { useParams } from "wouter";
import { ManagerShell } from "@/layouts/ManagerShell";
import { StorageRentalDetail } from "@/components/manager/storage/StorageRentalDetail";

export default function ManagerStorageRentalPage() {
  const params = useParams<{ id: string }>();
  return (
    <ManagerShell activeView="storage-bookings">
      <StorageRentalDetail rentalId={Number(params.id)} />
    </ManagerShell>
  );
}
