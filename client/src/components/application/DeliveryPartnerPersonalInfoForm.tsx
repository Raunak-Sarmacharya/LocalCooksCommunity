import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

export default function DeliveryPartnerPersonalInfoForm() {
  const { formData, updateFormData, goToNextStep, canGoToNextStep } = useDeliveryPartnerForm();

  const handleInputChange = (field: keyof typeof formData, value: string) => {
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

        <div>
          <Label htmlFor="phone" className="text-sm font-medium text-gray-700">
            Phone Number *
          </Label>
          <Input
            id="phone"
            type="tel"
            value={formData.phone || ""}
            onChange={(e) => handleInputChange("phone", e.target.value)}
            placeholder="Enter your phone number"
            className="mt-1"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            We'll use this to contact you about your application
          </p>
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
