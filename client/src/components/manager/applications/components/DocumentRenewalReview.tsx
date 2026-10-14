import { useState } from 'react';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export type DocumentRenewal = { id: number; key: 'foodSafetyLicense' | 'foodEstablishmentCert'; url: string; expiry: string; status: string; submittedAt?: string | null };

/** A renewed upload waiting beside the current document, which stays valid until it expires. */
export function DocumentRenewalReview({ renewal, document, busy, onView, onReview }: {
  renewal: DocumentRenewal; document: string; busy: boolean; onView: () => void;
  onReview: (decision: 'approved' | 'rejected', reason?: string) => void | Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const expiry = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${renewal.expiry}T00:00:00Z`));
  const reasonId = `renewal-reason-${renewal.key}`;
  return <section aria-label={mt('renewalSubmittedTitle', { document })} className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
    <div>
      <h5 className="text-sm font-semibold">{mt('renewalSubmittedTitle', { document })}</h5>
      <p className="text-sm text-muted-foreground">{mt('renewalSubmittedBody', { date: expiry })}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onView}>{mt('renewalView')}</Button>
      <Button type="button" size="sm" disabled={busy} onClick={() => void onReview('approved')}>{mt('renewalApprove')}</Button>
      {!rejecting && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRejecting(true)}>{mt('renewalReject')}</Button>}
    </div>
    {rejecting && <div className="space-y-2">
      <label htmlFor={reasonId} className="text-sm font-medium">{mt('renewalRejectReason')}</label>
      <Textarea id={reasonId} value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} disabled={busy} />
      <p className="text-xs text-muted-foreground">{mt('renewalRejectHelp')}</p>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={busy || !reason.trim()} onClick={() => void onReview('rejected', reason.trim())}>{mt('renewalRejectSend')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}>{mt('cancel')}</Button>
      </div>
    </div>}
  </section>;
}
