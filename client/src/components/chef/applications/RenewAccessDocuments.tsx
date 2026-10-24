import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';

type DocKey = string;
/** Form field names: the built-in documents' own, or "custom_<id>" for one the kitchen added. */
const fileField = (key: string) => key.startsWith('custom:') ? `custom_${key.slice(7)}` : `${key}File`;
const expiryField = (key: string) => key.startsWith('custom:') ? `custom_${key.slice(7)}__expiry` : `${key}Expiry`;
export function RenewAccessDocuments({ applicationId, renewals = [], documents, adding = false, onRenewed }: { applicationId: number; renewals?: Array<{ key: string; status: string; expiry?: string | null; rejectionReason?: string | null }>; documents?: Array<{ key: DocKey; label?: string; hasExpiry?: boolean; mode: string; uploaded: boolean }>;
  /** Documents the kitchen asked for after the booking requirements were sent: adding, not renewing. */
  adding?: boolean; onRenewed: () => void }) {
  const { t, i18n } = useTranslation('chef');
  const documentName = (key: string) => key.startsWith('custom:') ? documents?.find(doc => doc.key === key)?.label || key
    : key === 'foodEstablishmentCert' ? t('foodEstablishmentCertRenewal') : key === 'insurance' ? t('mdInsurance', 'Insurance') : t('foodSafetyLicense');
  const hasExpiry = (key: string) => documents?.find(doc => doc.key === key)?.hasExpiry !== false;
  // The documents this location uses (insurance and the kitchen's own included); the older two by default.
  const fields: DocKey[] = documents?.length ? documents.filter(doc => doc.mode !== 'none' || doc.uploaded).map(doc => doc.key) : ['foodSafetyLicense', 'foodEstablishmentCert'];
  const dateOf = (expiry?: string | null) => expiry ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${expiry}T00:00:00Z`)) : '';
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  // The form posts multipart FormData, so the picked expiry rides along in a hidden
  // field while DateField (a button + popover) owns the visible control.
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  return <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={async event => {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    for (const field of fields.map(fileField)) {
      const file = body.get(field);
      if (file instanceof File && !file.size) body.delete(field);
    }
    if (!fields.some(field => body.has(fileField(field)))) { setMessage(t('renewDocumentChooseFile')); return; }
    setPending(true); setMessage('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/firebase/chef/kitchen-applications/${applicationId}/documents`, { method: 'PATCH', credentials: 'include', headers: { Authorization: `Bearer ${token}` }, body });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || t('renewDocumentFailed')); }
      setMessage(t('renewDocumentSubmitted')); onRenewed();
    } catch (error) { setMessage(error instanceof Error ? error.message : t('renewDocumentFailed')); }
    finally { setPending(false); }
  }}>
    <h2 className="font-semibold">{adding ? t('addDocumentsTitle', 'Add documents') : t('renewDocumentsTitle')}</h2><p className="text-sm text-muted-foreground">{adding ? t('addDocumentsHelp', 'Upload what the kitchen asked for. It goes to the kitchen with the rest of your booking requirements.') : t('renewDocumentsReviewHelp')}</p>
    {renewals.filter(renewal => renewal.status === 'pending' || (renewal.status === 'rejected' && renewal.rejectionReason)).map(renewal => <p key={renewal.key} role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{renewal.status === 'pending'
      ? t('renewalPendingNote', { document: documentName(renewal.key), date: dateOf(renewal.expiry) })
      : t('renewalRejectedNote', { document: documentName(renewal.key), reason: renewal.rejectionReason })}</p>)}
    {fields.map(field => <fieldset key={field} disabled={pending} className="space-y-2">
      <label htmlFor={fileField(field)} className="text-sm font-medium">{documentName(field)}</label>
      <Input id={fileField(field)} name={fileField(field)} type="file" accept="application/pdf,image/jpeg,image/png" />
      {hasExpiry(field) && <>
        <label htmlFor={expiryField(field)} className="text-sm">{t('renewDocumentExpiry')}</label>
        <DateField id={expiryField(field)} minToday={false} value={expiries[field] || ''}
          onChange={value => setExpiries(current => ({ ...current, [field]: value }))}
          placeholder={t('renewDocumentExpiry')} />
        <input type="hidden" name={expiryField(field)} value={expiries[field] || ''} />
      </>}
    </fieldset>)}
    {message && <p role="status" className="text-sm">{message}</p>}<Button type="submit" disabled={pending}>{adding ? t('addDocumentsSubmit', 'Send to the kitchen') : t('renewDocumentsSubmit')}</Button>
  </form>;
}
