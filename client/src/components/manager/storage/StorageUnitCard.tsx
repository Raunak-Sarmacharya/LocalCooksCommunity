import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, User } from "@/components/ui/manager-icons";
import { StorageStatusChip } from "@/components/manager/storage/StorageStatusChip";
import { formatBookingDate } from "@/lib/formatters";
import type { UnitDateKey, UnitRow } from "@/lib/storage-board";
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { getAuthHeaders } from '@/lib/api';

const DATE_KEY: Record<UnitDateKey, string> = {
  startsOn: "stDateStartsOn",
  paidThrough: "stDatePaidThrough",
  extendBy: "stDateExtendBy",
  graceEnded: "stDateGraceEnded",
  releasedOn: "stDateReleasedOn",
};

/** One physical unit: its chip, its occupant, the one date that matters, and one primary action. */
export function StorageUnitCard({ row, onDone }: { row: UnitRow; onDone?: () => void }) {
  const { t } = useTranslation("storage");
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
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
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{t("stUnitLabel", { index: row.unitIndex })}</span>
          <StorageStatusChip chip={row.chip} />
        </div>
        {row.outOfService && row.chip !== 'outOfService' && <StorageStatusChip chip="outOfService" />}
        {row.outOfService && <p className="text-sm text-muted-foreground">{row.outOfService.reason}</p>}
        <div className="flex-1 space-y-1 text-sm">
          <p className="flex items-center gap-1.5">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{row.occupantName ?? t("stNoOccupant")}</span>
          </p>
          {row.date && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t(DATE_KEY[row.date.key] as never, { date: formatBookingDate(row.date.value) })}</span>
            </p>
          )}
        </div>
        {row.rental && (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={`/manager/storage/${row.rental.id}`}>{t("stViewUnit")}</Link>
          </Button>
        )}
        {editing ? <div className="space-y-2">
          <label htmlFor={`unit-reason-${row.key}`} className="text-sm">{t('stReasonLabel')}</label>
          <Input id={`unit-reason-${row.key}`} value={reason} onChange={event => setReason(event.target.value)} />
          {error && <p role="alert">{t('stActionFailed')}</p>}
          <Button size="sm" disabled={saving || !reason.trim()} onClick={() => void save()}>{t('stConfirm')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('stBack')}</Button>
        </div> : <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{t(row.outOfService ? 'stPutBack' : 'stTakeOutOfService')}</Button>}
      </CardContent>
    </Card>
  );
}
