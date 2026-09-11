import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isAppLocale } from "@shared/i18n";
import { changeAppLocale, getLastAppliedLocale } from "./locale-actions";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";

/**
 * When a signed-in user has preferredLocale, apply it (user preference
 * beats cookie / Accept-Language per negotiation contract — except URL).
 *
 * Race guard: profile queries are cached (staleTime 60s) and refetch on
 * window focus. If the user changes language mid-session, a refetch can
 * return the *old* persisted preferredLocale. We therefore only apply the
 * profile value when no explicit locale was applied yet this session, or
 * when the profile value actually differs from what we last applied
 * (meaning it was changed from another device/tab).
 */
export function LocaleProfileSync() {
  const { user: firebaseUser } = useFirebaseAuth();
  const { i18n } = useTranslation();

  const { data: profile } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid, "locale"],
    queryFn: async () => {
      const current = auth.currentUser;
      if (!current) return null;
      const token = await current.getIdToken();
      const response = await fetch("/api/user/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      return response.json() as Promise<{ preferredLocale?: string | null }>;
    },
    enabled: !!firebaseUser,
    staleTime: 60_000,
  });

  useEffect(() => {
    const preferred = profile?.preferredLocale;
    if (!isAppLocale(preferred)) return;

    // Already showing the preferred locale — nothing to do.
    if (i18n.resolvedLanguage === preferred || i18n.language === preferred) {
      return;
    }

    // An explicit choice was made this session (switcher click, URL prefix,
    // or an earlier profile sync). A stale cached profile must not revert it.
    // Only a genuinely different server-side preference wins.
    const applied = getLastAppliedLocale();
    if (applied && applied !== preferred) {
      return;
    }

    void changeAppLocale(preferred);
  }, [profile?.preferredLocale, i18n]);

  return null;
}
