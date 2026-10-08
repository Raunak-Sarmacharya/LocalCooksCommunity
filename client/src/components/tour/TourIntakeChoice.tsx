import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
    <Select required value={known ? value : custom ? "other" : ""}
      onValueChange={answer => {
        setOtherSelected(answer === "other");
        onChange(answer === "other" ? "" : answer);
      }}>
      <SelectTrigger id={id} className="rounded-lg">
        <SelectValue placeholder={t("tourIntakeChoose", "Select an option")} />
      </SelectTrigger>
      <SelectContent>
        {choices.map(choice => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
        <SelectItem value="other">{t("tourIntakeUse_other", "Other")}</SelectItem>
      </SelectContent>
    </Select>
    {custom && <>
      <Label htmlFor={`${id}-other`} className="text-xs text-muted-foreground">{t("tourIntakeSpecify", "Please describe")}</Label>
      <Input id={`${id}-other`} required maxLength={500} value={value}
        onChange={event => onChange(event.target.value)} />
    </>}
  </div>;
}
