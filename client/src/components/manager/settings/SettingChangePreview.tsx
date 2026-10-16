import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { SettingImpact } from '@/lib/setting-impact';

export interface SettingChangePreviewProps {
  whatChanges: ReactNode;
  appliesTo: 'now' | 'new_bookings' | 'scheduled' | ReactNode;
  impact?: SettingImpact;
  impactFetching?: boolean;
  impactError?: boolean;
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
  /** Hide the inline four lines (e.g. nothing changed yet). The confirm dialog still repeats them. */
  showPreview?: boolean;
  /** Settings pages: an unchanged setting shows a quiet outline button, so only a real pending change is filled. */
  quietWhenDisabled?: boolean;
  /** Where the action sits; settings sections right-align their one save. */
  align?: 'start' | 'end';
  /** Extra actions rendered before the save (e.g. Discard), only while the save is live. */
  secondaryAction?: ReactNode;
}

export function SettingChangePreview(props: SettingChangePreviewProps) {
  const { t } = useTranslation('manager');
  const [open, setOpen] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const when = props.appliesTo === 'now' ? t('scpNow') : props.appliesTo === 'new_bookings' ? t('scpNewBookings')
    : props.appliesTo === 'scheduled' ? t('scpScheduled') : props.appliesTo;
  const rightNow = props.impactError ? t('scpCountFailed') : props.rightNow ?? (props.impactFetching ? t('scpChecking') : !props.impact ? t('scpCountFailed') : props.impact.upcoming === 0 ? t('scpNone')
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
  const inactive = props.disabled || busy;
  const button = props.onSave && <Button className="min-h-11" variant={props.quietWhenDisabled && inactive ? 'outline' : 'default'} disabled={inactive} onClick={() => {
    if (props.confirm) { setAcknowledged(false); setOpen(true); } else void save();
  }}>{props.actionLabel}</Button>;
  return <div className="space-y-3">
    {props.showPreview !== false && lines}
    {!open && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {button && (props.align === 'end' || props.secondaryAction
      ? <div className={`flex flex-wrap items-center gap-2 ${props.align === 'end' ? 'justify-end' : ''}`}>{props.secondaryAction}{button}</div>
      : button)}
    {props.confirm && props.onSave && <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{props.actionLabel}</DialogTitle></DialogHeader>
        {lines}{props.children}
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          {t(props.notifiesChefs ? 'scpAcknowledgeNotice' : 'scpAcknowledge')}</label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{props.cancelLabel || t('scpKeep')}</Button>
          <Button className="min-h-11" disabled={props.disabled || busy || !acknowledged} onClick={() => void save()}>{props.actionLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </div>;
}
