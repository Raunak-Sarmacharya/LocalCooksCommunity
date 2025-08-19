
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

// NHTSA API base URL
const NHTSA_BASE_URL = 'https://vpic.nhtsa.dot.gov/api';

export class VehicleAPIClient {
  /**
   * Get all available vehicle makes from NHTSA API
   */
  static async getMakes(): Promise<VehicleMake[]> {
    try {
      const response = await fetch(`${NHTSA_BASE_URL}/vehicles/GetAllMakes?format=json`);
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle makes: ${response.status}`);
      }
      
      const data = await response.json();
      // Transform NHTSA data to our format
      return (data.Results || []).map((make: any, index: number) => ({
        id: index + 1, // NHTSA doesn't provide IDs, so we generate them
        name: make.Make_Name
      }));
    } catch (error) {
      console.error('Error fetching vehicle makes from NHTSA:', error);
      throw error;
    }
  }

  /**
   * Get models for a specific make from NHTSA API (without year requirement)
   */
  static async getModelsForMake(makeId: number): Promise<VehicleModel[]> {
    try {
      // First get the make name from our makes list
      const makes = await this.getMakes();
      const selectedMake = makes.find(make => make.id === makeId);
      
      if (!selectedMake) {
        throw new Error('Make not found');
      }

      const response = await fetch(
        `${NHTSA_BASE_URL}/vehicles/getmodelsformake/${encodeURIComponent(selectedMake.name)}?format=json`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle models: ${response.status}`);
      }
      
      const data = await response.json();
      // Transform NHTSA data to our format
      return (data.Results || []).map((model: any, index: number) => ({
        id: index + 1, // NHTSA doesn't provide IDs, so we generate them
        name: model.Model_Name
      }));
    } catch (error) {
      console.error('Error fetching vehicle models from NHTSA:', error);
      throw error;
    }
  }

  // Year-based model filtering methods removed - models are now loaded once per make

  /**
   * Get available years for a specific make from NHTSA API
   */
  static async getYears(makeId: number): Promise<number[]> {
    try {
      // First get the make name from our makes list
      const makes = await this.getMakes();
      const selectedMake = makes.find(make => make.id === makeId);
      
      if (!selectedMake) {
        throw new Error('Make not found');
      }

      // First try the direct years endpoint
      try {
        const response = await fetch(
          `${NHTSA_BASE_URL}/vehicles/GetYearsForMake/${encodeURIComponent(selectedMake.name)}?format=json`
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.Results && data.Results.length > 0) {
            const years = data.Results.map((year: any) => parseInt(year.Year)).filter((year: number) => !isNaN(year));
            if (years.length > 0) {
              return years.sort((a: number, b: number) => b - a); // Most recent years first
            }
          }
        }
      } catch (error) {
        console.log('Direct years endpoint failed, using fallback method');
      }

      // Fallback: Generate a reasonable range of years
      const currentYear = new Date().getFullYear();
      const years: number[] = [];
      
      // Generate years from 1995 to current year + 1 (for upcoming models)
      for (let year = 1995; year <= currentYear + 1; year++) {
        years.push(year);
      }
      
      return years.sort((a: number, b: number) => b - a); // Most recent years first
    } catch (error) {
      console.error('Error fetching vehicle years from NHTSA:', error);
      throw error;
    }
  }

  /**
   * Get vehicle types for a specific make from NHTSA API
   */
  static async getVehicleTypesForMake(makeId: number): Promise<string[]> {
    try {
      const makes = await this.getMakes();
      const selectedMake = makes.find(make => make.id === makeId);
      
      if (!selectedMake) {
        throw new Error('Make not found');
      }

      const response = await fetch(
        `${NHTSA_BASE_URL}/vehicles/GetVehicleTypesForMake/${encodeURIComponent(selectedMake.name)}?format=json`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle types: ${response.status}`);
      }
      
      const data = await response.json();
      return (data.Results || []).map((type: any) => type.VehicleTypeName);
    } catch (error) {
      console.error('Error fetching vehicle types from NHTSA:', error);
      throw error;
    }
  }

  /**
   * Get vehicle safety ratings from NHTSA API
   */
  static async getSafetyRatings(make: string, model: string, year: number): Promise<any> {
    try {
      const response = await fetch(
        `${NHTSA_BASE_URL}/vehicles/GetVehicleVariableList?type=year&year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&format=json`
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
   * Get vehicle recalls from NHTSA API
   * Note: Using a different approach since the direct recalls endpoint has issues
   */
  static async getRecalls(make: string, model: string, year: number): Promise<any> {
    try {
      // Try using the safer recalls endpoint
      const response = await fetch(
        `${NHTSA_BASE_URL}/vehicles/GetVehicleVariableList?type=year&year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&format=json`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch vehicle data: ${response.status}`);
      }
      
      const data = await response.json();
      // Return basic vehicle info instead of recalls for now
      return {
        message: 'Recall information temporarily unavailable',
        vehicleData: data
      };
    } catch (error) {
      console.error('Error fetching vehicle data from NHTSA:', error);
      throw error;
    }
  }

  /**
   * Search makes by name (for autocomplete) - now using NHTSA data
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
   * Search models by name (for autocomplete) - now using NHTSA data
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

  /**
   * Get makes for a specific vehicle type from NHTSA API
   */
  static async getMakesForVehicleType(vehicleType: string): Promise<VehicleMake[]> {
    try {
      const response = await fetch(
        `${NHTSA_BASE_URL}/vehicles/GetMakesForVehicleType/${encodeURIComponent(vehicleType)}?format=json`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch makes for vehicle type: ${response.status}`);
      }
      
      const data = await response.json();
      return (data.Results || []).map((make: any, index: number) => ({
        id: index + 1,
        name: make.MakeName
      }));
    } catch (error) {
      console.error('Error fetching makes for vehicle type from NHTSA:', error);
      throw error;
    }
  }
}

// Export default instance
export default VehicleAPIClient;
