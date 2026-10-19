import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, MoreHorizontal, ArrowRight } from "@/components/ui/manager-icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StorageStatusChip } from "@/components/manager/storage/StorageStatusChip";
import { formatStorageDate, type UnitDateKey, type UnitRow } from "@/lib/storage-board";
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { getAuthHeaders } from '@/lib/api';

const DATE_KEY: Record<UnitDateKey, string> = {
  startsOn: "stDateStartsOn",
  startedOn: "stDateStartedOn",
  paidThrough: "stDatePaidThrough",
  extendBy: "stDateExtendBy",
  graceEnded: "stDateGraceEnded",
  releasedOn: "stDateReleasedOn",
};

/** One physical unit: its chip, its occupant, the one date that matters, and one primary action. */
export function StorageUnitCard({ row, onDone }: { row: UnitRow; onDone?: () => void }) {
  const { t, i18n } = useTranslation("storage");
  const menuRef = useRef<HTMLButtonElement>(null);
  const date = (value: string) => formatStorageDate(value, i18n?.language, row.rental?.timezone);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const bookedChefs = Array.from(new Set([row.rental, row.next].filter(Boolean).map(rental => rental?.chef?.name || t("stTheChef"))));
  async function save() {
    if (!reason.trim()) return;
    setSaving(true); setError(false);
    try {
      const response = await fetch(`/api/manager/storage-listings/${row.listingId}/units/${row.unitIndex}/service`, {
        method: 'POST', credentials: 'include', headers: { ...await getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), outOfService: !row.outOfService }),
      });
      if (!response.ok) throw Error();
      setEditing(false); setReason(''); onDone?.();
    } catch { setError(true); } finally { setSaving(false); }
  }
  return (
    <Card className={cn("relative h-full overflow-hidden shadow-none", row.outOfService ? "border-l-[3px] border-l-slate-400 bg-slate-50" : row.chip === 'free' ? "border-dashed bg-muted/10" : "border-l-[3px] bg-card", !row.outOfService && row.rental && (row.needsAction ? "border-l-amber-500" : row.chip === 'reserved' ? "border-l-sky-500" : "border-l-emerald-500"))}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          {row.rental ? <Link className="font-semibold hover:underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset" href={`/manager/storage/${row.rental.id}`}>{t("stUnitLabel", { index: row.unitIndex })}</Link>
            : <span className="font-semibold">{t("stUnitLabel", { index: row.unitIndex })}</span>}
          <div className="flex shrink-0 items-center gap-1">
            <StorageStatusChip chip={row.chip} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button ref={menuRef} variant="ghost" size="icon" className="relative z-10 h-11 w-11" aria-label={t('stUnitMoreActions', { index: row.unitIndex })}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => { setReason(row.outOfService ? t('stBackInService') : ''); setError(false); setEditing(true); }}>{t(row.outOfService ? 'stPutBack' : 'stTakeOutOfService')}</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {row.outOfService && row.chip !== 'outOfService' && <StorageStatusChip chip="outOfService" />}
        {row.outOfService && <p className="truncate text-sm text-muted-foreground" title={row.outOfService.reason}>{row.outOfService.reason}</p>}
        <div className="flex-1 space-y-1 text-sm">
          {row.occupantName && <p className="flex items-center gap-2">
            <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{row.occupantName.split(/\s+/).map(part => part[0]).slice(0, 2).join('')}</AvatarFallback></Avatar>
            <span className="truncate">{row.occupantName}</span>
          </p>}
          {!row.rental && !row.outOfService && <p className="text-muted-foreground">{t('stUnitReady')}</p>}
          {row.rental && <p className="text-muted-foreground">{date(row.rental.startOn)} – {date(row.rental.paidThrough)}</p>}
          {row.date && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t(DATE_KEY[row.date.key] as never, { date: date(row.date.value) })}</span>
            </p>
          )}
        </div>
        {row.next && <Link className="relative z-10 flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:underline" href={`/manager/storage/${row.next.id}`}><ArrowRight className="h-4 w-4 shrink-0" />{t("stUnitNext", { chef: row.next.chef?.name || t("stTheChef"), date: date(row.next.startOn) })}</Link>}
        <AlertDialog open={editing} onOpenChange={next => { if (!saving) setEditing(next); }}>
          <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); menuRef.current?.focus(); }}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(row.outOfService ? 'stServiceRestoreTitle' : 'stServiceRemoveTitle', { index: row.unitIndex })}</AlertDialogTitle>
              <AlertDialogDescription>{t(row.outOfService ? 'stServiceRestoreBody' : 'stServiceRemoveBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            {!row.outOfService && bookedChefs.map(chef => <p key={chef} className="text-sm text-muted-foreground">{t('stServiceBookingUnaffected', { chef })}</p>)}
            <div className="space-y-2">
              <label htmlFor={`unit-reason-${row.key}`} className="text-sm font-medium">{t('stReasonLabel')}</label>
              <Input className="min-h-11" id={`unit-reason-${row.key}`} required maxLength={2000} aria-describedby={`unit-reason-help-${row.key}`} value={reason} onChange={event => setReason(event.target.value)} />
              <p id={`unit-reason-help-${row.key}`} className="text-xs text-muted-foreground">{t('stServiceReasonHelp')}</p>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{t('stActionFailed')}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11" disabled={saving}>{t('stCancel')}</AlertDialogCancel>
              <AlertDialogAction className="min-h-11" disabled={saving || !reason.trim()} onClick={event => { event.preventDefault(); void save(); }}>{t(row.outOfService ? 'stPutBack' : 'stTakeOutOfService')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
