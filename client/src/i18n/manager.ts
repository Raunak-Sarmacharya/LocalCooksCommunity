import i18n from "@/i18n";

/** Manager namespace translate — safe outside React components. */
export function mt(
  key: string,
  options?: Record<string, unknown>,
): string {
  return String(
    i18n.t(key as never, { ns: "manager", ...options } as never),
  );
}
