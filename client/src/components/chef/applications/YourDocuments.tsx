/**
 * "Your documents for {kitchen}" (owner-approved mocks c1–c6, Oct 27): one list, grouped by what needs the customer, each
 * document sent from its own row. A copy the kitchen is checking can't be swapped (the next step offers Message the
 * kitchen instead). Uses the existing per-document PATCH and its validation (expiry after today, 10 MB, PDF/JPG/PNG).
 */
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Upload } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { cn } from "@/lib/utils";
import { blocksBooking, documentName, documentState, Pill, useDocumentWords, type ApplicationDocument, type DocumentState } from "./MyDocuments";

/** Form field names: the built-in documents' own, or "custom_<id>" for one the kitchen added. */
const fileField = (key: string) => key.startsWith("custom:") ? `custom_${key.slice(7)}` : `${key}File`;
const expiryField = (key: string) => key.startsWith("custom:") ? `custom_${key.slice(7)}__expiry` : `${key}Expiry`;
// "Business licence" -> "business licence" mid-sentence; acronyms ("HACCP plan") keep their capitals.
const lowerFirst = (text: string) => text.length > 1 && text[0] !== text[0].toLocaleLowerCase() && text[1] === text[1].toLocaleLowerCase() ? text[0].toLocaleLowerCase() + text.slice(1) : text;

const GROUPS: Array<[string, string, DocumentState[]]> = [
  ["dfGroupToSend", "To send", ["missing", "rejected", "expired"]],
  ["dfGroupExpiring", "Expiring soon", ["expiring"]],
  ["dfGroupWithKitchen", "With the kitchen", ["checking"]],
  ["dfGroupRenewal", "Renewal with the kitchen", ["renewal"]],
  ["dfGroupOnFile", "On file", ["verified", "added"]],
];

