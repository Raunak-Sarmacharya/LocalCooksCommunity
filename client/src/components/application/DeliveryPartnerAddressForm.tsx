import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

const PROVINCES = [
  "Alberta",
  "British Columbia", 
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Nova Scotia",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Northwest Territories",
  "Nunavut",
  "Yukon"
];

export default function DeliveryPartnerAddressForm() {
  const { formData, updateFormData, goToNextStep, goToPreviousStep, canGoToNextStep } = useDeliveryPartnerForm();

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
          <Label htmlFor="address" className="text-sm font-medium text-gray-700">
            Street Address *
          </Label>
          <Input
            id="address"
            type="text"
            value={formData.address || ""}
            onChange={(e) => handleInputChange("address", e.target.value)}
            placeholder="Enter your street address"
            className="mt-1"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="city" className="text-sm font-medium text-gray-700">
              City *
            </Label>
            <Input
              id="city"
              type="text"
              value={formData.city || ""}
              onChange={(e) => handleInputChange("city", e.target.value)}
              placeholder="Enter your city"
              className="mt-1"
              required
            />
          </div>

          <div>
            <Label htmlFor="province" className="text-sm font-medium text-gray-700">
              Province/Territory *
            </Label>
            <Select
              value={formData.province || ""}
              onValueChange={(value) => handleInputChange("province", value)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select your province" />
              </SelectTrigger>
              <SelectContent>
                {PROVINCES.map((province) => (
                  <SelectItem key={province} value={province}>
                    {province}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="postalCode" className="text-sm font-medium text-gray-700">
            Postal Code *
          </Label>
          <Input
            id="postalCode"
            type="text"
            value={formData.postalCode || ""}
            onChange={(e) => handleInputChange("postalCode", e.target.value.toUpperCase())}
            placeholder="A1A 1A1"
            className="mt-1"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Format: A1A 1A1 (Canadian postal code format)
          </p>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={goToPreviousStep}
          className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Back to Personal Info
        </Button>
        <Button
          type="submit"
          disabled={!canGoToNextStep()}
          className="flex-1 bg-primary hover:bg-primary/90 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Vehicle Details
        </Button>
      </div>
    </motion.form>
  );
}
