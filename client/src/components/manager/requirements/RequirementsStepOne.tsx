/**
 * Requirements Step One Configuration
 * Initial application requirements that chefs submit when first applying
 */

import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  User,
  Building2,
  ShieldCheck,
  Clock,
  FileCheck,
  Sparkles,
  Info,
} from 'lucide-react';
import { CustomFieldBuilder } from './CustomFieldBuilder';
import { LocationRequirements, CustomField, STEP1_FIELD_GROUPS } from './types';

interface RequirementsStepOneProps {
  requirements: Partial<LocationRequirements>;
  onRequirementsChange: (updates: Partial<LocationRequirements>) => void;
  onUnsavedChange: () => void;
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Personal Information': <User className="h-4 w-4" />,
  'Business Information': <Building2 className="h-4 w-4" />,
  'Food Safety Certification': <ShieldCheck className="h-4 w-4" />,
  'Kitchen Usage Plans': <Clock className="h-4 w-4" />,
  'Legal Agreements': <FileCheck className="h-4 w-4" />,
};

export function RequirementsStepOne({
  requirements,
  onRequirementsChange,
  onUnsavedChange,
}: RequirementsStepOneProps) {
  const handleToggle = (key: keyof LocationRequirements, value: boolean) => {
    onRequirementsChange({ [key]: value });
    onUnsavedChange();
  };

  const handleExperienceMinimumChange = (value: number) => {
    onRequirementsChange({ tier1_years_experience_minimum: value });
    onUnsavedChange();
  };

  const handleCustomFieldsChange = (fields: CustomField[]) => {
    onRequirementsChange({ tier1_custom_fields: fields });
    onUnsavedChange();
  };

  const tier1CustomFields = (requirements.tier1_custom_fields as CustomField[]) || [];

  return (
    <div className="space-y-6">
      {/* Step Explanation Card */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-50 dark:from-blue-950/40 dark:via-indigo-950/30 dark:to-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 p-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-200/30 dark:bg-blue-700/20 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-200/30 dark:bg-indigo-700/20 rounded-full translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <span className="font-bold text-lg">1</span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Initial Application Form
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Configure what information chefs must provide when they first apply to your kitchen. 
                These fields appear on the public application form.
              </p>
            </div>
          </div>
          
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-0">
              <Info className="h-3 w-3 mr-1" />
              Tip: Keep required fields minimal to encourage applications
            </Badge>
          </div>
        </div>
      </div>

      {/* Built-in Fields Configuration */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Standard Application Fields
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Toggle fields on/off to customize what's required
          </p>
        </div>

        <Accordion type="multiple" defaultValue={['Personal Information', 'Food Safety Certification', 'Legal Agreements']} className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
          {STEP1_FIELD_GROUPS.map((group) => (
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
                    <div
                      key={field.key}
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
                          requirements[field.key] !== false
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}>
                          {requirements[field.key] !== false ? 'Required' : 'Optional'}
                        </span>
                        <Switch
                          checked={requirements[field.key] !== false}
                          onCheckedChange={(checked) => handleToggle(field.key, checked)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* Experience Requirements */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Experience Requirements
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Set minimum experience thresholds for applicants
          </p>
        </div>
        
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between py-3 px-3 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
            <div>
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Require Minimum Years of Experience
              </Label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Filter applicants by their professional experience
              </p>
            </div>
            <Switch
              checked={Boolean(requirements.tier1_years_experience_required)}
              onCheckedChange={(checked) => handleToggle('tier1_years_experience_required', checked)}
            />
          </div>

          {requirements.tier1_years_experience_required && (
            <div className="pl-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <Label htmlFor="experience-minimum" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Minimum Years Required
              </Label>
              <div className="flex items-center gap-3 mt-2">
                <Input
                  id="experience-minimum"
                  type="number"
                  min="0"
                  max="50"
                  value={requirements.tier1_years_experience_minimum || 0}
                  onChange={(e) => handleExperienceMinimumChange(parseInt(e.target.value) || 0)}
                  className="w-24"
                />
                <span className="text-sm text-slate-500 dark:text-slate-400">years</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Custom Fields Section */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Questions for Step 1
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add your own questions specific to your kitchen's needs
          </p>
        </div>
        
        <div className="p-5">
          <CustomFieldBuilder
            fields={tier1CustomFields}
            tier={1}
            onFieldsChange={handleCustomFieldsChange}
          />
        </div>
      </div>
    </div>
  );
}

export default RequirementsStepOne;
