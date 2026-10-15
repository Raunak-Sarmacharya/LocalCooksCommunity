import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { SettingImpact } from '@/lib/setting-impact';

export interface SettingChangePreviewProps {
  whatChanges: ReactNode;
  appliesTo: 'now' | 'new_bookings' | 'scheduled' | ReactNode;
  impact?: SettingImpact;
  rightNow?: ReactNode;
  undo: ReactNode;
  confirm?: boolean;
  /** Only arrival-mode changes actually send chefs a notice. */
  notifiesChefs?: boolean;
  actionLabel?: string;
  cancelLabel?: string;
  onSave?: () => void | Promise<unknown>;
  disabled?: boolean;
  children?: ReactNode;
}

export function SettingChangePreview(props: SettingChangePreviewProps) {
  const { t } = useTranslation('manager');
  const [open, setOpen] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const loading = !props.impact && props.rightNow == null;
  const when = props.appliesTo === 'now' ? t('scpNow') : props.appliesTo === 'new_bookings' ? t('scpNewBookings')
    : props.appliesTo === 'scheduled' ? t('scpScheduled') : props.appliesTo;
  const rightNow = props.rightNow ?? (loading ? t('scpChecking') : props.impact!.upcoming === 0 ? t('scpNone')
    : t(props.notifiesChefs ? 'scpImpactNotified' : 'scpImpact', { upcoming: props.impact!.upcoming }));
  const lines = <dl className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm" data-testid="setting-change-preview">
    {[[t('scpWhat'), props.whatChanges], [t('scpWhen'), when], [t('scpRightNow'), rightNow], [t('scpUndo'), props.undo]].map(([label, value], index) =>
      <div key={index}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}
  </dl>;
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await props.onSave?.(); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('scpSaveFailed')); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    {lines}
    {!open && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {props.onSave && <Button className="min-h-11" disabled={props.disabled || loading || busy} onClick={() => {
      if (props.confirm) { setAcknowledged(false); setOpen(true); } else void save();
    }}>{props.actionLabel}</Button>}
    {props.confirm && props.onSave && <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{props.actionLabel}</DialogTitle></DialogHeader>
        {lines}{props.children}
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          {t(props.notifiesChefs ? 'scpAcknowledgeNotice' : 'scpAcknowledge')}</label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{props.cancelLabel || t('scpKeep')}</Button>
          <Button className="min-h-11" disabled={props.disabled || loading || busy || !acknowledged} onClick={() => void save()}>{props.actionLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </div>;
}
