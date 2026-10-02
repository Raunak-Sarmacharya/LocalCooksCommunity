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
      className={overlay
        ? "fixed inset-0 z-[90] grid place-items-center bg-background/95 px-5 backdrop-blur-sm"
        : "grid min-h-screen place-items-center bg-[radial-gradient(circle_at_50%_42%,hsl(var(--primary)/0.06),transparent_32%)] px-5"}
    >
      <div className="w-full max-w-[23rem] px-5 py-8 text-center">
        <div className="relative mx-auto grid h-14 place-items-center">
          <div className="absolute size-20 rounded-full bg-primary/10 blur-2xl" aria-hidden="true" />
          <Logo variant="brand" className="relative h-11 w-auto" aria-hidden />
        </div>
        <p className="mt-6 text-lg font-semibold tracking-tight text-foreground">
          {message}
        </p>
        {submessage ? (
          <p className="mx-auto mt-2 max-w-[19rem] text-sm leading-6 text-muted-foreground">
            {submessage}
          </p>
        ) : null}
        <div className="mt-7 flex justify-center gap-1.5" aria-hidden="true">
          <span className="auth-loading-dot size-1.5 rounded-full bg-primary/65" />
          <span className="auth-loading-dot size-1.5 rounded-full bg-primary/65 [animation-delay:240ms]" />
          <span className="auth-loading-dot size-1.5 rounded-full bg-primary/65 [animation-delay:480ms]" />
        </div>
      </div>
    </div>
  );
}
