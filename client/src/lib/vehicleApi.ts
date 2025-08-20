
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
  private modelsCache: Map<string, VehicleModel[]> = new Map();
  private yearsCache: Map<number, number[]> = new Map();
  private makesForTypeCache: Map<string, VehicleMake[]> = new Map();
  private cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours (increased from 10 minutes)
  private lastFetch = 0;
  private isPreloaded = false;

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

  setModels(makeName: string, models: VehicleModel[]): void {
    this.modelsCache.set(makeName, models);
  }

  getModels(makeName: string): VehicleModel[] | null {
    return this.modelsCache.get(makeName) || null;
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

  setPreloaded(): void {
    this.isPreloaded = true;
    this.lastFetch = Date.now();
  }

  isDataPreloaded(): boolean {
    return this.isPreloaded && this.isCacheValid();
  }

  clearCache(): void {
    this.makesCache = null;
    this.modelsCache.clear();
    this.yearsCache.clear();
    this.makesForTypeCache.clear();
    this.lastFetch = 0;
    this.isPreloaded = false;
  }

  // Clear specific make's data when it might be stale
  clearMakeData(makeName: string): void {
    this.modelsCache.delete(makeName);
    // Note: yearsCache still uses makeId for now since years API wasn't updated yet
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
      if (error instanceof Error && error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching vehicle makes:', error);
      throw error;
    }
  }

  /**
   * Get models for a specific make from local backend (cached)
   */
  static async getModelsForMake(makeName: string, signal?: AbortSignal): Promise<VehicleModel[]> {
    // Check cache first
    const cachedModels = vehicleCache.getModels(makeName);
    if (cachedModels) {
      return cachedModels;
    }



    try {
      const response = await fetch(`${API_BASE_URL}/models/by-name/${encodeURIComponent(makeName)}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle models: ${response.status}`);
      }
      
      const data = await response.json();
      const models = data.models || [];
      
      // Cache the result
      vehicleCache.setModels(makeName, models);
      return models;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
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
    console.log('VehicleAPIClient.getYears called with makeId:', makeId, 'type:', typeof makeId);
    
    // Validate makeId more thoroughly
    if (!makeId || isNaN(makeId) || !Number.isInteger(makeId) || makeId <= 0) {
      const errorMsg = `Invalid make ID: ${makeId} (type: ${typeof makeId})`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Check cache first
    const cachedYears = vehicleCache.getYears(makeId);
    if (cachedYears) {
      console.log('Returning cached years for makeId:', makeId);
      return cachedYears;
    }

    try {
      const url = `${API_BASE_URL}/years/${makeId}`;
      console.log('Fetching years from URL:', url);
      const response = await fetch(url, { signal });
      console.log('Years API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Years API error response:', errorText);
        
        // Parse error response if it's JSON
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.message) {
            throw new Error(errorData.message);
          }
        } catch (parseError) {
          // If it's not JSON, use the raw text
        }
        
        throw new Error(`Failed to fetch vehicle years: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      const years = data.years || [];
      console.log(`Successfully fetched ${years.length} years for make ID ${makeId}`);
      
      // Cache the result
      vehicleCache.setYears(makeId, years);
      return years;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching vehicle years for make ID', makeId, ':', error);
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
      if (error instanceof Error && error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Error fetching makes for vehicle type:', error);
      throw error;
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
  static clearMakeCache(makeName: string): void {
    vehicleCache.clearMakeData(makeName);
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
  static async searchModels(makeName: string, query: string): Promise<VehicleModel[]> {
    try {
      const models = await this.getModelsForMake(makeName);
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
