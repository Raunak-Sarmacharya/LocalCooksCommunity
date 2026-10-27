/**
 * Admin › seller application (owner mock, Oct 27): who to call and how, what they plan to sell and where, the documents
 * for that kitchen setting, and the three decisions: approve (with or without documents), request documents, reject.
 */
import { useState, type ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { SELLER_DOCUMENT_NAMES, sellerDocuments, sellerProgress, type SellerDocument } from "@shared/seller-application";
import type { Application, SellerDocumentKey } from "@shared/schema";

const CONTACT = { call: "Call", text: "Text", email: "Email" } as const;
const TIME = { morning: "mornings", afternoon: "afternoons", evening: "evenings", any: "any time" } as const;
const FOOD = { meat_fish: "meals with meat or fish", vegetarian: "vegetarian meals", baked: "baked goods", desserts: "desserts", preserves: "sauces and preserves", other: "something else" } as const;
const KITCHEN = { commercial_localcooks: "A Local Cooks kitchen", commercial_other: "Another licensed kitchen", home: "Their home kitchen", notSure: "Not sure yet" } as const;
const STATE: Record<SellerDocument["state"], { label: string; className: string }> = {
  missing: { label: "Not on file", className: "bg-muted text-muted-foreground" },
  requested: { label: "Requested", className: "bg-primary/10 text-primary" },
  uploaded: { label: "To review", className: "bg-amber-50 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-800" },
  rejected: { label: "Needs another file", className: "bg-primary/10 text-primary" },
};

async function adminFetch(method: string, url: string, body: unknown) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || response.statusText);
  return data as Application;
}

