import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { AlertCircle, User, Building2, ShieldCheck, Clock, FileCheck, BadgeCheck, Info, Save, RefreshCw } from "lucide-react";
import { CustomFieldBuilder } from "@/components/manager/requirements/CustomFieldBuilder";
import { LocationRequirements, CustomField, STEP1_FIELD_GROUPS } from "@/components/manager/requirements/types";

const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Personal Information': <User className="h-4 w-4" />,
  'Business Information': <Building2 className="h-4 w-4" />,
  'Food Safety Certification': <ShieldCheck className="h-4 w-4" />,
  'Kitchen Usage Plans': <Clock className="h-4 w-4" />,
  'Legal Agreements': <FileCheck className="h-4 w-4" />,
};

export function PlatformRequirementsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [requirements, setRequirements] = useState<Partial<LocationRequirements>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { data: currentSettings, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/admin/settings/step1_requirements'],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error("Firebase user not available");
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch('/api/admin/settings/step1_requirements', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch requirements');
      return response.json();
    }
  });

  useEffect(() => {
    if (currentSettings && Object.keys(currentSettings).length > 0) {
      setRequirements(currentSettings);
      setHasUnsavedChanges(false);
    } else {
      // Set defaults if no settings found
      setRequirements({
        requireFirstName: true,
        requireLastName: true,
        requireEmail: true,
        requireTermsAgree: true,
        requireAccuracyAgree: true,
      });
    }
  }, [currentSettings]);

  const updateMutation = useMutation({
    mutationFn: async (reqs: Partial<LocationRequirements>) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error("Firebase user not available");
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch('/api/admin/settings/step1_requirements', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reqs)
      });
      if (!response.ok) throw new Error('Failed to save requirements');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settings/step1_requirements'] });
      toast({ title: "Success", description: "Global requirements updated successfully" });
      setHasUnsavedChanges(false);
      setIsSaving(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setIsSaving(false);
    }
  });

  const handleToggle = (key: keyof LocationRequirements, value: boolean) => {
    setRequirements(prev => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
  };

  const handleExperienceMinimumChange = (value: number) => {
    setRequirements(prev => ({ ...prev, tier1_years_experience_minimum: value }));
    setHasUnsavedChanges(true);
  };

  const handleCustomFieldsChange = (fields: CustomField[]) => {
    setRequirements(prev => ({ ...prev, tier1_custom_fields: fields }));
    setHasUnsavedChanges(true);
  };

  const handleSave = () => {
    setIsSaving(true);
    updateMutation.mutate(requirements);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load requirements. Please refresh the page.</AlertDescription>
      </Alert>
    );
  }

  const tier1CustomFields = (requirements.tier1_custom_fields as CustomField[]) || [];

  return (
    <div className="max-w-4xl space-y-6 pb-20">
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
                Global Platform Application Requirements
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Configure what information chefs must provide when they first apply to the platform. 
                These fields apply to all new applicants globally.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Standard Application Fields
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Toggle fields on/off to customize what's required for the global application
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
                              className="text-[10px] px-1.5 py-0 h-4 border-warning/30 text-warning bg-warning/10"
                            >
                              <BadgeCheck className="h-2.5 w-2.5 mr-0.5" />
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

      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/50">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Experience Requirements
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Set minimum experience thresholds for all platform applicants
          </p>
        </div>
        
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between py-3 px-3 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
            <div>
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Require Minimum Years of Experience
              </Label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Filter applicants by their professional experience globally
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

      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Questions for Step 1
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add global custom questions that all applicants must answer
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

      {hasUnsavedChanges && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 z-50 flex justify-end gap-3 shadow-lg transform transition-all duration-300 animate-in slide-in-from-bottom-full">
          <div className="container max-w-7xl mx-auto flex items-center justify-end gap-3">
            <span className="text-sm text-slate-500 dark:text-slate-400 mr-2">You have unsaved changes</span>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Saving...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" />Save Settings</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

