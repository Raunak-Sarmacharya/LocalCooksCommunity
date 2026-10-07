import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** Keep custom and restored legacy answers in the existing string data contract. */
export function TourIntakeChoice({ id, label, value = "", choices, onChange }: {
  id: string; label: string; value?: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("common");
  const [otherSelected, setOtherSelected] = useState(false);
  const known = choices.some(choice => choice.value === value);
  const custom = !known && (otherSelected || value !== "");
  return <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <select id={id} required value={known ? value : custom ? "other" : ""}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onChange={event => {
        setOtherSelected(event.target.value === "other");
        onChange(event.target.value === "other" ? "" : event.target.value);
      }}>
      <option value="" disabled>{t("tourIntakeChoose", "Select an option")}</option>
      {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      <option value="other">{t("tourIntakeUse_other", "Other")}</option>
    </select>
    {custom && <>
      <Label htmlFor={`${id}-other`} className="text-xs text-muted-foreground">{t("tourIntakeSpecify", "Please describe")}</Label>
      <Input id={`${id}-other`} required maxLength={500} value={value}
        onChange={event => onChange(event.target.value)} />
    </>}
  </div>;
}
