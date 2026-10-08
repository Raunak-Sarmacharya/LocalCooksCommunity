import { useTranslation } from "react-i18next";

export const isNumericWeeklyHours = (value: unknown) => /^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\+?$/.test(String(value).trim());

const labels: Record<string, string> = {
  intendedUse: "Intended use",
  estimatedWeeklyHours: "Estimated weekly hours",
  hasLicense: "Food handler licence",
  targetStartDate: "Target start date",
  additionalInfo: "Additional information",
};

/** Render saved answers without treating an unanswered legacy question as No. */
export function TourIntakeDetails({ data }: { data: Record<string, unknown> | null | undefined }) {
  const { t } = useTranslation("common");
  const entries = Object.entries(data || {}).filter(([, value]) =>
    value != null && String(value).trim() !== "" && ["string", "number", "boolean"].includes(typeof value));
  if (!entries.length) return null;
  const answer = (key: string, value: unknown) => {
    if (typeof value === "boolean") return t(value ? "tourIntakeYes" : "tourIntakeNo", value ? "Yes" : "No");
    if (key === "estimatedWeeklyHours" && isNumericWeeklyHours(value)) return t("tourIntakeHoursPerWeek", { defaultValue: `${String(value)} hours per week`, hours: String(value) });
    if (key === "targetStartDate" && value === "not_decided") return t("tourIntakeNotDecided", "Not decided yet");
    if (key === "intendedUse") {
      const uses: Record<string, string> = { catering: "Catering", meal_prep: "Meal preparation", food_truck: "Food truck", baking: "Baking", other: "Other" };
      if (uses[String(value)]) return t(`tourIntakeUse_${value}`, uses[String(value)]);
    }
    // Calendar dates are already YYYY-MM-DD: never interpret them as UTC instants.
    return String(value);
  };
  return <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
    {entries.map(([key, value]) => <div key={key} className="min-w-0">
      <dt className="text-xs text-muted-foreground">{key === "estimatedWeeklyHours" && !isNumericWeeklyHours(value) ? t("tourIntakeWeeklyAvailability", "Weekly availability") : t(`tourIntakeLabel_${key}`, labels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "))}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{answer(key, value)}</dd>
    </div>)}
  </dl>;
}
