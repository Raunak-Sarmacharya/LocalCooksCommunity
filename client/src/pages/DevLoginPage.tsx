import { useEffect, useRef, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Dev-only auto-login for TestSprite / local Playwright.
 * GET /dev-login?secret=...&email=...&role=chef&redirect=/dashboard
 * Production: server returns 404; this page shows the error.
 *
 * Readiness for harnesses:
 * - `data-testid="dev-login-root"` always present once React mounts
 * - `data-dev-login-state`: pending | redirecting | error
 * - Do NOT assert success while state=pending (spinner has 0 interactive controls)
 */

type LoginOk = { email: string; redirect: string };

/** Share one in-flight login across StrictMode remounts for the same query string. */
const inflightBySearch = new Map<string, Promise<LoginOk>>();

const LOGIN_TIMEOUT_MS = 45_000;

function setDevLoginState(state: "pending" | "redirecting" | "error") {
  document.documentElement.dataset.devLoginState = state;
}

async function performDevLogin(search: string): Promise<LoginOk> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const secret = params.get("secret") || "";
  const email = params.get("email") || undefined;
  const fresh = params.get("fresh") === "1" || params.get("fresh") === "true";
  const role = params.get("role") || "chef";
  const redirect = params.get("redirect") || "/dashboard";

  if (!secret) {
    throw new Error(
      "Missing ?secret= — set DEV_AUTH_BYPASS_SECRET and pass it in the URL (e.g. secret=tsb1)."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

  try {
    const res = await fetch("/api/dev/auth-bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, email, fresh, role }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      const hint =
        res.status === 403
          ? " Secret mismatch — use the exact DEV_AUTH_BYPASS_SECRET (short: tsb1)."
          : res.status === 404
            ? " Bypass is disabled (production or missing DEV_AUTH_BYPASS_SECRET)."
            : "";
      throw new Error((body.error || `HTTP ${res.status}`) + hint);
    }

    const data = await res.json();
    if (!data.customToken) throw new Error("No customToken in response");

    const cred = await signInWithCustomToken(auth, data.customToken);
    const token = await cred.user.getIdToken(true);

    // Warm profile so the destination page is less likely to race an empty auth sync.
    try {
      await fetch("/api/user/profile", {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: controller.signal,
      });
    } catch {
      /* non-fatal — redirect anyway */
    }

    return { email: data.email || email || "unknown", redirect };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Dev login timed out after ${LOGIN_TIMEOUT_MS / 1000}s waiting for /api/dev/auth-bypass or Firebase. Check the dev server and network.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getSharedLogin(search: string): Promise<LoginOk> {
  const existing = inflightBySearch.get(search);
  if (existing) return existing;
  const promise = performDevLogin(search).finally(() => {
    // Keep briefly so a remount during redirect can reuse; then drop.
    setTimeout(() => inflightBySearch.delete(search), 3_000);
  });
  inflightBySearch.set(search, promise);
  return promise;
}

/**
 * Dev-only auto-login for TestSprite.
 * GET /dev-login?secret=...&fresh=1&redirect=/dashboard&role=chef
 * Production: server returns 404; this page shows the error.
 */
export default function DevLoginPage() {
  const [status, setStatus] = useState("Signing in…");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const redirected = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDevLoginState("pending");
    setStatus("Requesting dev session…");

    const search = window.location.search;

    (async () => {
      try {
        // Drop cached failure so Retry works.
        if (attempt > 0) inflightBySearch.delete(search);

        const result = await getSharedLogin(search);
        // Redirect even if this effect was cancelled (StrictMode remount): login succeeded.
        setStatus(`Signed in as ${result.email} — redirecting…`);
        setDevLoginState("redirecting");
        logger.info(`[dev-login] signed in as ${result.email}, redirecting to ${result.redirect}`);

        if (!redirected.current) {
          redirected.current = true;
          window.location.replace(result.redirect);
        }
        void cancelled;
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Dev login failed";
        logger.error("[dev-login] failed:", err);
        setError(message);
        setStatus("Failed");
        setDevLoginState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 p-6"
      data-testid="dev-login-root"
      data-dev-login-state={error ? "error" : status.includes("redirecting") ? "redirecting" : "pending"}
    >
      {!error && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />}
      <p className="text-sm text-muted-foreground" data-testid="dev-login-status">
        {status}
      </p>
      {error && (
        <div className="flex max-w-md flex-col items-center gap-3" data-testid="dev-login-error">
          <p className="text-center text-sm text-red-600" role="alert">
            {error}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Harness tip: wait until URL leaves /dev-login (up to 45s). Do not assert while the spinner
            shows — there are intentionally no interactive controls until an error.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="dev-login-retry"
            onClick={() => {
              redirected.current = false;
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
