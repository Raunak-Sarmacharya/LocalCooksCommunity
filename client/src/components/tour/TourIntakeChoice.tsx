import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** One tap-chip in a radio group: a native radio, so arrows, focus and screen readers work as usual. */
export function TourChip({ name, value, checked, onSelect, children }: {
  name: string; value: string; checked: boolean; onSelect: () => void; children: ReactNode;
}) {
  return <label className="cursor-pointer">
    <input type="radio" className="peer sr-only" name={name} value={value} checked={checked} onChange={onSelect} />
    <span className="inline-flex min-h-10 items-center rounded-full border border-border bg-background px-4 text-sm text-foreground transition-colors hover:border-foreground/40 peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
      {children}
    </span>
  </label>;
}

/** Keep custom and restored legacy answers in the existing string data contract. */
export function TourIntakeChoice({ id, label, value = "", choices, onChange }: {
  id: string; label: ReactNode; value?: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("common");
  const [otherSelected, setOtherSelected] = useState(false);
  const known = choices.some(choice => choice.value === value);
  const custom = !known && (otherSelected || value !== "");
  const pick = (answer: string) => {
    setOtherSelected(answer === "other");
    onChange(answer === "other" ? "" : answer);
  };
  return <fieldset className="min-w-0">
    <legend className="mb-2 text-sm font-medium text-foreground">{label}</legend>
    <div className="flex flex-wrap gap-2">
      {choices.map(choice => <TourChip key={choice.value} name={id} value={choice.value}
        checked={known && value === choice.value} onSelect={() => pick(choice.value)}>{choice.label}</TourChip>)}
      <TourChip name={id} value="other" checked={custom} onSelect={() => pick("other")}>{t("tourIntakeUse_other", "Other")}</TourChip>
    </div>
    {custom && <div className="mt-3 max-w-md space-y-1.5">
      <Label htmlFor={`${id}-other`} className="text-xs font-normal text-muted-foreground">{t("tourIntakeSpecify", "Please describe")}</Label>
      <Input id={`${id}-other`} required maxLength={500} value={value} autoFocus={otherSelected}
        onChange={event => onChange(event.target.value)} />
    </div>}
  </fieldset>;
}
