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
import { Info, ExternalLink, Check, HelpCircle, Loader2 } from "lucide-react";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "../ui/textarea";

// Create a schema for just the certifications fields
const certificationsSchema = z.object({
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
  orderFulfillmentMethod: z.enum(["preOrder", "onDemand", "both"]),
  questions: z.string().optional(),
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
      orderFulfillmentMethod: formData.orderFulfillmentMethod || "preOrder",
      questions: formData.questions || "",
    },
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ApplicationFormData) => {
      console.log("Submitting application with data:", data);

      // Include auth header with user ID if available
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user?.id) {
        headers["X-User-ID"] = user.id.toString();
      }

      // Direct fetch to bypass apiRequest abstraction for debugging
      const response = await fetch("/api/applications", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }

      return response.json();
    },
    onSuccess: () => {
      navigate("/success");
    },
    onError: (error: any) => {
      console.error("Application submission error:", error);
      let errorMessage = "Please try again later.";
      let title = "Error submitting application";
      let isAuthError = false;

      // Try to extract detailed error message from response
      if (error.message === "Authentication required" ||
        (error.response && error.response.status === 401)) {
        errorMessage = "You must be logged in to submit an application. Please log in and try again.";
        title = "Authentication Required";
        isAuthError = true;
      } else if (error.response) {
        try {
          errorMessage = error.response.error || error.message || errorMessage;
        } catch (e) {
          console.error("Error parsing error response:", e);
        }
      }

      toast({
        title: title,
        description: errorMessage,
        variant: "destructive",
      });

      // If it's an auth error, redirect to login
      if (isAuthError) {
        setTimeout(() => {
          navigate("/auth?redirect=/apply");
        }, 1500);
      }
    },
  });

  const onSubmit = (data: CertificationsFormData) => {
    // Update the form data with the certification information
    updateFormData(data);

    // Check if user is authenticated
    if (!user) {
      toast({
        title: "Authentication required",
        description: "Please log in to submit your application.",
        variant: "destructive",
      });
      // Redirect to auth page
      navigate("/auth");
      return;
    }

    // Combine all data and submit the complete form with user ID
    const completeFormData = {
      ...formData,
      ...data,
      userId: user.id
    } as ApplicationFormData;

    // Log for debugging
    console.log("Submitting application:", completeFormData);

    mutate(completeFormData);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Alert className="mb-4 md:mb-6 bg-blue-50 border-blue-200">
          <Info className="h-5 w-5 text-blue-500" />
          <AlertTitle className="text-blue-700">We're here to help!</AlertTitle>
          <AlertDescription className="text-blue-600">
            Don't worry if you don't have certifications yet. We can guide you through the process once you're approved.
          </AlertDescription>
        </Alert>

        <div className="space-y-6 md:space-y-8">
          <div className="p-4 md:p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Check className="h-5 w-5 mr-2 text-primary" />
                  Food Safety License
                </h3>
                <p className="text-sm text-gray-500 mt-1">Required for professional food preparation</p>
              </div>
              <a
                href="https://skillspassnl.com/#howtogetstarted"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm font-medium hover:underline hover-text inline-flex items-center whitespace-nowrap"
              >
                Learn more <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </div>

            <p className="mb-3 md:mb-4 text-gray-600">Do you have a Food Safety License?*</p>

            <RadioGroup
              onValueChange={(value) => form.setValue("foodSafetyLicense", value as "yes" | "no" | "notSure")}
              defaultValue={formData.foodSafetyLicense}
              className="flex flex-col space-y-3 md:space-y-4"
            >
              <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
                <RadioGroupItem value="yes" id="fsl-yes" className="mt-1" />
                <div>
                  <Label htmlFor="fsl-yes" className="font-medium cursor-pointer">Yes, I have a license</Label>
                  <p className="text-sm text-gray-500 mt-1">I've completed the food safety training course</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
                <RadioGroupItem value="no" id="fsl-no" className="mt-1" />
                <div>
                  <Label htmlFor="fsl-no" className="font-medium cursor-pointer">Not yet, but I'd like to learn</Label>
                  <p className="text-sm text-gray-500 mt-1">We'll guide you through the simple process</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
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

          <div className="p-4 md:p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Check className="h-5 w-5 mr-2 text-primary" />
                  Food Establishment Certificate
                </h3>
                <p className="text-sm text-gray-500 mt-1">Required for operating a food business</p>
              </div>
              <a
                href="https://www.gov.nl.ca/dgsnl/licences/env-health/food/premises/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm font-medium hover:underline hover-text inline-flex items-center whitespace-nowrap"
              >
                Provincial Guidelines <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </div>

            <p className="mb-3 md:mb-4 text-gray-600">Do you have a Food Establishment Certificate?*</p>

            <RadioGroup
              onValueChange={(value) => form.setValue("foodEstablishmentCert", value as "yes" | "no" | "notSure")}
              defaultValue={formData.foodEstablishmentCert}
              className="flex flex-col space-y-3 md:space-y-4"
            >
              <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
                <RadioGroupItem value="yes" id="fec-yes" className="mt-1" />
                <div>
                  <Label htmlFor="fec-yes" className="font-medium cursor-pointer">Yes, I have a certificate</Label>
                  <p className="text-sm text-gray-500 mt-1">My kitchen has been inspected and approved</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
                <RadioGroupItem value="no" id="fec-no" className="mt-1" />
                <div>
                  <Label htmlFor="fec-no" className="font-medium cursor-pointer">Not yet, I'm interested</Label>
                  <p className="text-sm text-gray-500 mt-1">We'll connect you with resources to get started</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
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

        <div className="p-4 md:p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center mb-4">
              <Check className="h-5 w-5 mr-2 text-primary" />
              Preferred Order Fulfillment Methods
            </h3>
            <p className="mb-3 md:mb-4 text-gray-600">How would you like to fulfill customer orders?*</p>
          </div>

          <RadioGroup
            onValueChange={(value) => form.setValue("orderFulfillmentMethod", value as "preOrder" | "onDemand" | "both")}
            defaultValue={formData.orderFulfillmentMethod || "preOrder"}
            className="flex flex-col space-y-3 md:space-y-4"
          >
            <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
              <RadioGroupItem value="preOrder" id="order-pre" className="mt-1" />
              <div>
                <Label htmlFor="order-pre" className="font-medium cursor-pointer">Pre-Order System</Label>
                <p className="text-sm text-gray-500 mt-1">Customers order in advance, giving you time to prepare</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
              <RadioGroupItem value="onDemand" id="order-demand" className="mt-1" />
              <div>
                <Label htmlFor="order-demand" className="font-medium cursor-pointer">On-Demand Ordering</Label>
                <p className="text-sm text-gray-500 mt-1">Fulfill orders as they come in, similar to restaurant service</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-primary transition-all duration-200 hover:shadow-md">
              <RadioGroupItem value="both" id="order-both" className="mt-1" />
              <div>
                <Label htmlFor="order-both" className="font-medium cursor-pointer">Both Methods</Label>
                <p className="text-sm text-gray-500 mt-1">Flexible with either pre-orders or on-demand fulfillment</p>
              </div>
            </div>
          </RadioGroup>
          {form.formState.errors.orderFulfillmentMethod && (
            <p className="text-primary text-sm mt-2">
              {form.formState.errors.orderFulfillmentMethod.message}
            </p>
          )}
        </div>

        <div className="p-4 md:p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center mb-4">
              <Check className="h-5 w-5 mr-2 text-primary" />
              Questions or Additional Information
            </h3>
            <p className="mb-3 md:mb-4 text-gray-600">Is there anything else you'd like to share with us?</p>
          </div>

          <Textarea
            placeholder="Any questions, concerns, or additional information you'd like to share..."
            className="min-h-[120px]"
            {...form.register("questions")}
          />
        </div>

        <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            className="order-1 sm:order-none"
          >
            Back
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Application"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
