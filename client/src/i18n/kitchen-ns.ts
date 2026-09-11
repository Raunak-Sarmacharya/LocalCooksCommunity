import i18n from "@/i18n";

/** Kitchen namespace translate — safe outside React components. */
export function kt(
  key: string,
  options?: Record<string, unknown>,
): string {
  return String(
    i18n.t(key as never, { ns: "kitchen", ...options } as never),
  );
}
