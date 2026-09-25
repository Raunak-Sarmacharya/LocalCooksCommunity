import { InfoChip } from "@/components/chef/info-chip";
import { Check } from "lucide-react";

export function VerifiedDocumentChip({
  status,
  url,
  expiry,
}: {
  status?: string | null;
  url?: string | null;
  expiry?: string | null;
}) {
  if (!url || status !== "approved" || (expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) < Date.now() - 86400000))) return null;
  return <InfoChip variant="brand" icon={<Check />} title="Document verified">Verified</InfoChip>;
}
