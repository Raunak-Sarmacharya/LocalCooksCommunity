import type { Request, Response, NextFunction } from "express";
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  negotiateLocale,
  type AppLocale,
} from "@shared/i18n";

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [k, ...rest] = part.trim().split("=");
      return [k, decodeURIComponent(rest.join("=") || "")];
    })
  );
}

declare global {
  namespace Express {
    interface Request {
      locale?: AppLocale;
      localeSource?: string;
    }
  }
}

/**
 * Attaches req.locale using industrial negotiation order.
 * URL locale is not available on API routes; uses user → cookie → header → Accept-Language.
 */
export function localeMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const cookies = parseCookieHeader(req.headers.cookie);
  const userLocale =
    (req as Request & { neonUser?: { preferredLocale?: string | null } })
      .neonUser?.preferredLocale ?? null;

  const result = negotiateLocale({
    userPreferredLocale: userLocale,
    cookieLocale: cookies[LOCALE_COOKIE] ?? null,
    headerLocale:
      (typeof req.headers[LOCALE_HEADER] === "string"
        ? req.headers[LOCALE_HEADER]
        : null) ?? null,
    acceptLanguage: req.headers["accept-language"] ?? null,
  });

  req.locale = result.locale;
  req.localeSource = result.source;
  next();
}
