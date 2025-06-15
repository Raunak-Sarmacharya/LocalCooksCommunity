import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { User, Mail, Phone, ArrowRight } from "lucide-react";

// Create a schema for just the personal info fields
const personalInfoSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
});

type PersonalInfoFormData = z.infer<typeof personalInfoSchema>;

export default function PersonalInfoForm() {
  const { formData, updateFormData, goToNextStep } = useApplicationForm();
  
  const form = useForm<PersonalInfoFormData>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: {
      fullName: formData.fullName || "",
      email: formData.email || "",
      phone: formData.phone || "",
    },
  });

  const onSubmit = (data: PersonalInfoFormData) => {
    updateFormData(data);
    goToNextStep();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Welcome Banner */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Let's get to know you!</h2>
          <p className="text-gray-600 max-w-md mx-auto">We're excited to learn about you and help you join our community of talented chefs.</p>
        </div>

        <div className="space-y-6">
          {/* Full Name Field */}
          <div className="group">
            <Label htmlFor="fullName" className="text-gray-800 font-semibold flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-3 w-3 text-primary" />
              </div>
              Full Name*
            </Label>
            <div className="relative">
              <Input
                id="fullName"
                placeholder="Enter your full name"
                {...form.register("fullName")}
                className="pl-12 h-12 text-base border-2 border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 rounded-xl"
              />
              <User className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
            </div>
            {form.formState.errors.fullName && (
              <p className="text-primary text-sm mt-2 flex items-center gap-1">
                <span className="w-1 h-1 bg-primary rounded-full"></span>
                {form.formState.errors.fullName.message}
              </p>
            )}
          </div>
          
          {/* Email Field */}
          <div className="group">
            <Label htmlFor="email" className="text-gray-800 font-semibold flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-3 w-3 text-primary" />
              </div>
              Email Address*
            </Label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                {...form.register("email")}
                className="pl-12 h-12 text-base border-2 border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 rounded-xl"
              />
              <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
            </div>
            {form.formState.errors.email && (
              <p className="text-primary text-sm mt-2 flex items-center gap-1">
                <span className="w-1 h-1 bg-primary rounded-full"></span>
                {form.formState.errors.email.message}
              </p>
            )}
          </div>
          
          {/* Phone Field */}
          <div className="group">
            <Label htmlFor="phone" className="text-gray-800 font-semibold flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                <Phone className="h-3 w-3 text-primary" />
              </div>
              Phone Number*
            </Label>
            <div className="relative">
              <Input
                id="phone"
                placeholder="(555) 123-4567"
                {...form.register("phone")}
                className="pl-12 h-12 text-base border-2 border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 rounded-xl"
              />
              <Phone className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
            </div>
            {form.formState.errors.phone && (
              <p className="text-primary text-sm mt-2 flex items-center gap-1">
                <span className="w-1 h-1 bg-primary rounded-full"></span>
                {form.formState.errors.phone.message}
              </p>
            )}
          </div>
        </div>
        
        {/* Submit Button */}
        <div className="pt-6">
          <Button 
            type="submit"
            className="w-full bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 text-white font-semibold py-4 px-8 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-3 text-base"
          >
            Continue to Kitchen Preferences
            <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform duration-200" />
          </Button>
        </div>

        {/* Privacy Note */}
        <div className="text-center pt-4">
          <p className="text-sm text-gray-500">
            🔒 Your information is secure and will only be used for application processing
          </p>
        </div>
      </form>
    </Form>
  );
}