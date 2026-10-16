/** Terms and conditions section of Booking Policies: the kitchen's own PDF that chefs accept when booking. */
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { getDocumentFilename } from "@/lib/formatters";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { SettingsFileUpload } from "./SettingsFileUpload";
import { AuthenticatedDocumentLink } from "./AuthenticatedDocumentLink";
import { PolicySection } from "./PolicySection";

/** The kitchen's own terms PDF. Uploading saves on its own endpoint, so it is its own section and its own (only) action. */
export function KitchenTermsSection({ location, note }: {
  location: { id: number; kitchenTermsUrl?: string | null; kitchenTermsUploadedAt?: string | null };
  note?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [termsFile, setTermsFile] = useState<File | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const hasTerms = Boolean(location.kitchenTermsUrl);
  const showUpload = !hasTerms || isReplacing;

  const uploadTerms = useCallback(async () => {
    if (!termsFile) return;
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(tt("firebaseUserNotAvailable"));
      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append("file", termsFile);
      const uploadResponse = await fetch("/api/files/upload-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        body: formData,
      });
      if (!uploadResponse.ok) throw new Error((await uploadResponse.json().catch(() => ({}))).error || tt("failedToUploadTermsDoc"));
      const uploaded = await uploadResponse.json();
      const updateResponse = await fetch(`/api/manager/locations/${location.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kitchenTermsUrl: uploaded.url }),
      });
      if (!updateResponse.ok) throw new Error((await updateResponse.json().catch(() => ({}))).error || tt("failedToUploadTermsDoc"));
      setTermsFile(null);
      setIsReplacing(false);
      queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      toast({ title: mt("bpTermsUploaded"), description: mt("yourTermsAndConditionsHaveBeenUploadedSuccessfully") });
    } catch (error) {
      toast({ title: mt("bpUploadFailed"), description: error instanceof Error ? error.message : tt("failedToUploadTermsDoc"), variant: "destructive" });
      // Re-throw so the StatusButton can show its error state.
      throw error;
    }
  }, [termsFile, location.id, queryClient, toast]);
  const uploadAction = useStatusButton(uploadTerms);
  const closeUpload = () => { setTermsFile(null); setIsReplacing(false); };

  return (
    <PolicySection title={mt("bpTermsTitle")} testId="terms-section"
      description={<>{mt("bpTermsDescription")}{note ? <span className="mt-1 block text-xs">{note}</span> : null}</>}>
      {hasTerms && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{getDocumentFilename(location.kitchenTermsUrl) || mt("bpTermsTitle")}</p>
            {location.kitchenTermsUploadedAt && (
              <p className="text-xs text-muted-foreground">{mt("bpUploadedOn", { date: new Date(location.kitchenTermsUploadedAt).toLocaleDateString() })}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AuthenticatedDocumentLink url={location.kitchenTermsUrl}
              className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {mt("bpViewDocument")}<ExternalLink className="h-3.5 w-3.5" />
            </AuthenticatedDocumentLink>
            {!isReplacing && <Button variant="ghost" className="min-h-11" onClick={() => setIsReplacing(true)}>{mt("replace")}</Button>}
          </div>
        </div>
      )}
      {showUpload && (
        <div className={`space-y-3 px-4 py-3 ${hasTerms ? "border-t border-border" : ""}`}>
          <SettingsFileUpload id="terms-upload" accept=".pdf" file={termsFile} label={mt("chooseTermsAndConditions")}
            hint={mt("pDFOnlyMax5MB")} disabled={uploadAction.status === "loading"} onChange={setTermsFile} />
          {(termsFile || hasTerms || uploadAction.status !== "idle") && (
            <div className="flex flex-wrap justify-end gap-2">
              {hasTerms && <Button variant="ghost" className="min-h-11" onClick={closeUpload} disabled={uploadAction.status === "loading"}>{mt("cancel")}</Button>}
              {(termsFile || uploadAction.status !== "idle") && <StatusButton status={uploadAction.status} onClick={uploadAction.execute}
                labels={{ idle: hasTerms ? mt("replace") : mt("bpUploadTerms"), loading: mt("uploading"), success: mt("saved") }} />}
            </div>
          )}
        </div>
      )}
    </PolicySection>
  );
}
