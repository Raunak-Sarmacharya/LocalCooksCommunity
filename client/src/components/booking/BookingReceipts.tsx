/**
 * Booking payment card: the issued money documents (one row per receipt / refund / remittance) and the final statement
 * once the booking is settled. Documents are immutable on the server; a download is always the same PDF.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';

export type BookingDocumentItem = { id: number; number: string; kind: 'payment' | 'refund' | 'statement' | 'remittance'; title: string; issuedAt: string;
  amountCents: number; summary: string };
export type BookingDocumentsResponse = { available: boolean; settled?: boolean; statementIssued?: boolean; documents: BookingDocumentItem[] };

async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken().catch(() => undefined);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** `available: false` while the documents table is not installed: the page keeps its legacy download. */
export function useBookingDocuments(bookingId: number | undefined, role: 'chef' | 'manager', enabled: boolean) {
  return useQuery<BookingDocumentsResponse>({
    queryKey: ['booking-documents', role, bookingId],
    enabled: !!bookingId && enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const response = await fetch(role === 'manager' ? `/api/manager/bookings/${bookingId}/documents` : `/api/bookings/${bookingId}/documents`,
        { credentials: 'include', headers: await authHeaders() });
      if (!response.ok) return { available: false, documents: [] };
      return response.json();
    },
  });
}

export function BookingReceipts({ data, role, timezone, formatCurrency, onError }: {
  data: BookingDocumentsResponse; role: 'chef' | 'manager'; timezone?: string; formatCurrency: (cents: number) => string; onError: (message: string) => void;
}) {
  const { t: tStrict, i18n } = useTranslation('chef');
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [downloading, setDownloading] = useState<number | null>(null);
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language || 'en-CA', { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(value));
  const kindLabel = (doc: BookingDocumentItem) => doc.kind === 'statement' ? t(role === 'chef' ? 'bdDocStatementChef' : 'bdDocStatementKitchen')
    : doc.kind === 'remittance' ? t('bdDocRemittance') : doc.kind === 'refund' ? t(role === 'chef' ? 'bdDocRefund' : 'bdDocReversal') : t('bdDocPayment');
  const download = async (doc: BookingDocumentItem) => {
    setDownloading(doc.id);
    try {
      const response = await fetch(`/api/booking-documents/${doc.id}/pdf`, { credentials: 'include', headers: await authHeaders() });
      if (!response.ok) throw new Error(t('bdDocDownloadFailed'));
      const url = window.URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `LocalCooks-${doc.number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : t('bdDocDownloadFailed'));
    } finally { setDownloading(null); }
  };
  const statement = data.documents.find(doc => doc.kind === 'statement');
  const rows = data.documents.filter(doc => doc.kind !== 'statement');
  return <div className="space-y-1" data-testid="booking-receipts">
    <h3 className="text-[13px] font-medium text-muted-foreground">{t('bdReceiptsTitle')}</h3>
    {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('bdReceiptsEmpty')}</p>}
    <ul className="divide-y divide-border/60">
      {[...rows, ...(statement ? [statement] : [])].map(doc => (
        <li key={doc.id} data-testid={doc.kind === 'statement' ? 'booking-statement-row' : 'booking-receipt-row'}>
          <button type="button" onClick={() => void download(doc)} disabled={downloading === doc.id}
            className="flex min-h-11 w-full items-center gap-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('bdDocDownload', { name: kindLabel(doc), number: doc.number })}>
            <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{date(doc.issuedAt)}</span>
            <span className="min-w-0 flex-1">
              <span className={doc.kind === 'statement' ? 'font-medium' : undefined}>{kindLabel(doc)}</span>
              {doc.kind !== 'statement' && doc.summary && doc.summary !== doc.title && <span className="block truncate text-xs text-muted-foreground">{doc.summary}</span>}
            </span>
            <span className="tabular-nums">{doc.amountCents < 0 ? `−${formatCurrency(-doc.amountCents)}` : formatCurrency(doc.amountCents)}</span>
            {downloading === doc.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>
        </li>
      ))}
    </ul>
    {!statement && rows.length > 0 && <p className="text-xs text-muted-foreground" data-testid="statement-pending">
      {t(role === 'chef' ? 'bdStatementPendingChef' : 'bdStatementPendingKitchen')}</p>}
  </div>;
}
