import { useState } from 'react';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoment } from './customer-format';
import type { CustomerNote } from './customer-types';
import { useCustomerNotes } from './use-customers';

const MAX = 2000;
const countFormat = (value: number, locale: string) => new Intl.NumberFormat(locale).format(value);

export function CustomerNotes({ chefId, locationId, name, timezone }: { chefId: number; locationId: number; name: string; timezone: string }) {
  const locale = i18n.language || 'en-CA';
  const { query, add, edit, remove } = useCustomerNotes(chefId, locationId);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<unknown>, done?: () => void) => {
    setError('');
    try { await action(); done?.(); } catch { setError(mt('cuNoteSaveError')); }
  };

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-muted px-3 py-2 text-sm" data-testid="notes-banner">{mt('cuNotesBanner', { name })}</p>

      <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (draft.trim() && !add.isPending) void run(() => add.mutateAsync(draft.trim()), () => setDraft('')); }}>
        <Label htmlFor="customer-note-new">{mt('cuNoteLabel')}</Label>
        <Textarea id="customer-note-new" value={draft} maxLength={MAX} rows={3} placeholder={mt('cuNotePlaceholder', { name })}
          onChange={event => setDraft(event.target.value)} aria-describedby="customer-note-new-count" />
        <div className="flex items-center justify-between gap-2">
          <span id="customer-note-new-count" className="text-xs text-muted-foreground">{mt('cuNoteCount', { count: countFormat(draft.length, locale), max: countFormat(MAX, locale) })}</span>
          <Button type="submit" className="min-h-11" disabled={!draft.trim() || add.isPending}>{mt('cuNoteAdd')}</Button>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {query.isPending ? <Skeleton className="h-16 w-full" />
        : query.isError ? <p role="alert" className="text-sm text-destructive">{mt('cuNotesLoadError')}</p>
        : query.data.length === 0 ? <p className="text-sm text-muted-foreground">{mt('cuNoNotes')}</p>
        : (
          <ul className="space-y-3">
            {query.data.map(note => (
              <li key={note.id} className="space-y-2 rounded-lg border p-3">
                {editing?.id === note.id ? (
                  <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (editing.body.trim() && !edit.isPending) void run(() => edit.mutateAsync({ id: note.id, body: editing.body.trim() }), () => setEditing(null)); }}>
                    <Label htmlFor={`customer-note-${note.id}`} className="sr-only">{mt('cuNoteEditLabel')}</Label>
                    <Textarea id={`customer-note-${note.id}`} autoFocus value={editing.body} maxLength={MAX} rows={3} onChange={event => setEditing({ id: note.id, body: event.target.value })} />
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditing(null)}>{mt('cancel')}</Button>
                      <Button type="submit" className="min-h-11" disabled={!editing.body.trim() || edit.isPending}>{mt('cuNoteSave')}</Button>
                    </div>
                  </form>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {mt('cuNoteBy', { author: authorLabel(note), when: formatMoment(note.createdAt, timezone, locale) })}{note.edited ? ` · ${mt('cuNoteEdited')}` : ''}
                </p>
                {note.mine && editing?.id !== note.id && (
                  confirming === note.id ? (
                    <div role="group" aria-label={mt('cuNoteDeleteConfirm')} className="space-y-2">
                      <p className="text-sm">{mt('cuNoteDeleteConfirm')}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="destructive" className="min-h-11" disabled={remove.isPending} onClick={() => void run(() => remove.mutateAsync(note.id), () => setConfirming(null))}>{mt('cuNoteDeleteYes')}</Button>
                        <Button variant="outline" className="min-h-11" onClick={() => setConfirming(null)}>{mt('cancel')}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={mt('cuNoteEditLabel')} onClick={() => { setError(''); setConfirming(null); setEditing({ id: note.id, body: note.body }); }}>{mt('edit')}</Button>
                      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={mt('cuNoteDeleteLabel')} onClick={() => { setError(''); setEditing(null); setConfirming(note.id); }}>{mt('delete')}</Button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function authorLabel(note: CustomerNote) {
  return note.mine ? mt('cuNoteYou') : note.authorName || mt('cuNoteFormerAuthor');
}

export default CustomerNotes;
