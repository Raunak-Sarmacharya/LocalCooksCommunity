import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { ApplicationFormData } from "@/lib/applicationSchema";
import { apiRequest } from "@/lib/queryClient";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Building, ChefHat, HelpCircle, HomeIcon, Info, ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

// Create a schema for just the kitchen preference field
const kitchenPreferenceSchema = z.object({
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
});

type KitchenPreferenceFormData = z.infer<typeof kitchenPreferenceSchema>;

export default function KitchenPreferenceForm() {
  const { formData, updateFormData, goToNextStep, goToPreviousStep } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useFirebaseAuth();

  const form = useForm<KitchenPreferenceFormData>({
    resolver: zodResolver(kitchenPreferenceSchema),
    defaultValues: {
      kitchenPreference: formData.kitchenPreference,
    },
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ApplicationFormData) => {
      const response = await apiRequest("POST", "/api/applications", data);
      return response.json();
    },
    onSuccess: () => {
      navigate("/success");
    },
    onError: (error) => {
      toast({
        title: "Error submitting application",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Header Section */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center mx-auto mb-4">
            <ChefHat className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Choose Your Kitchen Setting</h2>
          <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
            This helps us understand how to best support your cooking journey. We have options for every cooking situation!
          </p>
        </div>

        {/* Kitchen Preference Options - Horizontal Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Commercial Kitchen Option */}
          <div 
            className={`relative cursor-pointer transition-all duration-300 transform hover:scale-[1.02] ${
              form.watch("kitchenPreference") === "commercial" 
                ? 'ring-2 ring-primary shadow-lg shadow-primary/20' 
                : 'ring-1 ring-gray-200 hover:ring-gray-300 hover:shadow-md'
            }`}
            onClick={() => form.setValue("kitchenPreference", "commercial")}
          >
            <div className="bg-white rounded-xl p-6 h-full">
              {/* Selection Indicator */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    form.watch("kitchenPreference") === "commercial" 
                      ? 'bg-primary text-white' 
                      : 'bg-blue-50 text-blue-600'
                  }`}>
                    <Building className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">Professional Kitchen</h3>
                    <p className="text-sm text-gray-600">Commercial-grade facilities</p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  form.watch("kitchenPreference") === "commercial" 
                    ? 'border-primary bg-primary' 
                    : 'border-gray-300'
                }`}>
                  {form.watch("kitchenPreference") === "commercial" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </div>
              
              {/* Benefits List */}
              <div className="space-y-3 mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-primary/70"></div>
                  <span className="text-sm text-gray-700">Professional-grade equipment</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-primary/70"></div>
                  <span className="text-sm text-gray-700">Meets all health regulations</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-primary/70"></div>
                  <span className="text-sm text-gray-700">Greater capacity for volume</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-primary/70"></div>
                  <span className="text-sm text-gray-700">Network with other chefs</span>
                </div>
              </div>

              {/* Perfect For Tag */}
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                Perfect for scaling up
              </div>
            </div>
          </div>

          {/* Home Kitchen Option */}
          <div 
            className={`relative cursor-pointer transition-all duration-300 transform hover:scale-[1.02] ${
              form.watch("kitchenPreference") === "home" 
                ? 'ring-2 ring-primary shadow-lg shadow-primary/20' 
                : 'ring-1 ring-gray-200 hover:ring-gray-300 hover:shadow-md'
            }`}
            onClick={() => form.setValue("kitchenPreference", "home")}
          >
            <div className="bg-white rounded-xl p-6 h-full">
              {/* Selection Indicator */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    form.watch("kitchenPreference") === "home" 
                      ? 'bg-primary text-white' 
                      : 'bg-green-50 text-green-600'
                  }`}>
                    <HomeIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">Home Kitchen</h3>
                    <p className="text-sm text-gray-600">Cook from your own space</p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  form.watch("kitchenPreference") === "home" 
                    ? 'border-primary bg-primary' 
                    : 'border-gray-300'
                }`}>
                  {form.watch("kitchenPreference") === "home" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </div>
              
              {/* Benefits List */}
              <div className="space-y-3 mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-700">Comfortable, familiar environment</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-700">No commute required</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-700">Perfect for specialty items</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-700">We'll help with requirements</span>
                </div>
              </div>

              {/* Perfect For Tag */}
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                Perfect for getting started
              </div>
            </div>
          </div>
        </div>

        {/* Not Sure Option - Full Width */}
        <div 
          className={`cursor-pointer transition-all duration-300 transform hover:scale-[1.01] ${
            form.watch("kitchenPreference") === "notSure" 
              ? 'ring-2 ring-primary shadow-lg shadow-primary/20' 
              : 'ring-1 ring-gray-200 hover:ring-gray-300 hover:shadow-md'
          }`}
          onClick={() => form.setValue("kitchenPreference", "notSure")}
        >
          <div className="bg-white rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  form.watch("kitchenPreference") === "notSure" 
                    ? 'bg-primary text-white' 
                    : 'bg-orange-50 text-orange-600'
                }`}>
                  <HelpCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900">I'm not sure yet</h3>
                  <p className="text-sm text-gray-600">Let's discuss what works best for your situation</p>
                </div>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                form.watch("kitchenPreference") === "notSure" 
                  ? 'border-primary bg-primary' 
                  : 'border-gray-300'
              }`}>
                {form.watch("kitchenPreference") === "notSure" && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {form.formState.errors.kitchenPreference && (
          <div className="text-center">
            <p className="text-primary text-sm bg-red-50 border border-red-200 rounded-lg p-3 inline-flex items-center gap-2">
              <span className="w-2 h-2 bg-primary rounded-full"></span>
              Please select a kitchen preference to continue
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-8 mt-6 border-t border-gray-100">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 px-6 py-3 rounded-xl font-medium flex items-center gap-2 w-full sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous Step
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 text-white font-semibold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-3 relative overflow-hidden group w-full sm:w-auto min-w-64"
          >
            <span className="relative z-10 flex items-center gap-3">
              Continue to Certifications
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform duration-200" />
            </span>
            <span className="absolute inset-0 bg-gradient-to-r from-primary/90 to-primary/70 transform scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-200"></span>
          </Button>
        </div>
      </form>
    </Form>
  );
}