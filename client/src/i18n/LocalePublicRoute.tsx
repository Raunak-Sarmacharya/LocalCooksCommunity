import type { ComponentType, ReactElement } from "react";
import { Route } from "wouter";
import { SUPPORTED_LOCALES, type AppLocale } from "@shared/i18n";
import { changeAppLocale } from "@/i18n/locale-actions";
import { useEffect } from "react";

/**
 * Returns an array of explicit /en-CA…, /fr-CA…, /uk… Route elements
 * (never a greedy /:locale). Avoids stealing /dashboard and other
 * single-segment app paths.
 *
 * IMPORTANT: This is a **plain function**, not a React component, so that
 * wouter's <Switch> can introspect the returned <Route> elements via
 * React.Children.toArray. A component would be opaque to Switch.
 *
 * Usage inside <Switch>:
 *   {localePublicRoutes("/", LandingPage)}
 *   {localePublicRoutes("/terms", Terms)}
 */
export function localePublicRoutes(
  path: string,
  Component: ComponentType
): ReactElement[] {
  const suffix = path === "/" || path === "" ? "" : path;

  return SUPPORTED_LOCALES.map((locale) => (
    <Route key={`${locale}${suffix}`} path={`/${locale}${suffix}`}>
      <LocaleBoundPage locale={locale} Component={Component} />
    </Route>
  ));
}

function LocaleBoundPage({
  locale,
  Component,
}: {
  locale: AppLocale;
  Component: ComponentType;
}) {
  useEffect(() => {
    void changeAppLocale(locale);
  }, [locale]);

  return <Component />;
}
