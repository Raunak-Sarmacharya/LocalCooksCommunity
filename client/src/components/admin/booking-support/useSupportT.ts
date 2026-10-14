import { useTranslation } from "react-i18next";

export type SupportT = (key: string, options?: Record<string, unknown>) => string;

/** Admin-namespace translator with plain string keys (many keys are built from action/status codes). */
export function useSupportT(): SupportT {
  const { t } = useTranslation("admin");
  return t as unknown as SupportT;
}
