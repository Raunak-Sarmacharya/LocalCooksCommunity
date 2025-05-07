import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { ApplicationFormData } from "@/lib/applicationSchema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Info, ExternalLink, Check, HelpCircle } from "lucide-react";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Create a schema for just the certifications fields
const certificationsSchema = z.object({
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
});

type CertificationsFormData = z.infer<typeof certificationsSchema>;

export default function CertificationsForm() {
  const { formData, updateFormData, goToPreviousStep } = useApplicationForm();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const form = useForm<CertificationsFormData>({
    resolver: zodResolver(certificationsSchema),
    defaultValues: {
      foodSafetyLicense: formData.foodSafetyLicense,
      foodEstablishmentCert: formData.foodEstablishmentCert,
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

  const onSubmit = (data: CertificationsFormData) => {
    // Update the form data with the certification information
    updateFormData(data);
    
    // Combine all data and submit the complete form with user ID if logged in
    const completeFormData = {
      ...formData,
      ...data,
      userId: user?.id // Add the user ID if the user is logged in
    } as ApplicationFormData;
    
    mutate(completeFormData);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Alert className="mb-6 bg-blue-50 border-blue-200">
          <Info className="h-5 w-5 text-blue-500" />
          <AlertTitle className="text-blue-700">We're here to help!</AlertTitle>
          <AlertDescription className="text-blue-600">
            Don't worry if you don't have certifications yet. We can guide you through the process once you're approved.
          </AlertDescription>
        </Alert>
      
        <div className="space-y-8">
          <div className="p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Check className="h-5 w-5 mr-2 text-primary" />
                  Food Safety License
                </h3>
                <p className="text-sm text-gray-500 mt-1">Required for professional food preparation</p>
              </div>
              <a
                href="https://skillpassnl.ca/en/home/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm font-medium hover:underline inline-flex items-center"
              >
                Learn more <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </div>
            
            <p className="mb-4 text-gray-600">Do you have a Food Safety License?*</p>
            
            <RadioGroup
              onValueChange={(value) => form.setValue("foodSafetyLicense", value as "yes" | "no" | "notSure")}
              defaultValue={formData.foodSafetyLicense}
              className="flex flex-col space-y-3"
            >
              <div className="flex items-start space-x-3 bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-primary transition-colors">
                <RadioGroupItem value="yes" id="fsl-yes" className="mt-1" />
                <div>
                  <Label htmlFor="fsl-yes" className="font-medium cursor-pointer">Yes, I have a license</Label>
                  <p className="text-sm text-gray-500 mt-1">I've completed the food safety training course</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-primary transition-colors">
                <RadioGroupItem value="no" id="fsl-no" className="mt-1" />
                <div>
                  <Label htmlFor="fsl-no" className="font-medium cursor-pointer">Not yet, but I'd like to learn</Label>
                  <p className="text-sm text-gray-500 mt-1">We'll guide you through the simple process</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-primary transition-colors">
                <RadioGroupItem value="notSure" id="fsl-not-sure" className="mt-1" />
                <div>
                  <Label htmlFor="fsl-not-sure" className="font-medium cursor-pointer">I'd like to learn more</Label>
                  <p className="text-sm text-gray-500 mt-1">I'm exploring my options and need more information</p>
                </div>
              </div>
            </RadioGroup>
            {form.formState.errors.foodSafetyLicense && (
              <p className="text-primary text-sm mt-2">
                {form.formState.errors.foodSafetyLicense.message}
              </p>
            )}
            
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 flex items-start">
                <HelpCircle className="h-4 w-4 mr-2 text-primary mt-0.5 flex-shrink-0" />
                The Food Safety License is typically obtained through a 1-day course offered by SkillsPassNL. It teaches proper food handling, storage, and preparation methods to prevent foodborne illness.
              </p>
            </div>
          </div>
          
          <div className="p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Check className="h-5 w-5 mr-2 text-primary" />
                  Food Establishment Certificate
                </h3>
                <p className="text-sm text-gray-500 mt-1">Required for operating a food business</p>
              </div>
              <a
                href="https://www.gov.nl.ca/dgsnl/licensing/environmental-health/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm font-medium hover:underline inline-flex items-center"
              >
                Provincial Guidelines <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </div>
            
            <p className="mb-4 text-gray-600">Do you have a Food Establishment Certificate?*</p>
            
            <RadioGroup
              onValueChange={(value) => form.setValue("foodEstablishmentCert", value as "yes" | "no" | "notSure")}
              defaultValue={formData.foodEstablishmentCert}
              className="flex flex-col space-y-3"
            >
              <div className="flex items-start space-x-3 bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-primary transition-colors">
                <RadioGroupItem value="yes" id="fec-yes" className="mt-1" />
                <div>
                  <Label htmlFor="fec-yes" className="font-medium cursor-pointer">Yes, I have a certificate</Label>
                  <p className="text-sm text-gray-500 mt-1">My kitchen has been inspected and approved</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-primary transition-colors">
                <RadioGroupItem value="no" id="fec-no" className="mt-1" />
                <div>
                  <Label htmlFor="fec-no" className="font-medium cursor-pointer">Not yet, I'm interested</Label>
                  <p className="text-sm text-gray-500 mt-1">We'll connect you with resources to get started</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-primary transition-colors">
                <RadioGroupItem value="notSure" id="fec-not-sure" className="mt-1" />
                <div>
                  <Label htmlFor="fec-not-sure" className="font-medium cursor-pointer">Tell me more</Label>
                  <p className="text-sm text-gray-500 mt-1">I'd like to discuss my specific situation</p>
                </div>
              </div>
            </RadioGroup>
            {form.formState.errors.foodEstablishmentCert && (
              <p className="text-primary text-sm mt-2">
                {form.formState.errors.foodEstablishmentCert.message}
              </p>
            )}
            
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 flex items-start">
                <HelpCircle className="h-4 w-4 mr-2 text-primary mt-0.5 flex-shrink-0" />
                This certificate is issued by Environmental Health Services after inspecting your food preparation area. It ensures your kitchen meets health and safety standards. We have relationships with commercial kitchens if you need a certified space.
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center">
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
            {isPending ? 
              <>
                <span className="mr-2">Submitting</span>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </> 
              : 'Submit Application'
            }
          </Button>
        </div>
      </form>
    </Form>
  );
}