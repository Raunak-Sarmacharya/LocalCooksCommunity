import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VehicleAPIClient, { VehicleMake, VehicleModel } from "@/lib/vehicleApi";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

// Only 4-wheeled vehicles allowed per database constraints
const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "suv", label: "SUV" },
  { value: "truck", label: "Truck" },
  { value: "van", label: "Van" }
];

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
  
  // State for vehicle data from API
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [selectedMakeId, setSelectedMakeId] = useState<number | null>(null);
  const [selectedMakeName, setSelectedMakeName] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Loading states for individual fields
  const [makesLoading, setMakesLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [yearsLoading, setYearsLoading] = useState(false);

  // Refs for request cancellation
  const makesRequestRef = useRef<AbortController | null>(null);
  const modelsRequestRef = useRef<AbortController | null>(null);
  const yearsRequestRef = useRef<AbortController | null>(null);



  // Load makes filtered by vehicle type when vehicle type changes
  const loadMakesForType = async (vehicleType: string) => {
    // Cancel any existing request
    if (makesRequestRef.current) {
      makesRequestRef.current.abort();
    }
    
    const controller = new AbortController();
    makesRequestRef.current = controller;
    
    try {
      setMakesLoading(true);
      setError(null);
      const makesData = await VehicleAPIClient.getMakesForVehicleType(vehicleType, controller.signal);
      
      // Check if request was cancelled
      if (controller.signal.aborted) return;
      
      setMakes(makesData);
      // Reset make selection when vehicle type changes
      setSelectedMakeId(null);
      setSelectedMakeName(null);
      updateFormData({ 
        vehicleMake: '', 
        vehicleModel: '', 
        vehicleYear: undefined 
      });
      setModels([]);
      setYears([]);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return; // Request was cancelled
      setError('Failed to load vehicle makes. Please try again.');
    } finally {
      if (!controller.signal.aborted) {
        setMakesLoading(false);
      }
    }
  };

  // Load makes filtered by vehicle type when vehicle type changes
  useEffect(() => {
    if (formData.vehicleType) {
      loadMakesForType(formData.vehicleType);
    }
  }, [formData.vehicleType]);

  // Load models when make is selected (debounced to avoid rapid API calls)
  const debouncedMakeName = useDebounce(selectedMakeName, 300);
  useEffect(() => {
    if (debouncedMakeName) {
      const loadModels = async () => {
        // Cancel any existing requests
        if (modelsRequestRef.current) {
          modelsRequestRef.current.abort();
        }
        
        const modelsController = new AbortController();
        modelsRequestRef.current = modelsController;
        
        try {
          // Load models
          setModelsLoading(true);
          setError(null);
          
          // Clear existing data
          setModels([]);
          setYears([]);
          
          const modelsData = await VehicleAPIClient.getModelsForMake(debouncedMakeName, modelsController.signal);
          
          // Check if request was cancelled
          if (modelsController.signal.aborted) return;
          
          if (modelsData && modelsData.length > 0) {
            setModels(modelsData);
          } else {
            setError('No models found for this make. Please try a different make.');
            setModelsLoading(false);
            return;
          }
          
          setModelsLoading(false);
          
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return; // Request was cancelled
          setError('Failed to load vehicle data. Please try selecting a different make.');
        } finally {
          if (!modelsController.signal.aborted) {
            setModelsLoading(false);
          }
        }
      };

      loadModels();
    }
  }, [debouncedMakeName]);

  const handleInputChange = useCallback((field: keyof typeof formData, value: string | number) => {
    updateFormData({ [field]: value });
    setError(null);
    
    // Reset dependent fields when vehicle type changes
    if (field === 'vehicleType') {
      updateFormData({ 
        vehicleMake: '', 
        vehicleModel: '', 
        vehicleYear: undefined 
      });
      setSelectedMakeId(null);
      setSelectedMakeName(null);
      setSelectedModelId(null);
      setModels([]);
      setYears([]);
    }
  }, [updateFormData]);

  const handleMakeChange = useCallback((makeId: string) => {
    const makeIdNum = parseInt(makeId);
    setSelectedMakeId(makeIdNum);
    setSelectedModelId(null);
    setError(null);
    
    // Find the make name and update form
    const selectedMake = makes.find(make => make.id === makeIdNum);
    if (selectedMake) {
      setSelectedMakeName(selectedMake.name);
      updateFormData({ 
        vehicleMake: selectedMake.name,
        vehicleModel: '',
        vehicleYear: undefined
      });
    }
    
    // Reset dependent fields
    setModels([]);
    setYears([]);
  }, [makes, updateFormData]);

  const handleModelChange = useCallback(async (modelId: string) => {
    const modelIdNum = parseInt(modelId);
    setSelectedModelId(modelIdNum);
    setError(null);
    
    // Find the model name and update form
    const selectedModel = models.find(model => model.id === modelIdNum);
    if (selectedModel) {
      updateFormData({ 
        vehicleModel: selectedModel.name
      });
    }

    // Load years when model is selected (if make is selected)
    if (selectedMakeId) {
      try {
        setYearsLoading(true);
        const yearsData = await VehicleAPIClient.getYears(selectedMakeId);
        if (yearsData && yearsData.length > 0) {
          setYears(yearsData);
        }
      } catch (error) {
        console.error('Error loading years:', error);
        // Don't show error for years since it's optional
      } finally {
        setYearsLoading(false);
      }
    }
  }, [models, updateFormData, selectedMakeId]);

  // Cleanup function for component unmount
  useEffect(() => {
    return () => {
      // Cancel all pending requests when component unmounts
      if (makesRequestRef.current) makesRequestRef.current.abort();
      if (modelsRequestRef.current) modelsRequestRef.current.abort();
      if (yearsRequestRef.current) yearsRequestRef.current.abort();
    };
  }, []);

  // Memoize vehicle type options to prevent unnecessary re-renders
  const vehicleTypeOptions = useMemo(() => VEHICLE_TYPES, []);

  // Memoize the form validation to prevent unnecessary calculations
  const isFormValid = useMemo(() => {
    return formData.vehicleType && 
           formData.vehicleMake && 
           formData.vehicleModel;
    // Removed vehicleYear requirement since it's optional
  }, [formData.vehicleType, formData.vehicleMake, formData.vehicleModel]);

  // Optimize loading states to prevent form freezing
  const isFormLoading = useMemo(() => {
    return makesLoading || modelsLoading || yearsLoading;
  }, [makesLoading, modelsLoading, yearsLoading]);

  // Prevent form submission while loading
  const canSubmit = useMemo(() => {
    return isFormValid && !isFormLoading;
  }, [isFormValid, isFormLoading]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (canGoToNextStep()) {
      goToNextStep();
    }
  }, [canGoToNextStep, goToNextStep]);

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="space-y-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="space-y-6">


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
                {vehicleTypeOptions.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500 mt-1">
              Only 4-wheeled vehicles are permitted.
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
                disabled={!formData.vehicleType || makesLoading}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={
                    !formData.vehicleType ? "Select vehicle type first" :
                    makesLoading ? "Loading makes..." : 
                    "Select vehicle make"
                  } />
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

            </div>

            <div>
              <Label htmlFor="vehicleModel" className="text-sm font-medium text-gray-700">
                Vehicle Model *
              </Label>
              <Select
                value={selectedModelId?.toString() || ""}
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
              <li>• Vehicle must be in good working condition</li>
              <li>• Valid registration and insurance required</li>
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
      </div>
    </motion.form>
  );
}