export function YourDocuments({ applicationId, documents, kitchenName, sentToKitchen, canUpload, title, lead, openKey, onOpen, onSent, viewLink }: {
  applicationId: number; documents: ApplicationDocument[]; kitchenName: string;
  /** The booking requirements went to the kitchen: an unchecked copy is "With the kitchen" and can't be swapped. */
  sentToKitchen: boolean; canUpload: boolean; title: string; lead: ReactNode;
  openKey: string | null; onOpen: (key: string | null) => void; onSent: (document: string) => void;
  viewLink: (key: string) => ReactNode;
}) {
  const { t } = useTranslation("chef");
  const rows = documents.map(document => ({ document, state: documentState(document, sentToKitchen) })).filter(row => row.state !== "waived");
  return <section id="your-documents" tabIndex={-1} className="scroll-mt-4 rounded-xl border bg-card p-5 outline-none sm:p-6" aria-labelledby="your-documents-title" data-testid="your-documents">
    <h2 id="your-documents-title" className="text-base font-semibold">{title}</h2>
    {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
    <div className="mt-5 space-y-6">
      {GROUPS.map(([key, fallback, states]) => {
        const group = rows.filter(row => states.includes(row.state));
        if (!group.length) return null;
        return <div key={key}>
          <h3 className="mb-3 text-[13px] font-medium text-muted-foreground">{t(key, fallback)}</h3>
          <ul className="divide-y">{group.map(({ document, state }) => <DocumentRow key={document.key} applicationId={applicationId} document={document} state={state} kitchenName={kitchenName}
            canUpload={canUpload} open={openKey === document.key} onOpen={open => onOpen(open ? document.key : null)} onSent={onSent} view={document.uploaded ? viewLink(document.key) : null} />)}</ul>
        </div>;
      })}
    </div>
  </section>;
}

function DocumentRow({ applicationId, document, state, kitchenName, canUpload, open, onOpen, onSent, view }: {
  applicationId: number; document: ApplicationDocument; state: DocumentState; kitchenName: string; canUpload: boolean;
  open: boolean; onOpen: (open: boolean) => void; onSent: (document: string) => void; view: ReactNode;
}) {
  const { t, day, pill, meta } = useDocumentWords();
  const [tone, status] = pill(document, state);
  const name = documentName(t, document);
  // A copy with the kitchen (first one or a renewal) is never replaceable here; a verified undated one has nothing to renew.
  const action = !canUpload || open ? null
    : state === "missing" ? <Button variant="outline" size="sm" onClick={() => onOpen(true)}>{t("mdUpload", "Upload")}</Button>
    : state === "rejected" ? <Button size="sm" onClick={() => onOpen(true)}>{t("dfUploadNewCopy", "Upload a new copy")}</Button>
    : state === "expired" ? <Button size="sm" onClick={() => onOpen(true)}>{t("dfSendNewCopy", "Send new copy")}</Button>
    : state === "expiring" ? <Button variant="outline" size="sm" onClick={() => onOpen(true)}>{t("dfSendNewCopy", "Send new copy")}</Button>
    : state === "added" ? <Button variant="outline" size="sm" onClick={() => onOpen(true)}>{t("dfReplace", "Replace")}</Button>
    : null;
  // The kitchen's note when it asked for a new copy, or sent a renewal back.
  const note = state === "rejected" && document.note ? { text: document.note.text, at: document.note.at }
    : document.renewal?.status === "rejected" && document.renewal.note ? { text: document.renewal.note, at: null } : null;
  const stacked = !!action && !view;
  return <li className="py-4 first:pt-0 last:pb-0" data-testid={`document-${document.key}`}>
    <div className={cn("flex gap-3", action ? "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-4" : "items-center justify-between gap-4", stacked && "items-stretch")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-[15px] font-medium">{name}</p><Pill tone={tone}>{status}</Pill></div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{meta(document, state)}</p>
      </div>
      {(view || action) && <div className="flex shrink-0 items-center gap-4 text-sm font-medium text-primary [&_button]:min-w-0">{view}{action}</div>}
    </div>
    {note && <figure className="mt-3 rounded-lg bg-red-50/70 px-4 py-3">
      <figcaption className="text-[13px] font-medium text-red-900">{t("dfNoteFrom", { defaultValue: "Note from {kitchen}", kitchen: kitchenName })}{note.at ? ` · ${day(note.at)}` : ""}</figcaption>
      <blockquote className="mt-1 whitespace-pre-wrap text-sm leading-6">{note.text}</blockquote></figure>}
    {state === "expiring" && blocksBooking(document) && !open && <p className="mt-3 rounded-lg bg-muted px-4 py-3 text-[13px] leading-5 text-foreground/80">
      {t("dfExpiringNote", { defaultValue: "You can keep booking until {date}. If the kitchen hasn’t verified the new copy by then, new bookings pause until it does.", date: day(document.expiry, true) })}</p>}
    {state === "renewal" && <div className="mt-3 flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-950">
      <FileText className="mt-0.5 size-4 shrink-0" aria-hidden /><p><span className="font-medium">{t("dfRenewalWithKitchen", "New copy with the kitchen")}</span>
        {[document.renewal?.sentAt && t("dfSentOn", { defaultValue: "sent {date}", date: day(document.renewal.sentAt) }), document.renewal?.expiry && t("mdExpires", { defaultValue: "expires {date}", date: day(document.renewal.expiry, true) })].filter(Boolean).map(fact => ` · ${fact}`).join("")}</p></div>}
    {open && <div className="mt-4"><UploadForm applicationId={applicationId} document={document} name={name} onCancel={() => onOpen(false)} onSent={() => { onOpen(false); onSent(name); }} /></div>}
  </li>;
}

export function UploadForm({ applicationId, document, name, onCancel, onSent }: { applicationId: number; document: ApplicationDocument; name: string; onCancel: () => void; onSent: () => void }) {
  const { t, i18n } = useTranslation("chef");
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dated = document.hasExpiry !== false;
  const ready = !!file && (!dated || !!expiry);
  const size = file ? new Intl.NumberFormat(i18n.language, { style: "unit", unit: file.size >= 1_048_576 ? "megabyte" : "kilobyte", maximumFractionDigits: file.size >= 1_048_576 ? 1 : 0 }).format(file.size >= 1_048_576 ? file.size / 1_048_576 : Math.max(1, Math.round(file.size / 1024))) : "";
  const id = `upload-${document.key.replace(/[^\w-]/g, "-")}`;
  const send = async () => {
    if (!file || !ready) return;
    if (file.size > 10 * 1024 * 1024) { setError(t("dfTooBig", "That file is over 10 MB. Choose a smaller one.")); return; }
    const body = new FormData();
    body.append(fileField(document.key), file);
    if (dated) body.append(expiryField(document.key), expiry);
    setPending(true); setError("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/firebase/chef/kitchen-applications/${applicationId}/documents`, { method: "PATCH", credentials: "include", headers: { Authorization: `Bearer ${token}` }, body });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.code === "DOCUMENT_WITH_KITCHEN" ? t("dfWithKitchenError", "The kitchen is checking this document. Message the kitchen if it needs to change.") : data.error || t("renewDocumentFailed"));
      }
      onSent();
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("renewDocumentFailed")); }
    finally { setPending(false); }
  };
  return <div className="rounded-xl bg-muted/40 p-4 ring-1 ring-border" data-testid="document-upload-form">
    <fieldset disabled={pending} className="space-y-4">
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-medium">{t("dfFile", "File")}</label>
        <input ref={input} id={id} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} />
        {file ? <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{file.name}</span><span className="shrink-0 text-muted-foreground">{size}</span></span>
            <button type="button" className="shrink-0 font-medium text-primary hover:underline" onClick={() => input.current?.click()}>{t("dfChange", "Change")}</button></div>
          : <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input bg-background px-4 py-5 text-center text-sm hover:bg-muted/50">
            <span className="flex items-center gap-2 font-medium"><Upload className="size-4" aria-hidden />{t("dfChooseFile", "Choose a file")}</span>
            <span className="text-xs text-muted-foreground">{t("dfFileTypes", "PDF, JPG or PNG, up to 10 MB")}</span></button>}
      </div>
      {dated && <div className="sm:max-w-[300px]">
        <label htmlFor={`${id}-expiry`} className="mb-2 block text-sm font-medium">{t("dfExpiryDate", "Expiry date")}</label>
        <DateField id={`${id}-expiry`} afterToday value={expiry} onChange={setExpiry} placeholder={t("dfChooseDate", "Choose a date")}
          footer={t("dfPickDate", { defaultValue: "Pick the date printed on the {document}. It has to be after today.", document: lowerFirst(name) })} />
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" onClick={() => void send()} disabled={!ready || pending}>{pending ? t("dfSending", "Sending…") : t("dfSendDocument", { defaultValue: "Send {document}", document: lowerFirst(name) })}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("dfCancel", "Cancel")}</Button>
      </div>
    </fieldset>
  </div>;
}
export { lowerFirst };
