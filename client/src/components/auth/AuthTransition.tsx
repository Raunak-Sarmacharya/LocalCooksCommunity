import { logger } from "@/lib/logger";
import { queryClient } from "@/lib/queryClient";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AuthLoadingScreen from "./AuthLoadingScreen";

/**
 * Cross-route loading handoff.
 *
 * Authentication is finished by two different components: the form owns the
 * overlay ("Creating your account…") and the page owns the redirect. Each used
 * to release the screen as soon as *its own* work was done, so there was a
 * window — 300 to 600 ms in practice — where neither was showing anything and
 * the login form reappeared in front of a perfectly good session. That is the
 * flash users describe as "it looks like I have not been logged in".
 *
 * This provider closes that window. `begin()` is called immediately before a
 * post-authentication navigation; the overlay it renders lives above the
 * router, so it survives the route change, and it is released only once the
 * destination's queries have actually settled. The destination renders
 * underneath the whole time, so its data really is loading in the background.
 */

import {
  HANDOFF_MAX_HOLD_MS,
  HANDOFF_MIN_HOLD_MS,
  HANDOFF_QUIET_SAMPLES,
  HANDOFF_SAMPLE_MS,
} from "@/config/auth-timing";

/**
 * How many queries are loading content the user has not seen yet.
 *
 * Deliberately counts only queries still in `pending` — a first load — and not
 * every in-flight request. Several screens poll on an interval; counting those
 * would keep the overlay up for the full ceiling on every visit.
 *
 * Read imperatively rather than through `useIsFetching()`: subscribing would
 * re-render this provider, and therefore the entire router below it, on every
 * fetch in the application.
 */
function countPendingQueries(): number {
  try {
    return queryClient
      .getQueryCache()
      .findAll({ fetchStatus: "fetching" })
      .filter((query) => query.state.status === "pending").length;
  } catch {
    return 0;
  }
}

interface AuthTransitionValue {
  isHolding: boolean;
  /**
   * Show the handoff overlay. Call this immediately before navigating away
   * from an auth screen, never before work that might still fail — every
   * failure path must call `end()`.
   */
  begin: (message: string, submessage?: string) => void;
  /** Release the overlay. Safe to call when nothing is holding. */
  end: () => void;
}

const AuthTransitionContext = createContext<AuthTransitionValue | undefined>(undefined);

export function AuthTransitionProvider({ children }: { children: ReactNode }) {
  const [holding, setHolding] = useState<{ message: string; submessage?: string } | null>(null);
  const startedAtRef = useRef(0);

  const end = useCallback(() => {
    startedAtRef.current = 0;
    setHolding(null);
  }, []);

  const begin = useCallback((message: string, submessage?: string) => {
    startedAtRef.current = Date.now();
    setHolding({ message, submessage });
  }, []);

  useEffect(() => {
    if (!holding) return;

    let quietSamples = 0;

    const release = (reason: string) => {
      logger.info(`✅ Auth handoff released (${reason})`);
      end();
    };

    const tick = () => {
      const elapsed = Date.now() - startedAtRef.current;

      if (elapsed >= HANDOFF_MAX_HOLD_MS) {
        release("hard cap reached");
        return;
      }

      if (countPendingQueries() === 0) quietSamples += 1;
      else quietSamples = 0;

      if (elapsed >= HANDOFF_MIN_HOLD_MS && quietSamples >= HANDOFF_QUIET_SAMPLES) {
        release("destination queries settled");
      }
    };

    // Settle the first sample immediately so a fully cached destination is held
    // for the anti-flicker floor rather than for one extra interval.
    tick();
    const interval = window.setInterval(tick, HANDOFF_SAMPLE_MS);
    return () => window.clearInterval(interval);
  }, [holding, end]);

  const value = useMemo<AuthTransitionValue>(
    () => ({ isHolding: holding !== null, begin, end }),
    [holding, begin, end],
  );

  return (
    <AuthTransitionContext.Provider value={value}>
      {children}
      {holding ? (
        <AuthLoadingScreen overlay message={holding.message} submessage={holding.submessage} />
      ) : null}
    </AuthTransitionContext.Provider>
  );
}

export function useAuthTransition(): AuthTransitionValue {
  const context = useContext(AuthTransitionContext);
  if (context === undefined) {
    throw new Error("useAuthTransition must be used within an AuthTransitionProvider");
  }
  return context;
}
