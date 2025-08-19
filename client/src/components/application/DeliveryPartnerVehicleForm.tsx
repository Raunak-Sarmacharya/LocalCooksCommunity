import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VehicleAPIClient, { VehicleMake, VehicleModel } from "@/lib/vehicleApi";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

// Only 4-wheeled vehicles allowed per database constraints
const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "suv", label: "SUV" },
  { value: "truck", label: "Truck" },
  { value: "van", label: "Van" }
];

const CURRENT_YEAR = new Date().getFullYear();

export default function DeliveryPartnerVehicleForm() {
  const { formData, updateFormData, goToNextStep, goToPreviousStep, canGoToNextStep } = useDeliveryPartnerForm();
  
  // State for vehicle data from NHTSA API
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMakeId, setSelectedMakeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load vehicle makes on component mount
  useEffect(() => {
    const loadMakes = async () => {
      try {
        setLoading(true);
        setError(null);
        const makesData = await VehicleAPIClient.getMakes();
        setMakes(makesData);
      } catch (error) {
        console.error('Failed to load vehicle makes:', error);
        setError('Failed to load vehicle makes from NHTSA database. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadMakes();
  }, []);

  // Load makes filtered by vehicle type when vehicle type changes
  useEffect(() => {
    if (formData.vehicleType) {
      const loadMakesForType = async () => {
        try {
          setLoading(true);
          setError(null);
          const makesData = await VehicleAPIClient.getMakesForVehicleType(formData.vehicleType!);
          setMakes(makesData);
          // Reset make selection when vehicle type changes
          setSelectedMakeId(null);
          updateFormData({ 
            vehicleMake: '', 
            vehicleModel: '', 
            vehicleYear: undefined 
          });
          setModels([]);
          setYears([]);
        } catch (error) {
          console.error('Failed to load makes for vehicle type:', error);
          // Fallback to all makes if type-specific loading fails
          const allMakes = await VehicleAPIClient.getMakes();
          setMakes(allMakes);
        } finally {
          setLoading(false);
        }
      };

      loadMakesForType();
    }
  }, [formData.vehicleType]);

  // Load years when make is selected
  useEffect(() => {
    if (selectedMakeId) {
      const loadYears = async () => {
        try {
          setError(null);
          const yearsData = await VehicleAPIClient.getYears(selectedMakeId);
          setYears(yearsData);
        } catch (error) {
          console.error('Failed to load vehicle years:', error);
          setError('Failed to load vehicle years. Please try selecting a different make.');
        }
      };

      loadYears();
    }
  }, [selectedMakeId]);

  // Load models when make is selected
  useEffect(() => {
    if (selectedMakeId) {
      const loadModels = async () => {
        try {
          setError(null);
          const modelsData = await VehicleAPIClient.getModelsForMake(selectedMakeId);
          setModels(modelsData);
        } catch (error) {
          console.error('Failed to load vehicle models:', error);
          setError('Failed to load vehicle models. Please try selecting a different make.');
        }
      };

      loadModels();
    }
  }, [selectedMakeId]);

  // Models are now loaded once when make is selected, no year filtering needed

  const handleInputChange = (field: keyof typeof formData, value: string | number) => {
    updateFormData({ [field]: value });
    setError(null);
    
    // Reset dependent fields when make changes
    if (field === 'vehicleMake') {
      updateFormData({ 
        vehicleModel: '', 
        vehicleYear: undefined 
      });
      setSelectedMakeId(null);
      setModels([]);
      setYears([]);
    }
  };

  const handleMakeChange = (makeId: string) => {
    const makeIdNum = parseInt(makeId);
    setSelectedMakeId(makeIdNum);
    setError(null);
    
    // Find the make name and update form
    const selectedMake = makes.find(make => make.id === makeIdNum);
    if (selectedMake) {
      updateFormData({ 
        vehicleMake: selectedMake.name,
        vehicleModel: '',
        vehicleYear: undefined
      });
    }
    
    // Reset dependent fields
    setModels([]);
    setYears([]);
  };

  const handleModelChange = (modelId: string) => {
    const modelIdNum = parseInt(modelId);
    setError(null);
    
    // Find the model name and update form
    const selectedModel = models.find(model => model.id === modelIdNum);
    if (selectedModel) {
      updateFormData({ vehicleModel: selectedModel.name });
    }
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
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Label htmlFor="vehicleType" className="text-sm font-medium text-gray-700">
            Vehicle Type *
          </Label>
          <Select
            value={formData.vehicleType || ""}
            onValueChange={(value) => handleInputChange("vehicleType", value)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select your vehicle type" />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 mt-1">
            Only 4-wheeled vehicles are permitted. Selecting a specific type will filter available makes from NHTSA database.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="vehicleMake" className="text-sm font-medium text-gray-700">
              Vehicle Make *
            </Label>
            <Select
              value={selectedMakeId?.toString() || ""}
              onValueChange={handleMakeChange}
              disabled={loading}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={loading ? "Loading makes..." : "Select vehicle make"} />
              </SelectTrigger>
              <SelectContent>
                {makes.map((make) => (
                  <SelectItem key={make.id} value={make.id.toString()}>
                    {make.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loading && (
              <p className="text-xs text-gray-500 mt-1">Loading vehicle makes from NHTSA database...</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {formData.vehicleType 
                ? `Filtered for ${formData.vehicleType}s from NHTSA database`
                : 'All makes from NHTSA database'
              }
            </p>
          </div>

          <div>
            <Label htmlFor="vehicleModel" className="text-sm font-medium text-gray-700">
              Vehicle Model *
            </Label>
            <Select
              value={formData.vehicleModel || ""}
              onValueChange={handleModelChange}
              disabled={!selectedMakeId || models.length === 0}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={
                  !selectedMakeId ? "Select make first" :
                  models.length === 0 ? "Loading models..." :
                  "Select vehicle model"
                } />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMakeId && models.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">Loading models for selected make...</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="vehicleYear" className="text-sm font-medium text-gray-700">
              Vehicle Year (Optional)
            </Label>
            <Select
              value={formData.vehicleYear?.toString() || ""}
              onValueChange={(value) => handleInputChange("vehicleYear", parseInt(value))}
              disabled={!selectedMakeId || years.length === 0}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={
                  !selectedMakeId ? "Select make first" :
                  years.length === 0 ? "Loading years..." :
                  "Select vehicle year (optional)"
                } />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!selectedMakeId && (
              <p className="text-xs text-gray-500 mt-1">Select a vehicle make first to see available years</p>
            )}
            {selectedMakeId && (
              <p className="text-xs text-green-600 mt-1">Models loaded for selected make</p>
            )}
          </div>

          <div>
            <Label htmlFor="licensePlate" className="text-sm font-medium text-gray-700">
              License Plate *
            </Label>
            <Input
              id="licensePlate"
              type="text"
              value={formData.licensePlate || ""}
              onChange={(e) => handleInputChange("licensePlate", e.target.value.toUpperCase())}
              placeholder="Enter license plate"
              className="mt-1"
              required
            />
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-800 mb-2">Vehicle Requirements</h4>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Only 4-wheeled vehicles are allowed (cars, SUVs, trucks, vans)</li>
            <li>• Motorcycles, bicycles, and scooters are not permitted</li>
            <li>• Vehicle must be in good working condition</li>
            <li>• Valid registration and insurance required</li>
            <li>• Clean driving record preferred</li>
            <li>• Vehicle must meet local safety standards</li>
          </ul>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-green-800 mb-2">NHTSA Integration</h4>
          <ul className="text-xs text-green-700 space-y-1">
            <li>• Real-time vehicle data from National Highway Traffic Safety Administration</li>
            <li>• Comprehensive make and model database (no year dependency)</li>
            <li>• Vehicle type filtering for better accuracy</li>
            <li>• Access to safety ratings and recall information</li>
          </ul>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-800 mb-2">Vehicle Selection Flow</h4>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• 1. Select your vehicle type (car, SUV, truck, van)</li>
            <li>• 2. Choose the vehicle make from the filtered list</li>
            <li>• 3. Select your vehicle model from available options</li>
            <li>• 4. Optionally select year for additional details</li>
            <li>• 5. Enter your license plate number</li>
          </ul>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={goToPreviousStep}
          className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Back to Address
        </Button>
        <Button
          type="submit"
          disabled={!canGoToNextStep()}
          className="flex-1 bg-primary hover:bg-primary/90 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Documents
        </Button>
      </div>
    </motion.form>
  );
}
