import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';

export function RenewAccessDocuments({ applicationId, renewals = [], onRenewed }: { applicationId: number; renewals?: Array<{ key: string; status: string; expiry?: string | null; rejectionReason?: string | null }>; onRenewed: () => void }) {
  const { t, i18n } = useTranslation('chef');
  const documentName = (key: string) => key === 'foodEstablishmentCert' ? t('foodEstablishmentCertRenewal') : t('foodSafetyLicense');
  const dateOf = (expiry?: string | null) => expiry ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${expiry}T00:00:00Z`)) : '';
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  // The form posts multipart FormData, so the picked expiry rides along in a hidden
  // field while DateField (a button + popover) owns the visible control.
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  return <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={async event => {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    for (const field of ['foodSafetyLicenseFile', 'foodEstablishmentCertFile']) {
      const file = body.get(field);
      if (file instanceof File && !file.size) body.delete(field);
    }
    if (!body.has('foodSafetyLicenseFile') && !body.has('foodEstablishmentCertFile')) { setMessage(t('renewDocumentChooseFile')); return; }
    setPending(true); setMessage('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/firebase/chef/kitchen-applications/${applicationId}/documents`, { method: 'PATCH', credentials: 'include', headers: { Authorization: `Bearer ${token}` }, body });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || t('renewDocumentFailed')); }
      setMessage(t('renewDocumentSubmitted')); onRenewed();
    } catch (error) { setMessage(error instanceof Error ? error.message : t('renewDocumentFailed')); }
    finally { setPending(false); }
  }}>
    <h2 className="font-semibold">{t('renewDocumentsTitle')}</h2><p className="text-sm text-muted-foreground">{t('renewDocumentsReviewHelp')}</p>
    {renewals.filter(renewal => renewal.status === 'pending' || (renewal.status === 'rejected' && renewal.rejectionReason)).map(renewal => <p key={renewal.key} role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{renewal.status === 'pending'
      ? t('renewalPendingNote', { document: documentName(renewal.key), date: dateOf(renewal.expiry) })
      : t('renewalRejectedNote', { document: documentName(renewal.key), reason: renewal.rejectionReason })}</p>)}
    {(['foodSafetyLicense', 'foodEstablishmentCert'] as const).map(field => <fieldset key={field} disabled={pending} className="space-y-2">
      <label htmlFor={`${field}File`} className="text-sm font-medium">{field === 'foodSafetyLicense' ? t('foodSafetyLicense') : t('foodEstablishmentCertRenewal')}</label>
      <Input id={`${field}File`} name={`${field}File`} type="file" accept="application/pdf,image/jpeg,image/png" />
      <label htmlFor={`${field}Expiry`} className="text-sm">{t('renewDocumentExpiry')}</label>
      <DateField id={`${field}Expiry`} minToday={false} value={expiries[field] || ''}
        onChange={value => setExpiries(current => ({ ...current, [field]: value }))}
        placeholder={t('renewDocumentExpiry')} />
      <input type="hidden" name={`${field}Expiry`} value={expiries[field] || ''} />
    </fieldset>)}
    {message && <p role="status" className="text-sm">{message}</p>}<Button type="submit" disabled={pending}>{t('renewDocumentsSubmit')}</Button>
  </form>;
}
