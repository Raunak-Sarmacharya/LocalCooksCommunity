/**
 * Kitchen Documents — the manager-owned half of the chef application.
 *
 * Deliberately header-free past the card titles: the page hosting this already
 * names the surface, so a step heading, a compliance callout, a heading per
 * field group and a heading above the custom-field list were four levels of
 * copy all saying the same thing. One card, one row per requirement.
 */

import { Switch } from "@/components/ui/switch";
import { mt } from "@/i18n/manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { CustomFieldBuilder } from "./CustomFieldBuilder";
import { LocationRequirements, CustomField, STEP2_BUILT_IN_FIELDS } from "./types";

interface RequirementsStepTwoProps {
  requirements: Partial<LocationRequirements>;
  onRequirementsChange: (updates: Partial<LocationRequirements>) => void;
}

/** Groups exist for the config shape; the rows themselves read as one list. */
const FIELD_ROWS = STEP2_BUILT_IN_FIELDS.flatMap((group) => group.fields);

export function RequirementsStepTwo({
  requirements,
  onRequirementsChange,
}: RequirementsStepTwoProps) {
  
  const handleToggle = (key: keyof LocationRequirements, value: boolean) => {
    onRequirementsChange({ [key]: value });
  };

  const handleCustomFieldsChange = (fields: CustomField[]) => {
    onRequirementsChange({ tier2_custom_fields: fields });
  };

  const tier2CustomFields = (requirements.tier2_custom_fields as CustomField[]) || [];

  return (
    <div className="space-y-6">
      {/* Built-in requirements */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-lg">{mt("step2Documents")}</CardTitle>
          <CardDescription>{mt("theseAreCollectedAfterInitialApproval")}</CardDescription>
        </CardHeader>

        <CardContent className="divide-y divide-border p-0">
          {FIELD_ROWS.map((field) => {
            const controlId = `requirement-${String(field.key)}`;
            const isRequired = requirements[field.key] === true;
            // "Recommended" is guidance, not state — it belongs on the hint line
            // rather than in a second badge competing with the toggle.
            const hint = field.recommended
              ? `${field.description ?? ""}${field.description ? " · " : ""}${mt("recommended")}`
              : field.description;

            return (
              <SettingsRow key={field.key} id={controlId} label={field.label} hint={hint}>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isRequired ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {isRequired ? mt("required") : mt("notRequired")}
                  </span>
                  <Switch
                    id={controlId}
                    checked={isRequired}
                    onCheckedChange={(checked) => handleToggle(field.key, checked)}
                  />
                </div>
              </SettingsRow>
            );
          })}
        </CardContent>
      </Card>

      {/* Custom questions */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-lg">{mt("customQuestionsForKitchenApplications")}</CardTitle>
          <CardDescription>{mt("addAdditionalDocumentationOrInformationRequirements")}</CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <CustomFieldBuilder
            fields={tier2CustomFields}
            tier={2}
            onFieldsChange={handleCustomFieldsChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default RequirementsStepTwo;
