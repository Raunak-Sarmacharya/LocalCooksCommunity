import { zodResolver } from "@hookform/resolvers/zod";
import { Icon } from "@iconify/react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useTranslation } from "react-i18next";
import { ApplicationStepFooter } from "./ApplicationStepFooter";

import { Form } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// Create a schema for just the kitchen preference field
const kitchenPreferenceSchema = z.object({
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
});

type KitchenPreferenceFormData = z.infer<typeof kitchenPreferenceSchema>;

export default function KitchenPreferenceForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData, goToNextStep } = useApplicationForm();

  const form = useForm<KitchenPreferenceFormData>({
    resolver: zodResolver(kitchenPreferenceSchema),
    defaultValues: {
      kitchenPreference: formData.kitchenPreference,
    },
  });

  const onSubmit = (data: KitchenPreferenceFormData) => {
    // Update the form data with the kitchen preference
    updateFormData(data);

    // Go to the next step (certifications form)
    goToNextStep();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="seller-application-step-2">
        <RadioGroup
          value={form.watch("kitchenPreference") || ""}
          onValueChange={(value) => form.setValue("kitchenPreference", value as KitchenPreferenceFormData["kitchenPreference"], { shouldValidate: true, shouldDirty: true })}
          aria-label={t("apStatKitchenSetting")}
          className="grid gap-2.5 md:grid-cols-3"
        >
          {(
            [
              {
                value: "commercial" as const,
                title: t("sellerApp_kpCommercialTitle"),
                subtitle: t("sellerApp_kpCommercialSub"),
                icon: "mdi:office-building-outline",
                points: [t("sellerApp_kpCommercialP1"), t("sellerApp_kpCommercialP2"), t("sellerApp_kpCommercialP3")],
              },
              {
                value: "home" as const,
                title: t("sellerApp_kpHomeTitle"),
                subtitle: t("sellerApp_kpHomeSub"),
                icon: "mdi:home-outline",
                points: [t("sellerApp_kpHomeP1"), t("sellerApp_kpHomeP2"), t("sellerApp_kpHomeP3")],
              },
              {
                value: "notSure" as const,
                title: t("sellerApp_kpNotSureTitle"),
                subtitle: t("sellerApp_kpNotSureSub"),
                icon: "mdi:help-circle-outline",
                points: [],
              },
            ] as const
          ).map((option) => {
            const selected = form.watch("kitchenPreference") === option.value;
            return (
              <label
                key={option.value}
                data-testid={`seller-kitchen-preference-${option.value}`}
                className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border p-5 sm:p-6 transition-all duration-300 min-h-[240px] ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                <RadioGroupItem value={option.value} aria-label={option.title} className="sr-only" />
                  
                <span className={`mb-4 flex size-12 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  selected ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground"
                }`}>
                  <Icon icon={option.icon} className="size-6" aria-hidden />
                </span>
                
                <div className={`${option.points.length > 0 ? "mb-5" : "mb-0"} text-center`}>
                  <p className={`text-base font-semibold ${selected ? "text-primary" : "text-foreground"}`}>{option.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{option.subtitle}</p>
                </div>
                
                {option.points.length > 0 && (
                  <div className="mt-auto flex w-full justify-center">
                    <ul className="inline-flex flex-col space-y-2">
                      {option.points.map((point) => (
                        <li key={point} className="flex items-start text-xs text-muted-foreground">
                          <span className={`mr-2.5 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                            selected ? "bg-primary/60" : "bg-muted-foreground/40"
                          }`}></span>
                          <span className="leading-snug">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </label>
            );
          })}
        </RadioGroup>

        {form.formState.errors.kitchenPreference && (
          <p className="text-sm font-medium text-destructive">{t("sellerApp_kpSelectRequired")}</p>
        )}

        <ApplicationStepFooter
          showPrevious
          continueLabel={t("sellerApp_continue")}
          continueTestId="seller-application-continue"
        />
      </form>
    </Form>
  );
}
