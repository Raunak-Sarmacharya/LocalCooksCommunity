import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { resolveTourConversation } from '@/services/chat-service';
import { hasTourConfirmation } from '@shared/tour-outcome';
import UnifiedChatView from './UnifiedChatView';

export function tourHasChat(tour: { status: string; adminReviewDecision?: string | null; outcomeHistory?: unknown }) {
  return tour.status !== 'pending_local_cooks' && tour.adminReviewDecision !== 'denied' &&
    (tour.adminReviewDecision === 'approved' || (!tour.adminReviewDecision && hasTourConfirmation(tour)));
}
export function TourChatButton({ tour, role, openFromLink = false, buttonClassName }: { tour: { id: number; status: string; adminReviewDecision?: string | null; outcomeHistory?: unknown }; role: 'chef' | 'manager'; openFromLink?: boolean; buttonClassName?: string }) {
  const search = useSearch();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [chat, setChat] = useState<{ conversationId: string; userId: number; name: string } | null>(null);
  const openedLink = useRef<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const allowed = tourHasChat(tour);
  const open = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await resolveTourConversation(tour.id);
      const userId = role === 'chef' ? result.chefId : result.managerId;
      if (!result.conversationId || !Number.isSafeInteger(userId) || userId <= 0) throw Error('Messaging unavailable. Please retry.');
      setChat({ conversationId: result.conversationId, userId, name: role === 'chef' ? result.managerName || 'Kitchen manager' : result.chefName || 'Chef' });
    }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not open messaging. Please retry.'); }
    finally { setBusy(false); }
  }, [tour.id, role]);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (openFromLink && allowed && params.get('viewing') === String(tour.id) && params.get('action') === 'message' && openedLink.current !== search) {
      openedLink.current = search;
      void open();
    }
  }, [search, openFromLink, allowed, tour.id, open]);
  if (!allowed) return null;
  return <div onClick={event => event.stopPropagation()}>
    <Button ref={button} variant="outline" size="sm" className={buttonClassName} disabled={busy} onClick={() => void open()}>
      {busy ? 'Opening messages…' : role === 'chef' ? 'Message manager' : 'Message chef'}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive">{error} Select the message button to retry.</p>}
    <Dialog open={!!chat} onOpenChange={value => { if (!value) setChat(null); }}>
      <DialogContent showCloseButton onCloseAutoFocus={event => { event.preventDefault(); button.current?.focus(); }}
        className="flex h-[85dvh] w-[calc(100%_-_1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle>Chat with {chat?.name}</DialogTitle>
          <DialogDescription>Kitchen tour · TOUR-{tour.id}</DialogDescription>
        </div>
        {chat && <div className="min-h-0 flex-1 overflow-hidden"><UnifiedChatView userId={chat.userId} role={role}
          initialConversationId={chat.conversationId} initialTourId={String(tour.id)} hideConversationList /></div>}
      </DialogContent>
    </Dialog>
  </div>;
}
