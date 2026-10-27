import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { InfoChip } from "@/components/chef/info-chip";
import { kitchenLicenceOnFile, sellerDocuments } from "@shared/seller-application";
import { useApplicationForm } from "./ApplicationFormContext";
import { ApplicationStepFooter } from "./ApplicationStepFooter";
import { ApplyDocumentRow, DocumentName } from "./SellerDocumentRow";

type Slot = "foodSafetyLicense" | "foodEstablishmentCert";

/** Step 3: upload what they have, or say they don't have it yet. Nothing here blocks sending (owner, Oct 27). */
export default function CertificationsForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData, setIsBusy } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<Partial<Record<Slot, { url: string; name: string }>>>({});
  const [missing, setMissing] = useState<Partial<Record<Slot, boolean>>>({});
  const [checked, setChecked] = useState(false);
  const [feedback, setFeedback] = useState(formData.feedback || "");

  const shape = { status: "inReview", kitchenPreference: formData.kitchenPreference || "notSure", commercialKitchen: formData.commercialKitchen };
  const docs = sellerDocuments(shape);
  const unanswered = docs.filter((doc) => !files[doc.field] && !missing[doc.field]);

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error(t("sell_signInAgain"));
      // Kept from the old form: a "Request to apply" that sent them here names the kitchen they came from.
      const redirect = new URLSearchParams(window.location.search).get("redirect");
      const intendedLocationId = redirect?.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/(.+)/)?.[1];
      const response = await fetch("/api/firebase/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullName: formData.fullName, email: formData.email, phone: formData.phone,
          kitchenPreference: shape.kitchenPreference, commercialKitchen: formData.commercialKitchen,
          contactMethod: formData.contactMethod, contactTime: formData.contactTime, foodTypes: formData.foodTypes ?? [],
          foodSafetyLicense: files.foodSafetyLicense ? "yes" : "no", foodEstablishmentCert: files.foodEstablishmentCert ? "yes" : "no",
          foodSafetyLicenseUrl: files.foodSafetyLicense?.url ?? "", foodEstablishmentCertUrl: files.foodEstablishmentCert?.url ?? "",
          feedback, intendedLocationId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || data?.error || t("sell_sendFailed"));
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
      navigate("/dashboard?view=applications&sent=1");
    },
    onError: (error: Error) => {
      logger.error("Seller application submission failed", error);
      toast({ title: t("sell_sendFailedTitle"), description: error.message, variant: "destructive" });
    },
  });

  const busy = isPending || isSuccess;
  useEffect(() => { setIsBusy(busy); return () => setIsBusy(false); }, [busy, setIsBusy]);

  return (
    <form data-testid="seller-application-step-3" aria-busy={busy} className="space-y-6" onSubmit={(event) => {
      event.preventDefault();
      setChecked(true);
      if (busy || unanswered.length) return;
      updateFormData({ feedback });
      mutate();
    }}>
      <div className="divide-y rounded-xl bg-background shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        {docs.map((doc) => (
          <ApplyDocumentRow key={doc.field} doc={doc} fileName={files[doc.field]?.name} missing={Boolean(missing[doc.field])}
            invalid={checked && unanswered.includes(doc)}
            onUploaded={(url, name) => { setFiles((prev) => ({ ...prev, [doc.field]: { url, name } })); setMissing((prev) => ({ ...prev, [doc.field]: false })); }}
            onRemove={() => setFiles((prev) => ({ ...prev, [doc.field]: undefined }))}
            onMissing={(value) => setMissing((prev) => ({ ...prev, [doc.field]: value }))} />
        ))}
        {kitchenLicenceOnFile(shape) && (
          <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:px-5">
            <DocumentName kind="establishmentLicence" />
            <InfoChip tone="success" className="justify-self-start sm:justify-self-end">{t("sell_notNeeded")}</InfoChip>
          </div>
        )}
      </div>
      {checked && unanswered.length > 0 && <p role="alert" className="text-sm text-destructive">{t("sell_answerEachDocument")}</p>}
      {docs.some((doc) => missing[doc.field]) && <p className="text-sm text-muted-foreground">{t("sell_missingIsFine")}</p>}

      <div className="space-y-2">
        <label htmlFor="seller-feedback" className="text-sm font-medium">{t("sell_anythingElse")} <span className="font-normal text-muted-foreground">{t("sell_optional")}</span></label>
        <Textarea id="seller-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} maxLength={2000} placeholder={t("sell_anythingElsePlaceholder")} />
      </div>

      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{t("sell_sending")}</p>}
      <ApplicationStepFooter showPrevious showContinueArrow={false} continueLabel={t("sell_send")} continueTestId="seller-application-submit" />
    </form>
  );
}
