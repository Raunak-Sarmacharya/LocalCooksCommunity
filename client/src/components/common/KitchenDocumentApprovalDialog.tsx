import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InfoChip } from "@/components/chef/info-chip";

export type KitchenDocumentField = "foodSafetyLicenseStatus" | "foodEstablishmentCertStatus";

type DocumentState = {
  foodSafetyLicenseUrl?: string | null;
  foodSafetyLicenseExpiry?: string | null;
  foodSafetyLicenseStatus?: string | null;
  foodEstablishmentCertUrl?: string | null;
  foodEstablishmentCertExpiry?: string | null;
  foodEstablishmentCertStatus?: string | null;
};

type KitchenRequirements = {
  requireFoodHandlerCert?: boolean;
  tier2_food_establishment_cert_required?: boolean;
} | null | undefined;

export function getKitchenDocumentApprovalPlan(application: DocumentState, requirements: KitchenRequirements) {
  const toVerify: { field: KitchenDocumentField; label: string }[] = [];
  const issues: string[] = [];
  const documents = [
    { label: "Food Safety Certificate", field: "foodSafetyLicenseStatus" as const, url: application.foodSafetyLicenseUrl, expiry: application.foodSafetyLicenseExpiry, status: application.foodSafetyLicenseStatus, required: requirements?.requireFoodHandlerCert, needsExpiry: true },
    { label: "Food Establishment Licence", field: "foodEstablishmentCertStatus" as const, url: application.foodEstablishmentCertUrl, expiry: application.foodEstablishmentCertExpiry, status: application.foodEstablishmentCertStatus, required: requirements?.tier2_food_establishment_cert_required, needsExpiry: false },
  ];
  for (const document of documents) {
    if (!document.url) {
      if (document.required) issues.push(`${document.label}: ask the chef to upload the document.`);
    } else if (document.needsExpiry && (!document.expiry || !Number.isFinite(Date.parse(document.expiry)))) {
      issues.push(`${document.label}: ask the chef to provide a valid expiry date.`);
    } else if (document.expiry && Date.parse(document.expiry) < Date.now() - 86400000) {
      issues.push(`${document.label}: the document has expired; ask the chef for a replacement.`);
    } else if (document.status === "rejected") {
      issues.push(`${document.label}: a replacement is needed before approval.`);
    } else if (document.status !== "approved") {
      toVerify.push({ field: document.field, label: document.label });
    }
  }
  return { toVerify, issues };
}

export function KitchenDocumentApprovalDialog({
  open,
  onOpenChange,
  issues,
  toVerify,
  onVerifyAndApprove,
  processing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: string[];
  toVerify: { field: KitchenDocumentField; label: string }[];
  onVerifyAndApprove: () => void;
  processing: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl p-5 sm:p-6">
        <AlertDialogHeader>
          <InfoChip variant="brand" className="mb-1 w-fit">Document review</InfoChip>
          <AlertDialogTitle>Review documents before approval</AlertDialogTitle>
          <AlertDialogDescription>
            Approval lets this chef book the kitchen. Check each uploaded document before confirming.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {issues.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-medium text-foreground">What needs attention</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
          </div>
        )}
        {toVerify.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-sm font-medium text-foreground">Uploaded documents awaiting review</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{toVerify.map((document) => <li key={document.field}>{document.label}</li>)}</ul>
            <p className="mt-3 text-xs text-muted-foreground">Choose “Verify and approve” only after opening and checking each file. This records the documents as verified for this kitchen and grants kitchen access.</p>
          </div>
        )}
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel disabled={processing} className="rounded-xl">Review documents</AlertDialogCancel>
          {issues.length === 0 && toVerify.length > 0 && (
            <Button disabled={processing} onClick={onVerifyAndApprove} className="rounded-xl">
              {processing ? "Verifying documents…" : "Verify and approve"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
