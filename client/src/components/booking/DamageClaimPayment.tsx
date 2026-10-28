import { useEffect, useState } from 'react';
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
type Prepared = { clientSecret: string; hasSavedCard: boolean; card: { brand: string; last4: string } | null };
const brandName = (brand: string) => brand === 'amex' ? 'Amex' : brand.charAt(0).toUpperCase() + brand.slice(1);
function PayForm({ claim, onPaid }: { claim: DamageClaimCardData; onPaid: () => void }) {
  const { t, i18n } = useTranslation('booking'), stripe = useStripe(), elements = useElements(), queryClient = useQueryClient();
  const [newCard, setNewCard] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const prepare = (fresh: boolean) => claimRequest<Prepared>(`/chef/damage-claims/${claim.id}/pay`, { newCard: fresh });
  // Opening only creates an unconfirmed payment (nothing charged) so the button can name the card; money moves on the Pay tap.
  useEffect(() => {
    let live = true;
    prepare(false).then(payment => { if (live) payment.hasSavedCard ? setPrepared(payment) : setNewCard(true); })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : t('dcV2PaymentFailed')); })
    return () => { live = false; };
  }, [claim.id]);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setError('');
    try {
      const payment = !newCard && prepared ? prepared : await prepare(newCard);
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
    try { await claimRequest(`/chef/damage-claims/${claim.id}/cancel-payment`, {}); setPrepared(null); setNewCard(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2Failed')); } finally { setBusy(false); }
  };
  const amount = claimMoney(claim.amountCents, i18n.language), saved = !newCard && prepared?.card;
  return <div className="space-y-4">
    {newCard && <p className="text-sm">{t('dcV2NewCard')}</p>}
    {newCard ? <div className="rounded-lg border p-3"><CardElement /></div> : null}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button className="w-full" disabled={!stripe || busy || (!newCard && !prepared && !error)} onClick={() => void pay()}>
      {busy ? t('dcV2Paying') : saved ? t('dcV2PaySaved', { amount, brand: brandName(saved.brand), last4: saved.last4 })
        : t(newCard ? 'dcV2Pay' : 'dcV2PaySavedPlain', { amount })}</Button>
    {!newCard && <Button variant="link" className="w-full" disabled={busy || (!prepared && !error)} onClick={() => void changeCard()}>{t('dcV2UseNewCard')}</Button>}
  </div>;
}
