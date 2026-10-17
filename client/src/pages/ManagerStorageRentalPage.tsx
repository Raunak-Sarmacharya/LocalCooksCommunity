/**
 * `/manager/storage/:id` — one storage rental, wrapped in the shared manager shell so the sidebar,
 * header and notifications are present on desktop and on a phone.
 */
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { ManagerShell } from "@/layouts/ManagerShell";
import { StorageRentalDetail } from "@/components/manager/storage/StorageRentalDetail";

export default function ManagerStorageRentalPage() {
  const { t } = useTranslation("storage");
  const params = useParams<{ id: string }>();
  return (
    <ManagerShell activeView="storage-bookings" title={t("stBoardTitle")}>
      <StorageRentalDetail rentalId={Number(params.id)} />
    </ManagerShell>
  );
}
