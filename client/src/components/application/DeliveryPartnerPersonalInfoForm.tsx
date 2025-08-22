import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

export default function DeliveryPartnerPersonalInfoForm() {
  const { formData, updateFormData, goToNextStep, canGoToNextStep } = useDeliveryPartnerForm();
  const [phoneValue, setPhoneValue] = useState(() => {
    // Initialize with +1 prefix if not already present
    const existing = formData.phone || "";
    return existing.startsWith("+1") ? existing : "+1 ";
  });

  // Update form value when phoneValue changes
  useEffect(() => {
    updateFormData({ phone: phoneValue });
  }, [phoneValue, updateFormData]);

  // Function to handle phone input with fixed +1 prefix and exactly 10 digits
  const handlePhoneInput = (e: React.FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget.value;
    
    // Always ensure +1 prefix
    if (!input.startsWith("+1")) {
      setPhoneValue("+1 " + input.replace(/^\+1\s*/, ""));
      return;
    }

    // Remove all non-digits except the +1 prefix
    const digitsOnly = input.replace(/\D/g, '');
    
    if (digitsOnly.length <= 1) {
      setPhoneValue("+1 ");
      return;
    }

    // Format the phone number
    let formatted = "+1 ";
    const remainingDigits = digitsOnly.substring(1); // Remove the 1 from +1
    
    if (remainingDigits.length > 0) {
      formatted += remainingDigits.substring(0, 3);
    }
    if (remainingDigits.length > 3) {
      formatted += " " + remainingDigits.substring(3, 6);
    }
    if (remainingDigits.length > 6) {
      formatted += " " + remainingDigits.substring(6, 10);
    }

    setPhoneValue(formatted);
  };

  const handlePhoneClick = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (input.value === "+1 ") {
      input.setSelectionRange(3, 3);
    }
  };

  const handlePhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const cursorPosition = input.selectionStart || 0;
    
    // Prevent deletion of +1 prefix
    if (e.key === "Backspace" && cursorPosition <= 3) {
      e.preventDefault();
    }
    
    // Prevent navigation before +1 prefix
    if (e.key === "ArrowLeft" && cursorPosition <= 3) {
      e.preventDefault();
      input.setSelectionRange(3, 3);
    }
  };

  const getCurrentDigitCount = () => {
    const digitsOnly = phoneValue.replace(/\D/g, '');
    return digitsOnly.length > 1 ? digitsOnly.length - 1 : 0; // Subtract 1 for the country code
  };

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    if (field === "phone") {
      // Phone is handled separately
      return;
    }
    updateFormData({ [field]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canGoToNextStep()) {
      goToNextStep();
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="fullName" className="text-sm font-medium text-gray-700">
            Full Name *
          </Label>
          <Input
            id="fullName"
            type="text"
            value={formData.fullName || ""}
            onChange={(e) => handleInputChange("fullName", e.target.value)}
            placeholder="Enter your full name"
            className="mt-1"
            required
          />
        </div>

        <div>
          <Label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email Address *
          </Label>
          <Input
            id="email"
            type="email"
            value={formData.email || ""}
            onChange={(e) => handleInputChange("email", e.target.value)}
            placeholder="Enter your email address"
            className="mt-1"
            required
          />
        </div>

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
          <div className="flex justify-between items-center mt-1">
            <p className="text-xs text-gray-500">
              Phone number: Must be 10 digits
            </p>
            <p className={`text-xs font-medium ${getCurrentDigitCount() === 10 ? 'text-green-600' : 'text-gray-400'}`}>
              {getCurrentDigitCount()}/10 digits
            </p>
          </div>
        </div>
      </div>

      <div className="pt-4">
        <Button
          type="submit"
          disabled={!canGoToNextStep()}
          className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Address
        </Button>
      </div>
    </motion.form>
  );
}
