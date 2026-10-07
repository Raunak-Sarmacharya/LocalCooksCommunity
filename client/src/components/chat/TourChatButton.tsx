import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { resolveTourConversation, resolveAdminTourConversation } from '@/services/chat-service';
import { hasTourConfirmation } from '@shared/tour-outcome';
import UnifiedChatView from './UnifiedChatView';
import ChatPanel from './ChatPanel';

export function tourHasChat(tour: { status: string; adminReviewDecision?: string | null; outcomeHistory?: unknown }) {
  return tour.status !== 'pending_local_cooks' && tour.adminReviewDecision !== 'denied' &&
    (tour.adminReviewDecision === 'approved' || (!tour.adminReviewDecision && hasTourConfirmation(tour)));
}
export function TourChatButton({ tour, role, openFromLink = false, buttonClassName, buttonLabel, initialDraft }: { tour: { id: number; status: string; adminReviewDecision?: string | null; confirmedAt?: string | null; outcomeHistory?: unknown }; role: 'chef' | 'manager' | 'admin'; openFromLink?: boolean; buttonClassName?: string; buttonLabel?: string; initialDraft?: string }) {
  const search = useSearch();
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [chat, setChat] = useState<{ conversationId: string; userId: number; name: string; chefId: number; managerId: number; locationId: number } | null>(null);
  const openedLink = useRef<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const allowed = tourHasChat(tour);
  const open = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await (role === 'admin' ? resolveAdminTourConversation : resolveTourConversation)(tour.id);
      const userId = role === 'manager' ? result.managerId : result.chefId;
      if (!result.conversationId || !Number.isSafeInteger(userId) || userId <= 0) throw Error('Messaging unavailable. Please retry.');
      setChat({ conversationId: result.conversationId, userId, name: role === 'chef' ? result.managerName || 'Kitchen manager' : result.chefName || 'Chef', chefId: result.chefId, managerId: result.managerId, locationId: result.locationId });
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
  if (!allowed && role !== 'admin') return null;
  return <div onClick={event => event.stopPropagation()}>
    <Button ref={button} variant="outline" size="sm" className={buttonClassName} title={buttonLabel} disabled={busy || !allowed} onClick={() => void open()}>
      {busy ? t('tourChatOpening', 'Opening messages…') : buttonLabel || (role === 'chef' ? t('tourMessageManager', 'Message manager') : t('tourMessageChef', 'Message chef'))}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive">{error} Select the message button to retry.</p>}
    <Dialog open={!!chat} onOpenChange={value => { if (!value) setChat(null); }}>
      <DialogContent showCloseButton onCloseAutoFocus={event => { event.preventDefault(); button.current?.focus(); }}
        className="flex h-[85dvh] w-[calc(100%_-_1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle>{role === 'admin' ? t('tourChatConversation', 'Tour conversation') : t('tourChatWithName', { name: chat?.name, defaultValue: `Chat with ${chat?.name}` })}</DialogTitle>
          <DialogDescription>Kitchen tour · TOUR-{tour.id}{role === 'admin' && <> · {t('tourChatBothRecipients', 'Messages are shared with both the chef and kitchen manager.')}</>}</DialogDescription>
        </div>
        {chat && <div className="min-h-0 flex-1 overflow-hidden">{role === 'admin'
          ? <ChatPanel conversationId={chat.conversationId} chefId={chat.chefId} managerId={chat.managerId} locationId={chat.locationId} chefName={chat.name} viewerRole="admin" embedded />
          : <UnifiedChatView userId={chat.userId} role={role} initialDraft={initialDraft}
            initialConversationId={chat.conversationId} initialTourId={String(tour.id)} hideConversationList />}</div>}
      </DialogContent>
    </Dialog>
  </div>;
}
