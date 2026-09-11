import i18n from "@/i18n";

/** Common namespace translate — safe outside React components. */
export function tt(
  key: string,
  options?: Record<string, unknown>,
): string {
  return String(
    i18n.t(key as never, { ns: "common", ...options } as never),
  );
}