export function SellerApplicationReview({ application: app, onChanged, onOpenDocument, onDocumentStatus, onStatus, statusBusy, shopSection }: {
  application: Application;
  onChanged: (updated: Application) => void;
  onOpenDocument: (url: string) => void;
  onDocumentStatus: (field: "foodSafetyLicenseStatus" | "foodEstablishmentCertStatus", status: "approved" | "rejected") => void;
  onStatus: (status: "approved" | "rejected") => void;
  statusBusy?: boolean;
  shopSection?: ReactNode;
}) {
  const { toast } = useToast();
  const docs = sellerDocuments(app);
  const open = app.status === "inReview" || app.status === "approved";
  const kitchenValue = app.kitchenPreference === "commercial" ? `commercial_${app.commercialKitchen === "localcooks" ? "localcooks" : "other"}` : app.kitchenPreference;
  const missing = docs.filter((doc) => !doc.url && !doc.recommended);
  const homeWithMeat = app.kitchenPreference === "home" && app.foodTypes?.includes("meat_fish");

  const changeKitchen = async (value: string) => {
    const [kitchenPreference, commercialKitchen] = value.split("_");
    try { onChanged(await adminFetch("PATCH", `/api/applications/${app.id}/kitchen`, { kitchenPreference, commercialKitchen: commercialKitchen ?? null })); }
    catch (error) { toast({ title: "Couldn't change the kitchen setting", description: (error as Error).message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span>Reach by <b className="font-semibold text-foreground">{app.contactMethod ? `${CONTACT[app.contactMethod]}${app.contactTime ? `, ${TIME[app.contactTime]}` : ""}` : "not given"}</b></span>
        <a href={`tel:${app.phone}`} className="font-semibold text-foreground underline-offset-4 hover:underline">{app.phone}</a>
        <a href={`mailto:${app.email}`} className="text-foreground underline-offset-4 hover:underline">{app.email}</a>
      </div>

      {homeWithMeat && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Home kitchen with meals that have meat or fish. NL doesn't allow these to be made at home for sale; worth raising on the call (a Local Cooks kitchen solves it).
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Kitchen</h3>
          <Select value={kitchenValue} onValueChange={(value) => void changeKitchen(value)} disabled={!open}>
            <SelectTrigger className="mt-2 h-9" aria-label="Kitchen setting"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(KITCHEN).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <p className="mt-3 text-sm text-muted-foreground">{app.foodTypes?.length ? `Selling: ${app.foodTypes.map((type) => FOOD[type]).join(", ")}` : "Didn't say what they plan to sell."}</p>
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Documents</h3>
          <ul className="mt-1 divide-y">
            {docs.map((doc) => {
              const field = doc.key === "foodSafety" ? "foodSafetyLicenseStatus" : "foodEstablishmentCertStatus";
              return (
                <li key={doc.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">{SELLER_DOCUMENT_NAMES[doc.kind]}{doc.recommended && <span className="text-muted-foreground"> (recommended)</span>}</span>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATE[doc.state].className)}>{STATE[doc.state].label}</span>
                  {doc.url && <button type="button" onClick={() => onOpenDocument(doc.url!)} className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline">View<ExternalLink className="size-3" aria-hidden /></button>}
                  {doc.state === "uploaded" && (
                    <span className="flex basis-full justify-end gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onDocumentStatus(field, "rejected")}>Needs another file</Button>
                      <Button size="sm" className="h-7 text-xs" onClick={() => onDocumentStatus(field, "approved")}>Approve</Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {app.kitchenPreference === "commercial" && app.commercialKitchen === "localcooks" && <p className="pt-1 text-xs text-muted-foreground">Kitchen licence: on file with the Local Cooks kitchen.</p>}
        </section>
      </div>

      {app.feedback && (
        <section className="rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Their note</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{app.feedback}</p>
        </section>
      )}

      {shopSection}

      {open && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {app.status === "inReview" && <Button onClick={() => onStatus("approved")} disabled={statusBusy}>{statusBusy && <Loader2 className="size-4 animate-spin" />}Approve</Button>}
          <RequestDocuments app={app} docs={docs} onChanged={onChanged} />
          {app.status === "inReview" && (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" className="text-muted-foreground" disabled={statusBusy}>Reject</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{app.fullName ? `Reject the application from ${app.fullName}?` : "Reject this application?"}</AlertDialogTitle>
                  <AlertDialogDescription>We email them that we can’t approve it right now and that they can apply again anytime.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => onStatus("rejected")}>Reject application</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {app.status === "inReview" && missing.length > 0 && (
            <span className="text-xs text-muted-foreground sm:ml-2">{missing.length === 1 ? "1 document" : `${missing.length} documents`} not on file. You can approve now and still ask for {missing.length === 1 ? "it" : "them"} later.</span>
          )}
        </div>
      )}
    </div>
  );
}

function RequestDocuments({ app, docs, onChanged }: { app: Application; docs: SellerDocument[]; onChanged: (updated: Application) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<SellerDocumentKey[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const choices = docs.filter((doc) => doc.state !== "approved");
  const reset = () => { setPicked(choices.filter((doc) => !doc.url && !doc.recommended).map((doc) => doc.key)); setNote(app.documentsRequestNote ?? ""); };
  const send = async () => {
    setSending(true);
    try {
      onChanged(await adminFetch("POST", `/api/applications/${app.id}/request-documents`, { documents: picked, note: note.trim() || undefined }));
      toast({ title: "Request sent", description: `${app.fullName} gets an email and a to-do.` });
      setOpen(false);
    } catch (error) {
      toast({ title: "Couldn't send the request", description: (error as Error).message, variant: "destructive" });
    } finally { setSending(false); }
  };
  if (!choices.length) return null;
  return (
    <Popover open={open} onOpenChange={(next) => { if (next) reset(); setOpen(next); }}>
      <PopoverTrigger asChild><Button variant="outline">{app.documentsRequestedAt ? "Request again" : "Request documents"}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] rounded-xl p-4">
        <p className="font-semibold">Request documents</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Ticked from their kitchen setting.</p>
        <div className="mt-3 space-y-2.5">
          {choices.map((doc) => (
            <label key={doc.key} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox checked={picked.includes(doc.key)} onCheckedChange={(checked) => setPicked((prev) => checked === true ? [...prev, doc.key] : prev.filter((key) => key !== doc.key))} />
              {SELLER_DOCUMENT_NAMES[doc.kind]}
            </label>
          ))}
        </div>
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} className="mt-3 text-sm" placeholder={`Note to ${app.fullName.split(" ")[0]} (optional)`} />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
          <Button size="sm" onClick={() => void send()} disabled={sending || !picked.length}>{sending && <Loader2 className="size-4 animate-spin" />}Send request</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const NEXT: Record<string, string> = {
  call: "Call them", documents: "Waiting on documents", shop: "Create their shop", paid: "They connect payouts", open: "Live",
};

/** One line per application in the admin list: how to reach them, where they cook, each document, and what's next. */
export function SellerApplicationSummary({ application: app }: { application: Application }) {
  const progress = sellerProgress(app);
  const checking = progress.current === "documents" && !progress.owed.length;
  const next = progress.outcome !== "active" ? null
    : app.status === "approved" && !app.phpShopCreated ? "Create their shop"
    : app.phpShopCreated && !app.verificationEmailSentAt ? "Send their sign-in email"
    : checking ? "Check their documents" : NEXT[progress.current ?? ""];
  const kitchen = app.kitchenPreference === "commercial" ? `commercial_${app.commercialKitchen === "localcooks" ? "localcooks" : "other"}` : app.kitchenPreference;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {app.contactMethod && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{CONTACT[app.contactMethod]}{app.contactTime ? `, ${TIME[app.contactTime]}` : ""}</span>}
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{KITCHEN[kitchen as keyof typeof KITCHEN] ?? app.kitchenPreference}</span>
        {sellerDocuments(app).map((doc) => (
          <span key={doc.key} className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATE[doc.state].className)}>{SELLER_DOCUMENT_NAMES[doc.kind]}: {STATE[doc.state].label.toLowerCase()}</span>
        ))}
      </div>
      {next && <p className="text-muted-foreground">Next: <span className="font-medium text-foreground">{next}</span></p>}
    </div>
  );
}
