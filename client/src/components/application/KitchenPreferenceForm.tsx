import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useApplicationForm } from "./ApplicationFormContext";
import { ApplicationStepFooter } from "./ApplicationStepFooter";
import { ChoicePills } from "./ChoicePills";
import kitchenImage from "@/assets/commercial-kitchen.jpg";
import homeImage from "@/assets/home-cook.jpg";
import type { SellerCommercialKitchen, SellerFoodType } from "@shared/schema";

export type KitchenSetting = {
  kitchenPreference?: "commercial" | "home" | "notSure";
  commercialKitchen?: SellerCommercialKitchen;
  foodTypes: SellerFoodType[];
};

/** Where they cook and what they plan to sell. Used by step 2 and by "Edit" while in review. */
export function KitchenSettingFields({ value, onChange, error }: { value: KitchenSetting; onChange: (value: KitchenSetting) => void; error?: boolean }) {
  const { t } = useTranslation("chef");
  const options = [
    { value: "commercial" as const, title: t("sell_kitchenCommercial"), note: t("sell_kitchenCommercialNote"), image: kitchenImage },
    { value: "home" as const, title: t("sell_kitchenHome"), note: t("sell_kitchenHomeNote"), image: homeImage },
    { value: "notSure" as const, title: t("sell_kitchenNotSure"), note: t("sell_kitchenNotSureNote"), image: null },
  ];
  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label={t("sell_step2Title")} className="grid gap-2.5">
        {options.map((option) => {
          const on = value.kitchenPreference === option.value;
          return (
            <div key={option.value} className="space-y-2.5">
              <button type="button" role="radio" aria-checked={on}
                onClick={() => onChange({ ...value, kitchenPreference: option.value, commercialKitchen: option.value === "commercial" ? value.commercialKitchen ?? "localcooks" : undefined })}
                className={cn("grid w-full grid-cols-[52px_1fr_20px] items-center gap-3.5 rounded-xl bg-background p-3 text-left transition-shadow sm:grid-cols-[56px_1fr_20px] sm:px-4",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  on ? "shadow-[inset_0_0_0_2px_hsl(var(--primary))]" : "shadow-[inset_0_0_0_1px_hsl(var(--input))] hover:shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.4)]")}>
                {option.image
                  ? <img src={option.image} alt="" className="size-[52px] rounded-lg object-cover sm:size-14" />
                  : <span className="grid size-[52px] place-items-center rounded-lg bg-muted sm:size-14"><Icon icon="mdi:help-circle-outline" className="size-6 text-muted-foreground" aria-hidden /></span>}
                <span className="min-w-0">
                  <span className="block font-semibold">{option.title}</span>
                  <span className="block text-sm text-muted-foreground">{option.note}</span>
                </span>
                <span aria-hidden className={cn("size-5 rounded-full transition-shadow", on ? "shadow-[inset_0_0_0_6px_hsl(var(--primary))]" : "shadow-[inset_0_0_0_2px_hsl(var(--input))]")} />
              </button>
              {on && option.value === "commercial" && (
                <ChoicePills className="pl-0 sm:pl-[70px]" label={t("sell_whichKitchen")} value={value.commercialKitchen}
                  onChange={(commercialKitchen: SellerCommercialKitchen) => onChange({ ...value, commercialKitchen })}
                  options={[{ value: "localcooks", label: t("sell_kitchenLocalCooks") }, { value: "other", label: t("sell_kitchenOther") }]} />
              )}
            </div>
          );
        })}
        {error && <p className="text-sm text-destructive" role="alert">{t("sell_kitchenRequired")}</p>}
      </div>
      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium">{t("sell_foodQuestion")} <span className="font-normal text-muted-foreground">{t("sell_pickAny")}</span></legend>
        <ChoicePills label={t("sell_foodQuestion")} value={value.foodTypes} onChange={(foodTypes: SellerFoodType[]) => onChange({ ...value, foodTypes })} options={[
          { value: "meat_fish", label: t("sell_foodMeatFish") },
          { value: "vegetarian", label: t("sell_foodVegetarian") },
          { value: "baked", label: t("sell_foodBaked") },
          { value: "desserts", label: t("sell_foodDesserts") },
          { value: "preserves", label: t("sell_foodPreserves") },
          { value: "other", label: t("sell_foodOther") },
        ]} />
      </fieldset>
    </div>
  );
}

export default function KitchenPreferenceForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData, goToNextStep } = useApplicationForm();
  const [setting, setSetting] = useState<KitchenSetting>({
    kitchenPreference: formData.kitchenPreference, commercialKitchen: formData.commercialKitchen, foodTypes: formData.foodTypes ?? [],
  });
  const [error, setError] = useState(false);

  return (
    <form data-testid="seller-application-step-2" className="space-y-6" onSubmit={(event) => {
      event.preventDefault();
      if (!setting.kitchenPreference) { setError(true); return; }
      updateFormData(setting);
      goToNextStep();
    }}>
      <KitchenSettingFields value={setting} onChange={(next) => { setSetting(next); setError(false); }} error={error} />
      <ApplicationStepFooter showPrevious continueLabel={t("sellerApp_continue")} continueTestId="seller-application-continue" />
    </form>
  );
}
