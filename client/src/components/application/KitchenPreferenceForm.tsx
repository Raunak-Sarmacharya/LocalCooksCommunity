import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useApplicationForm } from "./ApplicationFormContext";
import { apiRequest } from "@/lib/queryClient";
import { ApplicationFormData } from "@/lib/applicationSchema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ChefHat, HomeIcon, HelpCircle, ArrowRight, Building, Info } from "lucide-react";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Create a schema for just the kitchen preference field
const kitchenPreferenceSchema = z.object({
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
});

type KitchenPreferenceFormData = z.infer<typeof kitchenPreferenceSchema>;

export default function KitchenPreferenceForm() {
  const { formData, updateFormData, goToNextStep, goToPreviousStep } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="mb-8 bg-gradient-to-r from-blue-50 to-blue-100 border-l-4 border-blue-400 rounded-lg overflow-hidden">
          <div className="p-5">
            <div className="flex items-start">
              <div className="bg-blue-200 rounded-full p-2 mr-3">
                <Info className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <h3 className="text-blue-800 font-medium text-lg mb-1">Kitchen Options</h3>
                <p className="text-blue-700 text-sm leading-relaxed">
                  Your choice helps us understand your needs. Don't worry - you can change this later if needed.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 flex items-center mb-2">
                <span className="bg-primary bg-opacity-10 p-1.5 rounded-full mr-3">
                  <ChefHat className="h-5 w-5 text-primary" />
                </span>
                Choose Your Kitchen Setting
              </h3>
              <p className="text-gray-600 leading-relaxed max-w-xl">
                This helps us understand how to best support your cooking journey. We have options for every cooking situation!
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 md:gap-6">
            <div 
              className={`bg-white rounded-xl border-2 ${form.watch("kitchenPreference") === "commercial" ? 'border-primary shadow-lg' : 'border-gray-100'} h-full shadow-sm transition-all duration-200 hover:shadow-md overflow-hidden group`}
              onClick={() => form.setValue("kitchenPreference", "commercial")}
            >
              <div className={`${form.watch("kitchenPreference") === "commercial" ? 'bg-blue-100' : 'bg-blue-50'} py-4 px-5 transition-colors duration-200`}>
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-blue-800">Commercial Kitchen</h4>
                  <div className={`p-2 rounded-full ${form.watch("kitchenPreference") === "commercial" ? 'bg-blue-200' : 'bg-blue-100 group-hover:bg-blue-200'} transition-colors duration-200`}>
                    <Building className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start cursor-pointer mb-4">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("kitchenPreference") === "commercial" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("kitchenPreference") === "commercial" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium ml-3 text-gray-800">I want to cook in a professional setting</span>
                </div>
                <div className="ml-7 p-3 bg-gray-50 rounded-lg">
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-start">
                      <span className="text-blue-500 mr-2">•</span>
                      <span>Professional-grade equipment</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-500 mr-2">•</span>
                      <span>Meets all health regulations</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-500 mr-2">•</span>
                      <span>Greater capacity for volume</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-500 mr-2">•</span>
                      <span>Networks with other chefs</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div 
              className={`bg-white rounded-xl border-2 ${form.watch("kitchenPreference") === "home" ? 'border-primary shadow-lg' : 'border-gray-100'} h-full shadow-sm transition-all duration-200 hover:shadow-md overflow-hidden group`}
              onClick={() => form.setValue("kitchenPreference", "home")}
            >
              <div className={`${form.watch("kitchenPreference") === "home" ? 'bg-green-100' : 'bg-green-50'} py-4 px-5 transition-colors duration-200`}>
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-green-800">Home Kitchen</h4>
                  <div className={`p-2 rounded-full ${form.watch("kitchenPreference") === "home" ? 'bg-green-200' : 'bg-green-100 group-hover:bg-green-200'} transition-colors duration-200`}>
                    <HomeIcon className="h-5 w-5 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start cursor-pointer mb-4">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("kitchenPreference") === "home" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("kitchenPreference") === "home" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium ml-3 text-gray-800">I want to cook from my home</span>
                </div>
                <div className="ml-7 p-3 bg-gray-50 rounded-lg">
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-start">
                      <span className="text-green-500 mr-2">•</span>
                      <span>Comfortable, familiar environment</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-green-500 mr-2">•</span>
                      <span>No commute required</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-green-500 mr-2">•</span>
                      <span>Perfect for specialty items</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-green-500 mr-2">•</span>
                      <span>We'll help with any requirements</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div 
              className={`bg-white rounded-xl border-2 ${form.watch("kitchenPreference") === "notSure" ? 'border-primary shadow-lg' : 'border-gray-100'} h-full shadow-sm transition-all duration-200 hover:shadow-md overflow-hidden group`}
              onClick={() => form.setValue("kitchenPreference", "notSure")}
            >
              <div className={`${form.watch("kitchenPreference") === "notSure" ? 'bg-purple-100' : 'bg-purple-50'} py-4 px-5 transition-colors duration-200`}>
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-purple-800">Not Sure Yet</h4>
                  <div className={`p-2 rounded-full ${form.watch("kitchenPreference") === "notSure" ? 'bg-purple-200' : 'bg-purple-100 group-hover:bg-purple-200'} transition-colors duration-200`}>
                    <HelpCircle className="h-5 w-5 text-purple-600" />
                  </div>
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start cursor-pointer mb-4">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <div className={`h-4 w-4 rounded-full border-2 ${form.watch("kitchenPreference") === "notSure" ? 'border-primary' : 'border-gray-300'}`}>
                      {form.watch("kitchenPreference") === "notSure" && (
                        <div className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-primary" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium ml-3 text-gray-800">I'd like personalized guidance</span>
                </div>
                <div className="ml-7 p-3 bg-gray-50 rounded-lg">
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-start">
                      <span className="text-purple-500 mr-2">•</span>
                      <span>Get personalized advice</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-purple-500 mr-2">•</span>
                      <span>Learn about both options</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-purple-500 mr-2">•</span>
                      <span>Weigh pros and cons</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-purple-500 mr-2">•</span>
                      <span>Make an informed choice</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {form.formState.errors.kitchenPreference && (
            <p className="text-primary text-sm mt-2">
              Please select a kitchen preference to continue
            </p>
          )}
        </div>

        <div className="flex justify-between items-center pt-8 md:pt-10 mt-6 border-t border-gray-100">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 px-5 py-2.5 rounded-lg font-medium text-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Previous Step
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-primary text-white font-medium py-2.5 px-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center relative overflow-hidden group"
          >
            <span className="relative z-10 flex items-center">
              Continue to Certifications
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform duration-200" />
            </span>
            <span className="absolute inset-0 bg-primary-dark transform scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-200"></span>
          </Button>
        </div>
      </form>
    </Form>
  );
}