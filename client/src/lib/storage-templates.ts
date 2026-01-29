/**
 * Storage Templates
 * 
 * Pre-defined storage templates for commercial kitchens.
 * Managers can quickly select from these templates and customize as needed.
 * 
 * Enterprise-grade architecture with Lucide icon references (no emojis).
 */

export type StorageTypeId = 'dry' | 'cold' | 'freezer';

export interface StorageTemplate {
  id: string;
  name: string;
  storageType: StorageTypeId;
  description: string;
  suggestedDailyRate: number; // Suggested daily rate in dollars
  temperatureRange?: string; // Auto-filled for cold/freezer
  accessTypes: string[]; // Available access type options
  whatGoesIn: string[]; // Examples of what can be stored
}

export interface StorageCategory {
  id: StorageTypeId;
  name: string;
  iconName: string; // Lucide icon name for dynamic rendering
  description: string;
  temperatureRange?: string;
  items: StorageTemplate[];
}

// Category icon mapping for Lucide icons
export const STORAGE_CATEGORY_ICONS: Record<StorageTypeId, string> = {
  'dry': 'Package',
  'cold': 'Thermometer',
  'freezer': 'Snowflake',
};

export const STORAGE_CATEGORIES: StorageCategory[] = [
  {
    id: 'dry',
    name: 'Dry Storage',
    iconName: 'Package',
    description: 'Room temperature storage for non-perishables',
    items: [
      {
        id: 'dry-walk-in',
        name: 'Walk-in Dry Storage',
        storageType: 'dry',
        description: 'Large walk-in pantry space for bulk dry goods',
        suggestedDailyRate: 15,
        accessTypes: ['walk-in'],
        whatGoesIn: ['Canned goods', 'Flour & grains', 'Spices', 'Oils', 'Pasta', 'Rice'],
      },
      {
        id: 'dry-shelving',
        name: 'Dry Shelving Unit',
        storageType: 'dry',
        description: 'Dedicated shelving space for dry ingredients',
        suggestedDailyRate: 8,
        accessTypes: ['shelving-unit', 'open-rack'],
        whatGoesIn: ['Canned goods', 'Spices', 'Dry mixes', 'Packaging supplies'],
      },
      {
        id: 'dry-cabinet',
        name: 'Dry Storage Cabinet',
        storageType: 'dry',
        description: 'Enclosed cabinet for secure dry storage',
        suggestedDailyRate: 5,
        accessTypes: ['cabinet'],
        whatGoesIn: ['Spices', 'Small dry goods', 'Specialty ingredients'],
      },
    ],
  },
  {
    id: 'cold',
    name: 'Cold Storage',
    iconName: 'Thermometer',
    description: 'Refrigerated storage (35-40°F)',
    temperatureRange: '35-40°F',
    items: [
      {
        id: 'cold-walk-in',
        name: 'Walk-in Cooler',
        storageType: 'cold',
        description: 'Large walk-in refrigerated space',
        suggestedDailyRate: 25,
        temperatureRange: '35-40°F',
        accessTypes: ['walk-in'],
        whatGoesIn: ['Dairy', 'Fresh vegetables', 'Prepared items', 'Raw meats', 'Beverages'],
      },
      {
        id: 'cold-reach-in',
        name: 'Reach-in Refrigerator',
        storageType: 'cold',
        description: 'Standard commercial refrigerator space',
        suggestedDailyRate: 12,
        temperatureRange: '35-40°F',
        accessTypes: ['reach-in'],
        whatGoesIn: ['Dairy', 'Produce', 'Prepped ingredients', 'Sauces'],
      },
      {
        id: 'cold-under-counter',
        name: 'Under-counter Cooler',
        storageType: 'cold',
        description: 'Compact refrigerated space under prep counter',
        suggestedDailyRate: 6,
        temperatureRange: '35-40°F',
        accessTypes: ['under-counter'],
        whatGoesIn: ['Daily prep items', 'Garnishes', 'Quick-access ingredients'],
      },
    ],
  },
  {
    id: 'freezer',
    name: 'Freezer Storage',
    iconName: 'Snowflake',
    description: 'Frozen storage (0°F or colder)',
    temperatureRange: '0°F or colder',
    items: [
      {
        id: 'freezer-walk-in',
        name: 'Walk-in Freezer',
        storageType: 'freezer',
        description: 'Large walk-in frozen storage space',
        suggestedDailyRate: 30,
        temperatureRange: '0°F or colder',
        accessTypes: ['walk-in'],
        whatGoesIn: ['Bulk proteins', 'Frozen vegetables', 'Ice cream bases', 'Batch prep'],
      },
      {
        id: 'freezer-reach-in',
        name: 'Reach-in Freezer',
        storageType: 'freezer',
        description: 'Standard commercial freezer space',
        suggestedDailyRate: 15,
        temperatureRange: '0°F or colder',
        accessTypes: ['reach-in'],
        whatGoesIn: ['Proteins', 'Frozen produce', 'Prepared items'],
      },
      {
        id: 'freezer-chest',
        name: 'Chest Freezer',
        storageType: 'freezer',
        description: 'Deep chest freezer for bulk storage',
        suggestedDailyRate: 10,
        temperatureRange: '-10°F to 0°F',
        accessTypes: ['chest'],
        whatGoesIn: ['Bulk proteins', 'Long-term storage items'],
      },
    ],
  },
];

// Access type display names
export const ACCESS_TYPE_LABELS: Record<string, string> = {
  'walk-in': 'Walk-in',
  'reach-in': 'Reach-in',
  'under-counter': 'Under-counter',
  'shelving-unit': 'Shelving Unit',
  'open-rack': 'Open Rack',
  'cabinet': 'Cabinet',
  'chest': 'Chest',
};

/**
 * Get all storage templates as a flat array
 */
export function getAllStorageTemplates(): StorageTemplate[] {
  return STORAGE_CATEGORIES.flatMap(cat => cat.items);
}

/**
 * Get storage template by ID
 */
export function getStorageTemplateById(id: string): StorageTemplate | undefined {
  return getAllStorageTemplates().find(t => t.id === id);
}

/**
 * Get category by ID
 */
export function getStorageCategoryById(id: StorageTypeId): StorageCategory | undefined {
  return STORAGE_CATEGORIES.find(cat => cat.id === id);
}

/**
 * Map storage type ID to display name
 */
export function getStorageTypeDisplayName(typeId: StorageTypeId): string {
  const category = getStorageCategoryById(typeId);
  return category?.name || typeId;
}

/**
 * Get default temperature range for storage type
 */
export function getDefaultTemperatureRange(typeId: StorageTypeId): string | undefined {
  const category = getStorageCategoryById(typeId);
  return category?.temperatureRange;
}
