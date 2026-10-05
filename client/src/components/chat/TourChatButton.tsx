import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { resolveTourConversation } from '@/services/chat-service';
import { hasTourConfirmation } from '@shared/tour-outcome';

export function tourHasChat(tour: { status: string; adminReviewDecision?: string | null; outcomeHistory?: unknown }) {
  return tour.status !== 'pending_local_cooks' && tour.adminReviewDecision !== 'denied' &&
    (tour.adminReviewDecision === 'approved' || (!tour.adminReviewDecision && hasTourConfirmation(tour)));
}
export function TourChatButton({ tour, role, onNavigate }: { tour: { id: number; status: string; adminReviewDecision?: string | null; outcomeHistory?: unknown }; role: 'chef' | 'manager'; onNavigate?: (path: string) => void }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!tourHasChat(tour)) return null;
  const open = async () => {
    setBusy(true); setError('');
    try { const result = await resolveTourConversation(tour.id); (onNavigate || navigate)(result.path); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not open messaging. Please retry.'); }
    finally { setBusy(false); }
  };
  return <div onClick={event => event.stopPropagation()}>
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void open()}>
      {busy ? 'Opening messages…' : role === 'chef' ? 'Message manager' : 'Message chef'}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive">{error} Select the message button to retry.</p>}
  </div>;
}
