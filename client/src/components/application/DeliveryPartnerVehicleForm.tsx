import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePerformanceMonitor } from "@/hooks/use-performance-monitor";
import VehicleAPIClient, { VehicleMake, VehicleModel } from "@/lib/vehicleApi";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

// Only 4-wheeled vehicles allowed per database constraints
const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "suv", label: "SUV" },
  { value: "truck", label: "Truck" },
  { value: "van", label: "Van" }
];

const CURRENT_YEAR = new Date().getFullYear();

// Debounce hook for search inputs
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default function DeliveryPartnerVehicleForm() {
  const { formData, updateFormData, goToNextStep, goToPreviousStep, canGoToNextStep } = useDeliveryPartnerForm();
  const performanceMonitor = usePerformanceMonitor();
  
  // State for vehicle data from API
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMakeId, setSelectedMakeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Loading states for individual fields
  const [makesLoading, setMakesLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [yearsLoading, setYearsLoading] = useState(false);

  // Preload vehicle data on component mount
  useEffect(() => {
    const preloadData = async () => {
      try {
        performanceMonitor.startApiCall();
        // Preload makes in the background
        await VehicleAPIClient.preloadVehicleData();
        performanceMonitor.endApiCall();
        performanceMonitor.recordUserInteraction('Data preloaded');
      } catch (error) {
        console.error('Failed to preload vehicle data:', error);
        performanceMonitor.endApiCall();
      }
    };

    preloadData();
  }, [performanceMonitor]);

  // Load vehicle makes on component mount (only once)
  useEffect(() => {
    const loadMakes = async () => {
      try {
        setMakesLoading(true);
        setError(null);
        performanceMonitor.startApiCall();
        const makesData = await VehicleAPIClient.getMakes();
        performanceMonitor.endApiCall();
        setMakes(makesData);
        performanceMonitor.recordUserInteraction('Makes loaded');
      } catch (error) {
        console.error('Failed to load vehicle makes:', error);
        setError('Failed to load vehicle makes. Please try again.');
        performanceMonitor.endApiCall();
      } finally {
        setMakesLoading(false);
      }
    };

    loadMakes();
  }, [performanceMonitor]);

  // Load makes filtered by vehicle type when vehicle type changes
  useEffect(() => {
    if (formData.vehicleType) {
      const loadMakesForType = async () => {
        try {
          setMakesLoading(true);
          setError(null);
          performanceMonitor.startApiCall();
          const makesData = await VehicleAPIClient.getMakesForVehicleType(formData.vehicleType!);
          performanceMonitor.endApiCall();
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
          performanceMonitor.recordUserInteraction(`Makes filtered for ${formData.vehicleType}`);
        } catch (error) {
          console.error('Failed to load makes for vehicle type:', error);
          performanceMonitor.endApiCall();
          // Fallback to all makes if type-specific loading fails
          try {
            performanceMonitor.startApiCall();
            const allMakes = await VehicleAPIClient.getMakes();
            performanceMonitor.endApiCall();
            setMakes(allMakes);
          } catch (fallbackError) {
            console.error('Fallback to all makes also failed:', fallbackError);
            performanceMonitor.endApiCall();
          }
        } finally {
          setMakesLoading(false);
        }
      };

      loadMakesForType();
    }
  }, [formData.vehicleType, updateFormData, performanceMonitor]);

  // Load years when make is selected (debounced to avoid rapid API calls)
  const debouncedMakeId = useDebounce(selectedMakeId, 300);
  useEffect(() => {
    if (debouncedMakeId) {
      const loadYears = async () => {
        try {
          setYearsLoading(true);
          setError(null);
          performanceMonitor.startApiCall();
          
          // Clear any existing years first
          setYears([]);
          
          const yearsData = await VehicleAPIClient.getYears(debouncedMakeId);
          performanceMonitor.endApiCall();
          
          if (yearsData && yearsData.length > 0) {
            console.log(`📅 Loaded ${yearsData.length} years for make ID ${debouncedMakeId}:`, yearsData);
            setYears(yearsData);
            performanceMonitor.recordUserInteraction(`Years loaded: ${yearsData.length} years available`);
          } else {
            console.warn(`⚠️ No years found for make ID ${debouncedMakeId}`);
            setError('No years available for this make. Please try a different make.');
            performanceMonitor.recordUserInteraction('No years found for selected make');
          }
        } catch (error) {
          console.error('Failed to load vehicle years:', error);
          setError('Failed to load vehicle years. Please try selecting a different make.');
          performanceMonitor.endApiCall();
        } finally {
          setYearsLoading(false);
        }
      };

      loadYears();
    }
  }, [debouncedMakeId, performanceMonitor]);

  // Load models when make is selected (debounced to avoid rapid API calls)
  useEffect(() => {
    if (debouncedMakeId) {
      const loadModels = async () => {
        try {
          setModelsLoading(true);
          setError(null);
          performanceMonitor.startApiCall();
          
          // Clear any existing models first
          setModels([]);
          
          const modelsData = await VehicleAPIClient.getModelsForMake(debouncedMakeId);
          performanceMonitor.endApiCall();
          
          if (modelsData && modelsData.length > 0) {
            console.log(`🚗 Loaded ${modelsData.length} models for make ID ${debouncedMakeId}:`, modelsData);
            setModels(modelsData);
            performanceMonitor.recordUserInteraction(`Models loaded: ${modelsData.length} models found`);
          } else {
            console.warn(`⚠️ No models found for make ID ${debouncedMakeId}`);
            setError('No models found for this make. Please try a different make.');
            performanceMonitor.recordUserInteraction('No models found for selected make');
          }
        } catch (error) {
          console.error('Failed to load vehicle models:', error);
          setError('Failed to load vehicle models. Please try selecting a different make.');
          performanceMonitor.endApiCall();
        } finally {
          setModelsLoading(false);
        }
      };

      loadModels();
    }
  }, [debouncedMakeId, performanceMonitor]);

  const handleInputChange = useCallback((field: keyof typeof formData, value: string | number) => {
    updateFormData({ [field]: value });
    setError(null);
    performanceMonitor.recordUserInteraction(`${field} changed to ${value}`);
    
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
  }, [updateFormData, performanceMonitor]);

  const handleMakeChange = useCallback((makeId: string) => {
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
      performanceMonitor.recordUserInteraction(`Make selected: ${selectedMake.name}`);
    }
    
    // Reset dependent fields
    setModels([]);
    setYears([]);
  }, [makes, updateFormData, performanceMonitor]);

  const handleModelChange = useCallback((modelId: string) => {
    const modelIdNum = parseInt(modelId);
    setError(null);
    
    // Find the model name and update form
    const selectedModel = models.find(model => model.id === modelIdNum);
    if (selectedModel) {
      updateFormData({ vehicleModel: selectedModel.name });
      performanceMonitor.recordUserInteraction(`Model selected: ${selectedModel.name}`);
    }
  }, [models, updateFormData, performanceMonitor]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (canGoToNextStep()) {
      const metrics = performanceMonitor.getMetrics();
      performanceMonitor.recordUserInteraction('Form submitted');
      console.log('🚗 Final Performance Metrics:', metrics);
      goToNextStep();
    }
  }, [canGoToNextStep, goToNextStep, performanceMonitor]);

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
            Only 4-wheeled vehicles are permitted. Selecting a specific type will filter available makes.
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
              disabled={makesLoading}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={makesLoading ? "Loading makes..." : "Select vehicle make"} />
              </SelectTrigger>
              <SelectContent>
                {makes.map((make) => (
                  <SelectItem key={make.id} value={make.id.toString()}>
                    {make.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {makesLoading && (
              <LoadingSpinner size="sm" text="Loading vehicle makes..." className="mt-1" />
            )}
            <p className="text-xs text-gray-500 mt-1">
              {formData.vehicleType 
                ? `Filtered for ${formData.vehicleType}s`
                : 'All available makes'
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
              disabled={!selectedMakeId || modelsLoading}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={
                  !selectedMakeId ? "Select make first" :
                  modelsLoading ? "Loading models..." :
                  "Select vehicle model"
                } />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id.toString()}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modelsLoading && (
              <LoadingSpinner size="sm" text="Loading models..." className="mt-1" />
            )}
            {selectedMakeId && !modelsLoading && models.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">No models found for selected make</p>
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
              disabled={!selectedMakeId || yearsLoading}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={
                  !selectedMakeId ? "Select make first" :
                  yearsLoading ? "Loading years..." :
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
            {yearsLoading && (
              <LoadingSpinner size="sm" text="Loading years..." className="mt-1" />
            )}
            {!selectedMakeId && (
              <p className="text-xs text-gray-500 mt-1">Select a vehicle make first to see available years</p>
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
          <h4 className="text-sm font-medium text-green-800 mb-2">Performance Optimizations</h4>
          <ul className="text-xs text-green-700 space-y-1">
            <li>• Smart caching system for faster loading</li>
            <li>• Debounced API calls to reduce server requests</li>
            <li>• Background data preloading for better UX</li>
            <li>• Individual loading states for each field</li>
            <li>• Optimized backend endpoints for faster responses</li>
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
