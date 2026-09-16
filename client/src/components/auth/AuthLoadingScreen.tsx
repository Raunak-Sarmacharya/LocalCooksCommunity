import { Loader2 } from "lucide-react";
import Logo from "@/components/ui/logo";

interface AuthLoadingScreenProps {
  /** Primary line. Keep it specific — "Finishing your account…" beats "Loading…". */
  message: string;
  /** Optional second line. */
  submessage?: string;
  /** Render inside a fixed overlay instead of filling the viewport. */
  overlay?: boolean;
}

/**
 * One loading screen for every auth transition.
 *
 * The app used to grow a slightly different spinner in each route guard
 * (`ProtectedRoute`, `AdminProtectedRoute`, `ManagerProtectedRoute`,
 * `ManagerLogin`, `EnhancedAuthPage`). They did not agree on *when* to stop
 * showing, which is why a successful registration could drop its own overlay,
 * flash the login form, and only then land on the dashboard.
 *
 * This component owns only the visual; the decision of when a transition is
 * finished lives in `useFirebaseAuth().loading` (see `isSessionSettling`).
 */
export default function AuthLoadingScreen({
  message,
  submessage,
  overlay = false,
}: AuthLoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={
        overlay
          ? "fixed inset-0 z-[90] flex items-center justify-center bg-background/95 px-6 backdrop-blur-sm"
          : "flex min-h-screen items-center justify-center bg-background px-6"
      }
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <Logo variant="brand" className="mb-6 h-9 w-auto" aria-hidden />
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="mt-5 text-base font-semibold tracking-tight text-foreground">
          {message}
        </p>
        {submessage ? (
          <p className="mt-2 max-w-[19rem] text-sm leading-6 text-muted-foreground">
            {submessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
