
export interface VehicleMake {
  id: number;
  name: string;
}

export interface VehicleModel {
  id: number;
  name: string;
}

export interface VehicleInfo {
  make?: string;
  model?: string;
  year?: string;
  type?: string;
  bodyClass?: string;
  engine?: string;
  transmission?: string;
}

// Use local backend endpoints instead of external NHTSA calls
const API_BASE_URL = '/api/vehicles';

// Cache for vehicle data to avoid repeated API calls
class VehicleCache {
  private makesCache: VehicleMake[] | null = null;
  private modelsCache: Map<number, VehicleModel[]> = new Map();
  private yearsCache: Map<number, number[]> = new Map();
  private makesForTypeCache: Map<string, VehicleMake[]> = new Map();
  private cacheExpiry = 10 * 60 * 1000; // 10 minutes (increased from 5)
  private lastFetch = 0;

  private isCacheValid(): boolean {
    return Date.now() - this.lastFetch < this.cacheExpiry;
  }

  setMakes(makes: VehicleMake[]): void {
    this.makesCache = makes;
    this.lastFetch = Date.now();
  }

  getMakes(): VehicleMake[] | null {
    return this.isCacheValid() ? this.makesCache : null;
  }

  setModels(makeId: number, models: VehicleModel[]): void {
    this.modelsCache.set(makeId, models);
  }

  getModels(makeId: number): VehicleModel[] | null {
    return this.modelsCache.get(makeId) || null;
  }

  setYears(makeId: number, years: number[]): void {
    this.yearsCache.set(makeId, years);
  }

  getYears(makeId: number): number[] | null {
    return this.yearsCache.get(makeId) || null;
  }

  setMakesForType(vehicleType: string, makes: VehicleMake[]): void {
    this.makesForTypeCache.set(vehicleType, makes);
  }

  getMakesForType(vehicleType: string): VehicleMake[] | null {
    return this.makesForTypeCache.get(vehicleType) || null;
  }

  clearCache(): void {
    this.makesCache = null;
    this.modelsCache.clear();
    this.yearsCache.clear();
    this.makesForTypeCache.clear();
    this.lastFetch = 0;
  }

  // Clear specific make's data when it might be stale
  clearMakeData(makeId: number): void {
    this.modelsCache.delete(makeId);
    this.yearsCache.delete(makeId);
  }

  // Clear all type-specific data
  clearTypeData(): void {
    this.makesForTypeCache.clear();
  }
}

const vehicleCache = new VehicleCache();

export class VehicleAPIClient {
  /**
   * Get all available vehicle makes from local backend (cached)
   */
  static async getMakes(signal?: AbortSignal): Promise<VehicleMake[]> {
    // Check cache first
    const cachedMakes = vehicleCache.getMakes();
    if (cachedMakes) {
      return cachedMakes;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/makes`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle makes: ${response.status}`);
      }
      
      const data = await response.json();
      const makes = data.makes || [];
      
      // Cache the result
      vehicleCache.setMakes(makes);
      return makes;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching vehicle makes:', error);
      throw error;
    }
  }

  /**
   * Get models for a specific make from local backend (cached)
   */
  static async getModelsForMake(makeId: number, signal?: AbortSignal): Promise<VehicleModel[]> {
    // Check cache first
    const cachedModels = vehicleCache.getModels(makeId);
    if (cachedModels) {
      return cachedModels;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/models/${makeId}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle models: ${response.status}`);
      }
      
      const data = await response.json();
      const models = data.models || [];
      
      // Cache the result
      vehicleCache.setModels(makeId, models);
      return models;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching vehicle models:', error);
      throw error;
    }
  }

  /**
   * Get available years for a specific make from local backend (cached)
   */
  static async getYears(makeId: number, signal?: AbortSignal): Promise<number[]> {
    // Check cache first
    const cachedYears = vehicleCache.getYears(makeId);
    if (cachedYears) {
      return cachedYears;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/years/${makeId}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle years: ${response.status}`);
      }
      
      const data = await response.json();
      const years = data.years || [];
      
      // Cache the result
      vehicleCache.setYears(makeId, years);
      return years;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching vehicle years:', error);
      throw error;
    }
  }

  /**
   * Get makes for a specific vehicle type from local backend (cached)
   */
  static async getMakesForVehicleType(vehicleType: string, signal?: AbortSignal): Promise<VehicleMake[]> {
    // Check cache first
    const cachedMakes = vehicleCache.getMakesForType(vehicleType);
    if (cachedMakes) {
      return cachedMakes;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/makes/type/${encodeURIComponent(vehicleType)}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch makes for vehicle type: ${response.status}`);
      }
      
      const data = await response.json();
      const makes = data.makes || [];
      
      // Cache the result
      vehicleCache.setMakesForType(vehicleType, makes);
      return makes;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching makes for vehicle type:', error);
      throw error;
    }
  }

  /**
   * Preload all vehicle data for better performance
   */
  static async preloadVehicleData(): Promise<void> {
    try {
      // Preload makes in the background
      this.getMakes().catch(console.error);
    } catch (error) {
      console.error('Error preloading vehicle data:', error);
    }
  }

  /**
   * Clear cache (useful for testing or when data becomes stale)
   */
  static clearCache(): void {
    vehicleCache.clearCache();
  }

  /**
   * Clear cache for a specific make (useful when make data might be stale)
   */
  static clearMakeCache(makeId: number): void {
    vehicleCache.clearMakeData(makeId);
  }

  /**
   * Clear cache for vehicle types (useful when type data might be stale)
   */
  static clearTypeCache(): void {
    vehicleCache.clearTypeData();
  }

  /**
   * Get vehicle safety ratings from NHTSA API
   */
  static async getSafetyRatings(make: string, model: string, year: number): Promise<any> {
    try {
      const response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/GetVehicleVariableList?type=year&year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&format=json`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch safety ratings: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching safety ratings from NHTSA:', error);
      throw error;
    }
  }

  /**
   * Decode VIN for additional vehicle information
   */
  static async decodeVIN(vin: string): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/decode-vin/${vin}`);
      if (!response.ok) {
        throw new Error(`Failed to decode VIN: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error decoding VIN:', error);
      throw error;
    }
  }

  /**
   * Search makes by name (for autocomplete) - now using cached data
   */
  static async searchMakes(query: string): Promise<VehicleMake[]> {
    try {
      const makes = await this.getMakes();
      if (!query) return makes;
      
      const searchTerm = query.toLowerCase();
      return makes.filter(make => 
        make.name.toLowerCase().includes(searchTerm)
      );
    } catch (error) {
      console.error('Error searching makes:', error);
      throw error;
    }
  }

  /**
   * Search models by name (for autocomplete) - now using cached data
   */
  static async searchModels(makeId: number, query: string): Promise<VehicleModel[]> {
    try {
      const models = await this.getModelsForMake(makeId);
      if (!query) return models;
      
      const searchTerm = query.toLowerCase();
      return models.filter(model => 
        model.name.toLowerCase().includes(searchTerm)
      );
    } catch (error) {
      console.error('Error searching models:', error);
      throw error;
    }
  }
}

// Export default instance
export default VehicleAPIClient;
