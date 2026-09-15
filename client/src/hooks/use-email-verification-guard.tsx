import { useCallback, useState } from "react";

import EmailVerificationGate from "@/components/auth/EmailVerificationGate";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { requiresEmailVerification } from "@/lib/auth-verification";

/**
 * Blocks a mutating action behind email verification and explains why.
 *
 * The server refuses these requests outright, so this exists purely so the user
 * gets the gate instead of a bare 403. Deliberately pairs with an *enabled*
 * button: a disabled control that never says why is worse than a refusal with a
 * way forward.
 *
 * Usage:
 *   const { guard, gate } = useEmailVerificationGuard();
 *   <Button onClick={() => guard(() => submit())}>Request to book</Button>
 *   {gate}
 */
export function useEmailVerificationGuard() {
  const { user } = useFirebaseAuth();
  const [open, setOpen] = useState(false);
  const blocked = requiresEmailVerification(user, user);

  const guard = useCallback(
    <T,>(action: () => T): T | undefined => {
      if (blocked) {
        setOpen(true);
        return undefined;
      }
      return action();
    },
    [blocked]
  );

  const openGate = useCallback(() => setOpen(true), []);

  const gate = (
    <EmailVerificationGate open={open} role={user?.role} onOpenChange={setOpen} />
  );

  return { blocked, guard, openGate, gate };
}
