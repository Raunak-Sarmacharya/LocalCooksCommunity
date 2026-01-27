import { useState, useEffect } from 'react';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';

export function useSuprSendVerification(subscriberId?: string) {
  const { user } = useFirebaseAuth();
  const [hmac, setHmac] = useState<string | null>(null);
  const [distinctId, setDistinctId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchVerification() {
      // Wait for auth to be ready
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const uid = currentUser.uid;
      
      // If subscriberId is provided, verify against that, otherwise use current user
      if (subscriberId && subscriberId !== uid) return;

      try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/suprsend/verification', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (res.ok && isMounted) {
            const data = await res.json();
            console.log('[SuprSend] Verification successful', data.distinctId);
            setHmac(data.userToken); // Reusing hmac state variable name to minimize refactor noise, treating it as 'verificationToken'
            setDistinctId(data.distinctId);
        } else {
             console.error('[SuprSend] Verification failed status:', res.status);
        }
      } catch (e) {
        console.error("[SuprSend] Failed to fetch verification", e);
      }
    }

    // Trigger on mount and user change
    fetchVerification();
    
    // Also set up an auth listener to trigger when auth initializes
    const unsubscribe = auth.onAuthStateChanged((u: any) => {
        if (u) fetchVerification();
    });

    return () => {
        isMounted = false;
        unsubscribe();
    };
  }, [user, subscriberId]);

  return { hmac, distinctId };
}
