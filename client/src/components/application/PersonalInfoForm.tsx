import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";
import { useTranslation } from "react-i18next";
import { useFirebaseAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Phone validation helper (matches server-side validation)
const phoneNumberSchema = z.string()
  .min(1, "Phone number is required")
  .refine(
    (val) => {
      // Remove all non-digit characters except +
      const cleaned = val.replace(/[^\d+]/g, '');
      
      // Check if it starts with +
      if (cleaned.startsWith('+')) {
        const digitsAfterPlus = cleaned.substring(1);
        // Must be +1 followed by 10 digits (North American)
        if (digitsAfterPlus.startsWith('1') && digitsAfterPlus.length === 11) {
          const areaCode = parseInt(digitsAfterPlus[1]);
          const exchangeCode = parseInt(digitsAfterPlus[4]);
          return areaCode >= 2 && areaCode <= 9 && exchangeCode >= 2 && exchangeCode <= 9;
        }
        return false;
      }
      
      // Check 10 or 11 digit format
      const digitsOnly = cleaned.replace(/\D/g, '');
      if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        const areaCode = parseInt(digitsOnly[1]);
        const exchangeCode = parseInt(digitsOnly[4]);
        return areaCode >= 2 && areaCode <= 9 && exchangeCode >= 2 && exchangeCode <= 9;
      }
      if (digitsOnly.length === 10) {
        const areaCode = parseInt(digitsOnly[0]);
        const exchangeCode = parseInt(digitsOnly[3]);
        return areaCode >= 2 && areaCode <= 9 && exchangeCode >= 2 && exchangeCode <= 9;
      }
      return false;
    },
    {
      message: "Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
    }
  );

// Create a schema for just the personal info fields - matching main schema validation
const createPersonalInfoSchema = (t: (key: string) => string) => z.object({
  fullName: z.string().min(2, t("sellerApp_fullNameRequired")),
  email: z.string().email(t("sellerApp_emailInvalid")),
  phone: phoneNumberSchema,
});

type PersonalInfoFormData = z.infer<ReturnType<typeof createPersonalInfoSchema>>;

export default function PersonalInfoForm() {
  const { t } = useTranslation("chef");
  const { formData, updateFormData, goToNextStep } = useApplicationForm();
  const { user } = useFirebaseAuth();
  
  // Get email from authenticated user - they must be logged in to access this form
  const userEmail = user?.email || "";
  
  const [phoneValue, setPhoneValue] = useState(() => {
    // Initialize with +1 prefix if not already present
    const existing = formData.phone || "";
    return existing.startsWith("+1") ? existing : "+1 ";
  });
  
  const schema = createPersonalInfoSchema((key: string) => t(key as any));
  
  const form = useForm<PersonalInfoFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: formData.fullName || user?.displayName || "",
      email: userEmail,
      phone: phoneValue,
    },
  });
  
  // Update email field when user data loads
  useEffect(() => {
    if (userEmail && !form.getValues("email")) {
      form.setValue("email", userEmail);
    }
    if (user?.displayName && !form.getValues("fullName")) {
      form.setValue("fullName", user.displayName);
    }
  }, [userEmail, user?.displayName, form]);

  // Update form value when phoneValue changes
  useEffect(() => {
    form.setValue("phone", phoneValue, { shouldValidate: true, shouldDirty: true });
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="seller-application-step-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="fullName">{t("sellerApp_fullName")}</Label>
            <Input
              id="fullName"
              placeholder={t("sellerApp_fullNamePlaceholder")}
              {...form.register("fullName")}
              className="mt-2"
            />
            {form.formState.errors.fullName && (
              <p className="mt-1.5 text-sm text-destructive">{form.formState.errors.fullName.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="email">{t("sellerApp_email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t("sellerApp_emailPlaceholder")}
              {...form.register("email")}
              defaultValue={userEmail}
              className="mt-2"
            />
            {form.formState.errors.email && (
              <p className="mt-1.5 text-sm text-destructive">{form.formState.errors.email.message}</p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("sellerApp_emailPrefilled")}
            </p>
          </div>

          <div>
            <Label htmlFor="phone">{t("sellerApp_phone")}</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={phoneValue}
              onInput={handlePhoneInput}
              onClick={handlePhoneClick}
              onKeyDown={handlePhoneKeyDown}
              className="mt-2"
            />
            {form.formState.errors.phone && (
              <p className="mt-1.5 text-sm text-destructive">{form.formState.errors.phone.message}</p>
            )}
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{t("sellerApp_phoneDigits")}</p>
              <p className={cn("text-xs", getCurrentDigitCount() === 10 ? "text-success" : "text-muted-foreground")}>
                {getCurrentDigitCount()}/10
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2">
          <Button
            type="button"
            variant="outline"
            disabled
            className="border-gray-200 text-gray-400"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("sellerApp_back")}
          </Button>
          <Button type="submit" data-testid="seller-application-continue">
            {t("sellerApp_continue")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}