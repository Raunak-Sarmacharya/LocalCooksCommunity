import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { claimFilingWindow } from '@shared/damage-claims';
import { recordedDepartureAt } from '@shared/clock-closeout';
import { DamageClaimSheet } from './DamageClaimSheet';
import { formatTime } from '@/lib/formatters';

type ClaimVisit = { id: number; visitDate?: string | null; startTime?: string; endTime?: string };

type DepartureRow = Parameters<typeof recordedDepartureAt>[0];

/**
 * "Report damage or extra cleaning" is offered only while the 72-hour filing window is open: from the actual
 * departure (recorded or the chef's checkout), else the booked end. Display gate only; the server re-checks.
 */
export function claimFilingOpen(input: { bookedEndAt: Date | string | null | undefined; departure?: DepartureRow; now?: Date }) {
  if (!input.bookedEndAt) return false;
  const bookedEnd = new Date(input.bookedEndAt);
  if (!Number.isFinite(bookedEnd.getTime())) return false;
  return claimFilingWindow(bookedEnd, recordedDepartureAt(input.departure), input.now ?? new Date()).allowed;
}

/**
 * Inline mode (default): the claim sheet's own button plus a visit picker. Secondary mode (booking page Now card):
 * the page owns the link in its secondary row and opens this with `open`; a booking with several visits first asks
 * which visit, then the three-step sheet opens.
 */
export function ManagerDamageClaimEntry({ bookingId, chefName, visits, mode = 'inline', open = false, onOpenChange, onFiled }: {
  bookingId: number; chefName: string; visits: ClaimVisit[];
  mode?: 'inline' | 'secondary'; open?: boolean; onOpenChange?: (open: boolean) => void; onFiled?: () => void;
}) {
  const { t, i18n } = useTranslation('booking');
  // The day itself ("Oct 28, 2026 · 12:30 p.m. – 3:30 p.m."), as Booking days shows it; older rows without a date keep "Visit N".
  const label = (visit: ClaimVisit, index: number) => visit.visitDate && visit.startTime && visit.endTime
    ? `${new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${visit.visitDate.slice(0, 10)}T12:00:00Z`))} · ${formatTime(visit.startTime, i18n.language)} – ${formatTime(visit.endTime, i18n.language)}`
    : t('dcV2Visit', { number: index + 1 });
  const [visitId, setVisitId] = useState(visits.at(-1)?.id);
  const [chosen, setChosen] = useState(visits.length <= 1);
  if (mode === 'secondary') {
    const close = () => { onOpenChange?.(false); setChosen(visits.length <= 1); };
    return <>
      <Dialog open={open && !chosen} onOpenChange={value => { if (!value) close(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('dcV2Report')}</DialogTitle><DialogDescription>{t('dcV2AffectedVisit')}</DialogDescription></DialogHeader>
          <div className="grid gap-2">{visits.map((visit, index) => <Button key={visit.id} type="button" variant="outline" className="min-h-11 justify-start"
            onClick={() => { setVisitId(visit.id); setChosen(true); }}>{label(visit, index)}</Button>)}</div>
        </DialogContent>
      </Dialog>
      <DamageClaimSheet bookingId={bookingId} visitId={visitId} chefName={chefName} hideTrigger open={open && chosen}
        onOpenChange={value => { if (!value) close(); }} onFiled={onFiled} />
    </>;
  }
  return <div className="flex flex-wrap items-center gap-3">
    {visits.length > 1 && <label className="text-sm">{t('dcV2AffectedVisit')} <Select value={String(visitId)} onValueChange={value => setVisitId(Number(value))}><SelectTrigger className="inline-flex w-auto min-w-[8rem]"><SelectValue /></SelectTrigger><SelectContent>
      {visits.map((visit, index) => <SelectItem key={visit.id} value={String(visit.id)}>{label(visit, index)}</SelectItem>)}</SelectContent></Select></label>}
    <DamageClaimSheet bookingId={bookingId} visitId={visitId} chefName={chefName} />
  </div>;
}
