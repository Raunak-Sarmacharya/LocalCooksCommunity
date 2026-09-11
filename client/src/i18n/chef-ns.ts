import i18n from "@/i18n";

/** Chef namespace translate — safe outside React components. */
export function ct(
  key: string,
  options?: Record<string, unknown>,
): string {
  return String(
    i18n.t(key as never, { ns: "chef", ...options } as never),
  );
}
