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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
        <Alert className="mb-6 bg-blue-50 border-blue-200">
          <Info className="h-5 w-5 text-blue-500" />
          <AlertTitle className="text-blue-700">Kitchen Options</AlertTitle>
          <AlertDescription className="text-blue-600">
            Your choice helps us understand your needs. Don't worry - you can change this later if needed.
          </AlertDescription>
        </Alert>
      
        <div className="space-y-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center">
              <ChefHat className="h-5 w-5 mr-2 text-primary" />
              Choose Your Kitchen Setting
            </h3>
          </div>
          
          <p className="text-gray-600 mb-4">
            This helps us understand how to best support your cooking journey. We have options for every cooking situation!
          </p>
          
          <RadioGroup
            onValueChange={(value) => form.setValue("kitchenPreference", value as "commercial" | "home" | "notSure")}
            defaultValue={formData.kitchenPreference}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            <div className="bg-white rounded-lg border-2 border-gray-200 hover:border-primary overflow-hidden transition-colors h-full">
              <div className="bg-blue-50 py-3 px-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-blue-700">Commercial Kitchen</h4>
                  <Building className="h-5 w-5 text-blue-500" />
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start space-x-3 mb-4">
                  <RadioGroupItem value="commercial" id="kp-commercial" className="mt-1" />
                  <Label htmlFor="kp-commercial" className="text-sm cursor-pointer">I want to cook in a professional setting</Label>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 pl-8 list-disc">
                  <li>Professional-grade equipment</li>
                  <li>Meets all health regulations</li>
                  <li>Greater capacity for volume</li>
                  <li>Networks with other chefs</li>
                </ul>
              </div>
            </div>
            
            <div className="bg-white rounded-lg border-2 border-gray-200 hover:border-primary overflow-hidden transition-colors h-full">
              <div className="bg-green-50 py-3 px-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-green-700">Home Kitchen</h4>
                  <HomeIcon className="h-5 w-5 text-green-500" />
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start space-x-3 mb-4">
                  <RadioGroupItem value="home" id="kp-home" className="mt-1" />
                  <Label htmlFor="kp-home" className="text-sm cursor-pointer">I want to cook from my home</Label>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 pl-8 list-disc">
                  <li>Comfortable, familiar environment</li>
                  <li>No commute required</li>
                  <li>Perfect for specialty items</li>
                  <li>We'll help with any requirements</li>
                </ul>
              </div>
            </div>
            
            <div className="bg-white rounded-lg border-2 border-gray-200 hover:border-primary overflow-hidden transition-colors h-full">
              <div className="bg-purple-50 py-3 px-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-purple-700">Not Sure Yet</h4>
                  <HelpCircle className="h-5 w-5 text-purple-500" />
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start space-x-3 mb-4">
                  <RadioGroupItem value="notSure" id="kp-not-sure" className="mt-1" />
                  <Label htmlFor="kp-not-sure" className="text-sm cursor-pointer">I'd like personalized guidance</Label>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 pl-8 list-disc">
                  <li>Get personalized advice</li>
                  <li>Learn about both options</li>
                  <li>Weigh pros and cons</li>
                  <li>Make an informed choice</li>
                </ul>
              </div>
            </div>
          </RadioGroup>
          
          {form.formState.errors.kitchenPreference && (
            <p className="text-primary text-sm mt-2">
              Please select a kitchen preference to continue
            </p>
          )}
        </div>
        
        <div className="flex justify-between items-center pt-4">
          <Button 
            type="button" 
            variant="outline"
            onClick={goToPreviousStep}
            className="border-primary text-primary hover:bg-primary hover:text-white"
          >
            Back
          </Button>
          <Button 
            type="submit" 
            disabled={isPending}
            className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:-translate-y-1 flex items-center"
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}