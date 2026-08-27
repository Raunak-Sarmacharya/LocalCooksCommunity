import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, ArrowLeft, Building, HelpCircle, HomeIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

// Create a schema for just the kitchen preference field
const kitchenPreferenceSchema = z.object({
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
});

type KitchenPreferenceFormData = z.infer<typeof kitchenPreferenceSchema>;

export default function KitchenPreferenceForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData, goToNextStep, goToPreviousStep } = useApplicationForm();

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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex flex-col space-y-4">
          {(
            [
              {
                value: "commercial" as const,
                title: t("sellerApp_kpCommercialTitle"),
                subtitle: t("sellerApp_kpCommercialSub"),
                icon: Building,
                points: [t("sellerApp_kpCommercialP1"), t("sellerApp_kpCommercialP2"), t("sellerApp_kpCommercialP3")],
              },
              {
                value: "home" as const,
                title: t("sellerApp_kpHomeTitle"),
                subtitle: t("sellerApp_kpHomeSub"),
                icon: HomeIcon,
                points: [t("sellerApp_kpHomeP1"), t("sellerApp_kpHomeP2"), t("sellerApp_kpHomeP3")],
              },
              {
                value: "notSure" as const,
                title: t("sellerApp_kpNotSureTitle"),
                subtitle: t("sellerApp_kpNotSureSub"),
                icon: HelpCircle,
                points: [t("sellerApp_kpNotSureP1")],
              },
            ] as const
          ).map((option) => {
            const selected = form.watch("kitchenPreference") === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => form.setValue("kitchenPreference", option.value)}
                className={`w-full rounded-xl border p-4 sm:p-5 text-left transition-all duration-200 ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected ? "border-primary bg-primary" : "border-muted-foreground/30"
                  }`}>
                    {selected ? <span className="h-2 w-2 rounded-full bg-background" /> : null}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-lg border ${selected ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground"}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className={`text-base font-semibold ${selected ? "text-primary" : "text-foreground"}`}>{option.title}</p>
                        <p className="text-sm text-muted-foreground">{option.subtitle}</p>
                      </div>
                    </div>
                    
                    <ul className="mt-3 ml-[3.25rem] space-y-1.5">
                      {option.points.map((point) => (
                        <li key={point} className="text-sm text-muted-foreground flex items-start">
                          <span className="mr-2 mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0"></span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {form.formState.errors.kitchenPreference && (
          <p className="text-sm font-medium text-destructive">{t("sellerApp_kpSelectRequired")}</p>
        )}

        <div className="flex justify-between items-center pt-4 border-t border-border/50">
          <Button
            type="button"
            variant="ghost"
            onClick={goToPreviousStep}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("sellerApp_back")}
          </Button>
          <Button type="submit" size="lg" className="px-8">
            {t("sellerApp_continue")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}