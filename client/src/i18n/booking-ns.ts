import i18n from "@/i18n";

/** Booking namespace translate — safe outside React components. */
export function bt(
  key: string,
  options?: Record<string, unknown>,
): string {
  return String(
    i18n.t(key as never, { ns: "booking", ...options } as never),
  );
}
