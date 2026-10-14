import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { claimRequest, claimMoney, type DamageClaimCardData } from '@/lib/damage-claims';

let stripePromise: ReturnType<typeof loadStripe> | undefined;
function paymentProvider() {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) return undefined;
  return stripePromise ||= loadStripe(key);
}
export default function DamageClaimPayment({ claim, onClose, onPaid }: { claim: DamageClaimCardData; onClose: () => void; onPaid: () => void }) {
  const { t } = useTranslation('booking');
  const provider = paymentProvider();
  return <Dialog open onOpenChange={value => { if (!value) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t('dcV2PaymentTitle')}</DialogTitle><DialogDescription>{t('dcV2PaymentIntro')}</DialogDescription></DialogHeader>
    {provider ? <Elements stripe={provider}><PayForm claim={claim} onPaid={onPaid} /></Elements> : <p role="alert">{t('dcV2PaymentUnavailable')}</p>}
  </DialogContent></Dialog>;
}
function PayForm({ claim, onPaid }: { claim: DamageClaimCardData; onPaid: () => void }) {
  const { t, i18n } = useTranslation('booking'), stripe = useStripe(), elements = useElements(), queryClient = useQueryClient();
  const [newCard, setNewCard] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const started = useRef(false);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setError('');
    try {
      const payment = await claimRequest<{ clientSecret: string; hasSavedCard: boolean }>(`/chef/damage-claims/${claim.id}/pay`, { newCard });
      const card = elements.getElement(CardElement);
      if (!payment.hasSavedCard && !newCard) { setNewCard(true); throw Error(t('dcV2AddCard')); }
      const result = await stripe.confirmCardPayment(payment.clientSecret, newCard && card ? { payment_method: { card } } : {});
      if (result.error) throw Error(result.error.message || t('dcV2PaymentFailed'));
      const verified = await claimRequest<{ success: boolean }>(`/chef/damage-claims/${claim.id}/sync`, {});
      if (!verified.success) throw Error(t('dcV2Processing'));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['damage-claims'] }), queryClient.invalidateQueries({ queryKey: ['damage-claim-booking-hold'] }),
        queryClient.invalidateQueries({ queryKey: ['chef-outstanding-dues'] }), queryClient.invalidateQueries({ queryKey: ['chef-damage-claims-v2'] })]);
      onPaid();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2PaymentFailed')); } finally { setBusy(false); }
  };
  const changeCard = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await claimRequest(`/chef/damage-claims/${claim.id}/cancel-payment`, {}); setNewCard(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2Failed')); } finally { setBusy(false); }
  };
  // Mounting this form is the chef's explicit Pay tap. Stripe.js handles any bank authentication on-session.
  useEffect(() => { if (stripe && elements && !started.current) { started.current = true; void pay(); } }, [stripe, elements, pay]);
  return <div className="space-y-4">
    <p className="text-sm">{t(newCard ? 'dcV2NewCard' : 'dcV2SavedCard')}</p>
    {newCard ? <div className="rounded-lg border p-3"><CardElement /></div> : <Button variant="link" disabled={busy} onClick={() => void changeCard()}>{t('dcV2UseNewCard')}</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button className="w-full" disabled={!stripe || busy} onClick={() => void pay()}>{t(busy ? 'dcV2Paying' : 'dcV2Pay', { amount: claimMoney(claim.amountCents, i18n.language) })}</Button>
  </div>;
}
