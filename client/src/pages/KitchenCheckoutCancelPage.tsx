import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { auth } from '@/lib/firebase';

export default function KitchenCheckoutCancelPage() {
  const [, navigate] = useLocation();
  const [error, setError] = useState('');

  useEffect(() => {
    const holdId = new URLSearchParams(window.location.search).get('hold_id');
    if (!holdId) {
      setError('Missing checkout reference. Your reservation will expire automatically.');
      return;
    }
    let active = true;
    (async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Please sign in to cancel this checkout.');
      const response = await fetch('/api/chef/bookings/checkout/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ holdId }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Could not release your checkout reservation.');
      }
      if (active) navigate('/dashboard?tab=kitchens', { replace: true });
    })().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not cancel checkout.');
    });
    return () => { active = false; };
  }, [navigate]);

  return <main className="mx-auto max-w-lg p-8 text-center">
    <p>{error || 'Cancelling checkout and releasing your reservation…'}</p>
    {error && <a className="mt-4 inline-block underline" href="/dashboard?tab=kitchens">Return to dashboard</a>}
  </main>;
}
