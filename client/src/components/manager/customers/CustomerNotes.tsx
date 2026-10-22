import { useState } from 'react';
import { Lock } from 'lucide-react';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { cn } from '@/lib/utils';
import { btnSecondary, focusRing, linkTertiary } from '@/components/dashboard/dashboard-ui';
import { formatDay } from './customer-format';
import type { CustomerNote } from './customer-types';
import { useCustomerNotes } from './use-customers';

const MAX = 2000;
const countFormat = (value: number, locale: string) => new Intl.NumberFormat(locale).format(value);
const field = 'mt-3 block w-full resize-y rounded-lg border-0 px-3 py-[9px] text-sm leading-5 text-stone-900 caret-primary shadow-[inset_0_0_0_1px_#d6d3d1] placeholder:text-stone-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary';

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
    <div>
      <p className="flex gap-2 rounded-lg bg-stone-100 px-3 py-2.5 text-[13px] leading-[18px] text-stone-600" data-testid="notes-banner">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-stone-500" aria-hidden />{mt('cuNotesBanner', { name })}
      </p>

      <form onSubmit={event => { event.preventDefault(); if (draft.trim() && !add.isPending) void run(() => add.mutateAsync(draft.trim()), () => setDraft('')); }}>
        <label htmlFor="customer-note-new" className="sr-only">{mt('cuNoteLabel')}</label>
        <textarea id="customer-note-new" value={draft} maxLength={MAX} rows={3} placeholder={mt('cpNotePlaceholder')} className={cn(field, 'min-h-[72px]')}
          onChange={event => setDraft(event.target.value)} aria-describedby="customer-note-new-count" />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-500">
          <span id="customer-note-new-count">{mt('cuNoteCount', { count: countFormat(draft.length, locale), max: countFormat(MAX, locale) })}</span>
          <button type="submit" className={btnSecondary} disabled={!draft.trim() || add.isPending}>{mt('cuNoteAdd')}</button>
        </div>
      </form>

      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {query.isPending ? <div className="mt-3 h-12 animate-pulse rounded-md bg-[#efedeb] motion-reduce:animate-none" />
        : query.isError ? <p role="alert" className="mt-3 text-sm text-red-700">{mt('cuNotesLoadError')}</p>
        : query.data.length === 0 ? <p className="mt-3 border-t border-[#f0eeec] pt-3 text-[13px] text-stone-500">{mt('cuNoNotes')}</p>
        : (
          <ul>
            {query.data.map(note => (
              <li key={note.id} className="mt-3 border-t border-[#f0eeec] pb-0.5 pt-3">
                {editing?.id === note.id ? (
                  <form onSubmit={event => { event.preventDefault(); if (editing.body.trim() && !edit.isPending) void run(() => edit.mutateAsync({ id: note.id, body: editing.body.trim() }), () => setEditing(null)); }}>
                    <label htmlFor={`customer-note-${note.id}`} className="sr-only">{mt('cuNoteEditLabel')}</label>
                    <textarea id={`customer-note-${note.id}`} autoFocus value={editing.body} maxLength={MAX} rows={3} className={cn(field, 'mt-0')} onChange={event => setEditing({ id: note.id, body: event.target.value })} />
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>{mt('cancel')}</button>
                      <button type="submit" className={btnSecondary} disabled={!editing.body.trim() || edit.isPending}>{mt('cuNoteSave')}</button>
                    </div>
                  </form>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-5 text-stone-900">{note.body}</p>
                )}
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-stone-500">
                  <span>{mt('cuNoteBy', { author: authorLabel(note), when: formatDay(note.createdAt, timezone, locale) })}{note.edited ? ` · ${mt('cuNoteEdited')}` : ''}</span>
                  {note.mine && editing?.id !== note.id && confirming !== note.id && (
                    <span className="flex gap-3">
                      <button type="button" className={cn(linkTertiary, 'text-xs')} aria-label={mt('cuNoteEditLabel')} onClick={() => { setError(''); setConfirming(null); setEditing({ id: note.id, body: note.body }); }}>{mt('edit')}</button>
                      <button type="button" className={cn(linkTertiary, 'text-xs')} aria-label={mt('cuNoteDeleteLabel')} onClick={() => { setError(''); setEditing(null); setConfirming(note.id); }}>{mt('delete')}</button>
                    </span>
                  )}
                </div>
                {confirming === note.id && (
                  <div role="group" aria-label={mt('cuNoteDeleteConfirm')} className="mt-2 rounded-lg bg-red-50 p-3">
                    <p className="text-[13px] text-red-800">{mt('cuNoteDeleteConfirm')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className={cn(btnSecondary, 'text-red-700 ring-red-200 hover:bg-red-50', focusRing)} disabled={remove.isPending} onClick={() => void run(() => remove.mutateAsync(note.id), () => setConfirming(null))}>{mt('cuNoteDeleteYes')}</button>
                      <button type="button" className={btnSecondary} onClick={() => setConfirming(null)}>{mt('cancel')}</button>
                    </div>
                  </div>
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
