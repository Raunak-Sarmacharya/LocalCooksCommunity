/**
 * Requirements Step Two Configuration
 * Kitchen Coordination requirements after initial application approval
 */

import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  FileCheck,
  ShieldAlert,
  ClipboardList,
  Sparkles,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { CustomFieldBuilder } from './CustomFieldBuilder';
import { LocationRequirements, CustomField, STEP2_BUILT_IN_FIELDS } from './types';

interface RequirementsStepTwoProps {
  requirements: Partial<LocationRequirements>;
  onRequirementsChange: (updates: Partial<LocationRequirements>) => void;
  onUnsavedChange: () => void;
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Licensing & Compliance': <FileCheck className="h-4 w-4" />,
  'Insurance & Liability': <ShieldAlert className="h-4 w-4" />,
  'Operational Documentation': <ClipboardList className="h-4 w-4" />,
};

export function RequirementsStepTwo({
  requirements,
  onRequirementsChange,
  onUnsavedChange,
}: RequirementsStepTwoProps) {
  const handleToggle = (key: keyof LocationRequirements, value: boolean) => {
    onRequirementsChange({ [key]: value });
    onUnsavedChange();
  };

  const handleCustomFieldsChange = (fields: CustomField[]) => {
    onRequirementsChange({ tier2_custom_fields: fields });
    onUnsavedChange();
  };

  const tier2CustomFields = (requirements.tier2_custom_fields as CustomField[]) || [];

  // Count enabled requirements for summary
  const enabledCount = STEP2_BUILT_IN_FIELDS.reduce((count, group) => {
    return count + group.fields.filter(field => requirements[field.key] === true).length;
  }, 0);

  return (
    <div className="space-y-6">
      {/* Step Explanation Card */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-50 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 p-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-200/30 dark:bg-emerald-700/20 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-teal-200/30 dark:bg-teal-700/20 rounded-full translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-emerald-600 dark:bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
              <span className="font-bold text-lg">2</span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Kitchen Coordination Phase
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                After you approve a chef's initial application, they'll need to provide these additional 
                documents and information before they can start using your kitchen.
              </p>
            </div>
          </div>
          
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary" className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-0">
              <Info className="h-3 w-3 mr-1" />
              These are collected after initial approval
            </Badge>
            {enabledCount > 0 && (
              <Badge variant="secondary" className="bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {enabledCount} requirement{enabledCount !== 1 ? 's' : ''} enabled
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Important Notice */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Compliance Requirements
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            Check your local regulations to determine which documents are legally required. 
            Food establishment licenses and liability insurance are commonly required.
          </p>
        </div>
      </div>

      {/* Built-in Fields Configuration */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Standard Coordination Requirements
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Enable the documentation requirements for your kitchen
          </p>
        </div>

        <Accordion type="multiple" defaultValue={['Licensing & Compliance', 'Insurance & Liability']} className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
          {STEP2_BUILT_IN_FIELDS.map((group) => (
            <AccordionItem key={group.title} value={group.title} className="border-0">
              <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
                    {SECTION_ICONS[group.title]}
                  </div>
                  <div className="text-left">
                    <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                      {group.title}
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                      {group.description}
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-4">
                <div className="space-y-1 pl-11">
                  {group.fields.map((field) => (
                    <div key={field.key}>
                      <div
                        className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                              {field.label}
                            </Label>
                            {field.recommended && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:bg-amber-950/30"
                              >
                                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                                Recommended
                              </Badge>
                            )}
                          </div>
                          {field.description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {field.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium transition-colors ${
                            requirements[field.key] === true
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}>
                            {requirements[field.key] === true ? 'Required' : 'Not Required'}
                          </span>
                          <Switch
                            checked={requirements[field.key] === true}
                            onCheckedChange={(checked) => handleToggle(field.key, checked)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* Custom Fields Section */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Questions for Step 2
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add additional documentation or information requirements
          </p>
        </div>
        
        <div className="p-5">
          <CustomFieldBuilder
            fields={tier2CustomFields}
            tier={2}
            onFieldsChange={handleCustomFieldsChange}
          />
        </div>
      </div>
    </div>
  );
}

export default RequirementsStepTwo;
