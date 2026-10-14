import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { bookingFeedbackTags, feedbackInputForRole, type BookingFeedbackRole, type BookingFeedbackState } from '@shared/booking-feedback';

export function BookingFeedbackCard({ bookingId, role, otherPartyName, timezone }: {
  bookingId: number; role: BookingFeedbackRole; otherPartyName: string; timezone: string;
}) {
  const { t, i18n } = useTranslation('booking');
  const client = useQueryClient(), mobile = useIsMobile(), noteId = useId(), section = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false), [rating, setRating] = useState(0), [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const endpoint = role === 'chef' ? `/api/bookings/${bookingId}/feedback` : `/api/manager/bookings/${bookingId}/feedback`;
  const queryKey = ['booking-feedback', auth.currentUser?.uid, role, bookingId];
  const headers = async () => {
    const token = await auth.currentUser?.getIdToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };
  const query = useQuery<BookingFeedbackState>({ queryKey, retry: false,
    queryFn: async () => {
      const response = await fetch(endpoint, { headers: await headers(), credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw Error(t('privateFeedback.loadError'));
      return response.json();
    } });
  useEffect(() => {
    if (query.data && (query.data.available || query.data.response) && window.location.hash === '#feedback')
      section.current?.scrollIntoView?.({ block: 'start' });
  }, [query.data]);
  useEffect(() => { setEditing(false); setRating(0); setTags([]); setComment(''); setError(''); }, [bookingId, role]);
  const state = query.data;
  if (!state || !state.available && !state.response) return null;
  const privacy = t('privateFeedback.privacy', { name: otherPartyName });
  const question = t(`privateFeedback.${role}Question`, { name: otherPartyName });
  const tagLabel = (tag: string) => {
    const allowed = bookingFeedbackTags[role].find(value => value === tag);
    return allowed ? t(`privateFeedback.tags.${allowed}`) : '';
  };
  const chooseRating = (value: number) => { setRating(value); setEditing(true); setError(''); };
  const stars = () => <div role="radiogroup" aria-label={t('privateFeedback.rating')} className="flex flex-wrap gap-1">
    {[1, 2, 3, 4, 5].map(value => <button key={value} type="button" role="radio" aria-checked={rating === value}
      aria-label={t('privateFeedback.star', { count: value })} disabled={saving} tabIndex={rating === value || !rating && value === 1 ? 0 : -1}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      onClick={() => chooseRating(value)} onKeyDown={event => {
        const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? value % 5 + 1
          : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (value + 3) % 5 + 1 : event.key === 'Home' ? 1 : event.key === 'End' ? 5 : null;
        if (next) { event.preventDefault(); chooseRating(next); (event.currentTarget.parentElement?.children[next - 1] as HTMLElement)?.focus(); }
      }}><Star aria-hidden="true" className={`h-6 w-6 ${value <= rating ? 'fill-primary text-primary' : 'text-muted-foreground'}`} /></button>)}
  </div>;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const parsed = feedbackInputForRole(role).safeParse({ rating, tags, comment });
    if (!parsed.success) { setError(t(rating ? 'privateFeedback.invalid' : 'privateFeedback.required')); return; }
    setSaving(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: await headers(), credentials: 'include', body: JSON.stringify(parsed.data) });
      if (!response.ok) throw Error(t('privateFeedback.saveError'));
      client.setQueryData(queryKey, await response.json()); setEditing(false);
    } catch { setError(t('privateFeedback.saveError')); await query.refetch(); }
    finally { setSaving(false); }
  };
  const form = <form onSubmit={save} className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
    {mobile && stars()}
    <div className="flex flex-wrap gap-2">{bookingFeedbackTags[role].map(tag => <Button key={tag} type="button" variant={tags.includes(tag) ? 'default' : 'outline'}
      aria-pressed={tags.includes(tag)} disabled={saving} className="h-auto min-h-11 max-w-full whitespace-normal text-left"
      onClick={() => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])}>{tagLabel(tag)}</Button>)}</div>
    <div className="space-y-2"><label htmlFor={noteId} className="text-sm font-medium">{t('privateFeedback.note')}</label>
      <Textarea id={noteId} value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} disabled={saving} className="min-w-0" />
      <p className="text-right text-xs text-muted-foreground">{comment.length}/1000</p></div>
    <p className="text-sm text-muted-foreground">{privacy}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={saving || query.isFetching} className="min-h-11">{t('privateFeedback.send')}</Button>
  </form>;
  const answer = state.response;
  return <section id="feedback" ref={section} className="min-w-0 scroll-mt-6 [overflow-wrap:anywhere]" aria-label={t('privateFeedback.title')}>
    <Card><CardHeader><CardTitle className="text-lg">{t('privateFeedback.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {answer ? <>
          <p>{t('privateFeedback.sent', { date: new Intl.DateTimeFormat(i18n.language || 'en-CA', { timeZone: timezone, dateStyle: 'medium' }).format(new Date(answer.createdAt)) })}</p>
          <p role="status">{t('privateFeedback.thanks')}</p><p aria-label={t('privateFeedback.star', { count: answer.rating })}>{'★'.repeat(answer.rating)}{'☆'.repeat(5 - answer.rating)}</p>
          <div className="flex flex-wrap gap-2">{answer.tags.map(tag => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-sm">{tagLabel(tag)}</span>)}</div>
          {answer.comment && <p className="whitespace-pre-wrap">{answer.comment}</p>}<p className="text-sm text-muted-foreground">{privacy}</p>
        </> : <><p className="font-medium">{question}</p>{stars()}
          {!editing && <p className="text-sm text-muted-foreground">{privacy}</p>}
          {!mobile && editing && form}
          {mobile && <Sheet open={editing} onOpenChange={value => { if (!saving) setEditing(value); }}>
            <SheetContent side="bottom" hideClose className="max-h-[90dvh] overflow-y-auto" aria-describedby={`${noteId}-privacy`}>
              <SheetClose asChild><Button type="button" variant="ghost" disabled={saving} className="mb-2 min-h-11">{t('privateFeedback.close')}</Button></SheetClose>
              <SheetHeader className="mb-4"><SheetTitle>{question}</SheetTitle><SheetDescription id={`${noteId}-privacy`}>{privacy}</SheetDescription></SheetHeader>{form}
            </SheetContent>
          </Sheet>}
        </>}
      </CardContent>
    </Card>
  </section>;
}
