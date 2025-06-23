import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Mail, Phone, User } from "lucide-react";
import { useEffect, useState } from "react";

// Create a schema for just the personal info fields - matching main schema validation
const personalInfoSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string()
    .min(13, "Phone numbers must be 10 digits")
    .regex(/^\+1\s[0-9\s\(\)\-\.]+$/, "Phone numbers must be 10 digits")
    .refine((val) => {
      const digitsOnly = val.replace(/\D/g, '');
      return digitsOnly.length === 11 && digitsOnly.startsWith('1');
    }, "Phone numbers must be 10 digits"),
});

type PersonalInfoFormData = z.infer<typeof personalInfoSchema>;

export default function PersonalInfoForm() {
  const { formData, updateFormData, goToNextStep } = useApplicationForm();
  const [phoneValue, setPhoneValue] = useState(() => {
    // Initialize with +1 prefix if not already present
    const existing = formData.phone || "";
    return existing.startsWith("+1") ? existing : "+1 ";
  });
  
  const form = useForm<PersonalInfoFormData>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: {
      fullName: formData.fullName || "",
      email: formData.email || "",
      phone: phoneValue,
    },
  });

  // Update form value when phoneValue changes
  useEffect(() => {
    form.setValue("phone", phoneValue);
  }, [phoneValue, form]);

  // Function to handle phone input with fixed +1 prefix and exactly 10 digits
  const handlePhoneInput = (e: React.FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget.value;
    
    // Always ensure it starts with "+1 "
    if (!input.startsWith("+1 ")) {
      setPhoneValue("+1 ");
      return;
    }
    
    // Extract the part after "+1 "
    const afterPrefix = input.substring(3);
    
    // Only allow numbers, spaces, parentheses, hyphens, and periods for the phone number part
    const filtered = afterPrefix.replace(/[^0-9\s\(\)\-\.]/g, '');
    
    // Count only the digits (excluding formatting characters)
    const digitsOnly = filtered.replace(/\D/g, '');
    
    // Limit to exactly 10 digits - truncate if more
    if (digitsOnly.length > 10) {
      const truncatedDigits = digitsOnly.substring(0, 10);
      // Auto-format to (XXX) XXX-XXXX when exactly 10 digits
      const formattedPhone = `(${truncatedDigits.slice(0, 3)}) ${truncatedDigits.slice(3, 6)}-${truncatedDigits.slice(6, 10)}`;
      setPhoneValue("+1 " + formattedPhone);
    } else {
      // Auto-format as user types
      if (digitsOnly.length >= 6) {
        const formattedPhone = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
        setPhoneValue("+1 " + formattedPhone);
      } else if (digitsOnly.length >= 3) {
        const formattedPhone = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3)}`;
        setPhoneValue("+1 " + formattedPhone);
      } else {
        setPhoneValue("+1 " + digitsOnly);
      }
    }
    
    // Trigger validation
    form.trigger("phone");
  };

  // Handle cursor position to prevent editing the "+1 " prefix
  const handlePhoneClick = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (input.selectionStart !== null && input.selectionStart < 3) {
      setTimeout(() => {
        input.setSelectionRange(3, 3);
      }, 0);
    }
  };

  const handlePhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const cursorPosition = input.selectionStart || 0;
    const currentValue = input.value;
    
    // Prevent editing the "+1 " prefix
    if (cursorPosition < 3 && ![37, 38, 39, 40, 9].includes(e.keyCode)) {
      if (e.keyCode === 8 || e.keyCode === 46) { // Backspace or Delete
        e.preventDefault();
        return;
      }
    }

    // Handle backspace to allow deletion through formatting characters
    if (e.keyCode === 8) { // Backspace
      const beforeCursor = currentValue.substring(0, cursorPosition);
      const afterCursor = currentValue.substring(cursorPosition);
      
      if (cursorPosition > 3) { // Allow backspace only after "+1 "
        // Find the last digit before cursor
        let newBeforeCursor = beforeCursor;
        let deletedChar = false;
        
        // Work backwards from cursor to find and remove the last digit
        for (let i = beforeCursor.length - 1; i >= 3; i--) {
          if (/\d/.test(beforeCursor[i])) {
            newBeforeCursor = beforeCursor.substring(0, i) + beforeCursor.substring(i + 1);
            deletedChar = true;
            break;
          }
        }
        
        if (deletedChar) {
          e.preventDefault();
          const newValue = newBeforeCursor + afterCursor;
          
          // Extract digits and reformat
          const digitsOnly = newValue.substring(3).replace(/\D/g, '');
          
          let formattedPhone;
          if (digitsOnly.length >= 6) {
            formattedPhone = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
          } else if (digitsOnly.length >= 3) {
            formattedPhone = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3)}`;
          } else {
            formattedPhone = digitsOnly;
          }
          
          const newFormattedValue = "+1 " + formattedPhone;
          setPhoneValue(newFormattedValue);
          
          // Set cursor position after the last digit
          setTimeout(() => {
            const lastDigitPos = newFormattedValue.search(/\d(?=[^\d]*$)/);
            if (lastDigitPos !== -1) {
              input.setSelectionRange(lastDigitPos + 1, lastDigitPos + 1);
            } else {
              input.setSelectionRange(3, 3);
            }
          }, 0);
          
          return;
        }
      }
    }
    
    // Allow backspace, delete, tab, escape, enter, and arrow keys
    if ([8, 9, 27, 13, 46, 37, 38, 39, 40].includes(e.keyCode) ||
        // Allow Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
        (e.ctrlKey === true && [65, 67, 86, 88].includes(e.keyCode))) {
      return;
    }
    
    // Check if adding this digit would exceed 10 digits in the phone number part
    const phoneDigits = currentValue.substring(3).replace(/\D/g, '');
    
    // If it's a number and we already have 10 digits, prevent input
    if (/[0-9]/.test(e.key) && phoneDigits.length >= 10) {
      e.preventDefault();
      return;
    }
    
    // Allow numbers (0-9), space, parentheses, hyphens, and periods
    const allowedChars = /[0-9\s\(\)\-\.]/;
    if (!allowedChars.test(e.key)) {
      e.preventDefault();
    }
  };

  // Get current digit count for display
  const getCurrentDigitCount = () => {
    const digits = phoneValue.substring(3).replace(/\D/g, '');
    return digits.length;
  };

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
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={phoneValue}
                onInput={handlePhoneInput}
                onClick={handlePhoneClick}
                onKeyDown={handlePhoneKeyDown}
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
            <div className="flex justify-between items-center mt-1">
              <p className="text-xs text-gray-500">
                phone number: Must be 10 digits
              </p>
              <p className={`text-xs font-medium ${getCurrentDigitCount() === 10 ? 'text-green-600' : 'text-gray-400'}`}>
                {getCurrentDigitCount()}/10 digits
              </p>
            </div>
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