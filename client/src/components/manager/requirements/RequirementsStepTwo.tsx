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
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { CustomFieldBuilder } from "./CustomFieldBuilder";
import { LocationRequirements, CustomField, STEP2_BUILT_IN_FIELDS } from "./types";

interface RequirementsStepTwoProps {
  requirements: Partial<LocationRequirements>;
  onRequirementsChange: (updates: Partial<LocationRequirements>) => void;
}

/** Groups exist for the config shape; the rows themselves read as one list. */
const FIELD_ROWS = STEP2_BUILT_IN_FIELDS.flatMap((group) => group.fields);
const SAFETY_KEY = 'requireFoodHandlerCert';
const ESTABLISHMENT_KEY = 'tier2_food_establishment_cert_required';
const isComplianceField = (key: keyof LocationRequirements) => key === SAFETY_KEY || key === ESTABLISHMENT_KEY;
const COMPLIANCE_HELP = {
  [SAFETY_KEY]: {
    text: 'Newfoundland and Labrador requires current food safety training to be present at covered licensed food premises. We ask chefs for their certificate and expiry date to help kitchens check coverage.',
    url: 'https://www.gov.nl.ca/hcs/publichealth/envhealth/foodsafetytraining/',
    link: 'NL food safety training rules',
  },
  [ESTABLISHMENT_KEY]: {
    text: 'A Food Establishment Licence applies to the licensed person and premises. Ask the chef for their licence for this kitchen when their operation requires one.',
    url: 'https://www.gov.nl.ca/gs/licences/env-health/food/premises/',
    link: 'NL Food Establishment Licence',
  },
};

export function RequirementsStepTwo({
  requirements,
  onRequirementsChange,
}: RequirementsStepTwoProps) {
  const [pendingDisable, setPendingDisable] = useState<keyof LocationRequirements | null>(null);
  
  const handleToggle = (key: keyof LocationRequirements, value: boolean) => {
    if (!value && isComplianceField(key)) {
      setPendingDisable(key);
      return;
    }
    onRequirementsChange(key === SAFETY_KEY ? { requireFoodHandlerCert: value, requireFoodHandlerExpiry: value } : { [key]: value });
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
            const complianceHelp = isComplianceField(field.key) ? COMPLIANCE_HELP[field.key as typeof SAFETY_KEY | typeof ESTABLISHMENT_KEY] : null;
            // "Recommended" is guidance, not state — it belongs on the hint line
            // rather than in a second badge competing with the toggle.
            const hint = field.recommended
              ? `${field.description ?? ""}${field.description ? " · " : ""}${mt("recommended")}`
              : field.description;

            return (
              <SettingsRow key={field.key} id={controlId} label={field.label} hint={hint}
                help={complianceHelp && <span>{complianceHelp.text} <a href={complianceHelp.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">{complianceHelp.link}</a></span>}>
                <div className="flex items-center gap-3">
                  {complianceHelp && <Badge variant="secondary" className="text-[10px] font-medium">Compliance</Badge>}
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

      <AlertDialog open={pendingDisable !== null} onOpenChange={(open) => { if (!open) setPendingDisable(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this kitchen requirement?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisable && COMPLIANCE_HELP[pendingDisable as typeof SAFETY_KEY | typeof ESTABLISHMENT_KEY]?.text}
              {' '}We strongly recommend keeping this document in the chef application.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDisable && <a href={COMPLIANCE_HELP[pendingDisable as typeof SAFETY_KEY | typeof ESTABLISHMENT_KEY].url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Read the Newfoundland and Labrador guidance</a>}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep requirement</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDisable) handleConfirmedDisable(pendingDisable); }}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

  function handleConfirmedDisable(key: keyof LocationRequirements) {
    onRequirementsChange(key === SAFETY_KEY ? { requireFoodHandlerCert: false, requireFoodHandlerExpiry: false } : { [key]: false });
    setPendingDisable(null);
  }
}

export default RequirementsStepTwo;
