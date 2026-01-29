/**
 * Equipment Templates
 * 
 * Pre-defined equipment templates for commercial kitchens.
 * Managers can quickly select from these templates and customize as needed.
 * 
 * Enterprise-grade architecture with Lucide icon references (no emojis).
 */

export type EquipmentCategoryId = 'cooking' | 'food-prep' | 'refrigeration' | 'cleaning' | 'specialty';

export interface EquipmentTemplate {
  id: string;
  name: string;
  category: EquipmentCategoryId;
  defaultCondition: 'excellent' | 'good' | 'fair';
  suggestedSessionRate: number; // Suggested rental rate per session in dollars
}

export interface EquipmentCategory {
  id: EquipmentCategoryId;
  name: string;
  iconName: string; // Lucide icon name for dynamic rendering
  items: EquipmentTemplate[];
}

// Category icon mapping for Lucide icons
export const CATEGORY_ICONS: Record<EquipmentCategoryId, string> = {
  'cooking': 'Flame',
  'food-prep': 'ChefHat',
  'refrigeration': 'Snowflake',
  'specialty': 'Sparkles',
  'cleaning': 'SprayCan',
};

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  {
    id: 'cooking',
    name: 'Cooking Equipment',
    iconName: 'Flame',
    items: [
      { id: 'commercial-oven', name: 'Commercial Oven', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 25 },
      { id: 'range-stove', name: 'Range/Stove', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 20 },
      { id: 'fryer', name: 'Deep Fryer', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'grill', name: 'Commercial Grill', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 20 },
      { id: 'steamer', name: 'Steamer', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'griddle', name: 'Griddle/Flattop', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'kettle', name: 'Steam Kettle', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 20 },
      { id: 'pasta-cooker', name: 'Pasta Cooker', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'wok-station', name: 'Wok Station', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 20 },
      { id: 'rotisserie', name: 'Rotisserie', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 25 },
      { id: 'smoker', name: 'Smoker', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 30 },
      { id: 'convection-oven', name: 'Convection Oven', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 25 },
      { id: 'combi-oven', name: 'Combi Oven', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 35 },
      { id: 'salamander', name: 'Salamander/Broiler', category: 'cooking', defaultCondition: 'good', suggestedSessionRate: 15 },
    ],
  },
  {
    id: 'food-prep',
    name: 'Prep Equipment',
    iconName: 'ChefHat',
    items: [
      { id: 'mixer-5qt', name: 'Planetary Mixer (5qt)', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 10 },
      { id: 'mixer-20qt', name: 'Planetary Mixer (20qt)', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'mixer-60qt', name: 'Planetary Mixer (60qt)', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 25 },
      { id: 'food-processor', name: 'Food Processor', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 10 },
      { id: 'blender', name: 'Commercial Blender', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 8 },
      { id: 'immersion-blender', name: 'Immersion Blender', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 5 },
      { id: 'meat-slicer', name: 'Meat Slicer', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 12 },
      { id: 'vegetable-slicer', name: 'Vegetable Slicer', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 10 },
      { id: 'meat-grinder', name: 'Meat Grinder', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 12 },
      { id: 'juicer', name: 'Commercial Juicer', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 10 },
      { id: 'spiralizer', name: 'Spiralizer', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 5 },
      { id: 'work-table', name: 'Stainless Work Table', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'prep-sink', name: '3-Compartment Sink', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'cutting-board-station', name: 'Cutting Board Station', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'vacuum-sealer', name: 'Vacuum Sealer', category: 'food-prep', defaultCondition: 'good', suggestedSessionRate: 8 },
    ],
  },
  {
    id: 'refrigeration',
    name: 'Refrigeration',
    iconName: 'Snowflake',
    items: [
      { id: 'walk-in-cooler', name: 'Walk-in Cooler', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'walk-in-freezer', name: 'Walk-in Freezer', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'reach-in-fridge', name: 'Reach-in Refrigerator', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'reach-in-freezer', name: 'Reach-in Freezer', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'prep-table-cooler', name: 'Refrigerated Prep Table', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 10 },
      { id: 'blast-chiller', name: 'Blast Chiller', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 20 },
      { id: 'ice-machine', name: 'Ice Machine', category: 'refrigeration', defaultCondition: 'good', suggestedSessionRate: 0 },
    ],
  },
  {
    id: 'specialty',
    name: 'Specialty Equipment',
    iconName: 'Sparkles',
    items: [
      { id: 'pasta-maker', name: 'Pasta Maker/Extruder', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 25 },
      { id: 'chocolate-tempering', name: 'Chocolate Tempering Machine', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 30 },
      { id: 'sous-vide', name: 'Sous Vide Machine', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'smoking-chamber', name: 'Smoking/Curing Chamber', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 35 },
      { id: 'dehydrator', name: 'Commercial Dehydrator', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'ice-cream-machine', name: 'Ice Cream Machine', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 25 },
      { id: 'soft-serve', name: 'Soft-Serve Machine', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 30 },
      { id: 'dim-sum-steamer', name: 'Dim Sum Steamer Stack', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'pizza-oven', name: 'Pizza Oven', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 30 },
      { id: 'tandoor', name: 'Tandoor Oven', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 35 },
      { id: 'espresso-machine', name: 'Commercial Espresso Machine', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 20 },
      { id: 'bread-proofer', name: 'Bread Proofer', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 15 },
      { id: 'dough-sheeter', name: 'Dough Sheeter', category: 'specialty', defaultCondition: 'good', suggestedSessionRate: 20 },
    ],
  },
  {
    id: 'cleaning',
    name: 'Cleaning & Sanitation',
    iconName: 'SprayCan',
    items: [
      { id: 'dishwasher', name: 'Commercial Dishwasher', category: 'cleaning', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'glass-washer', name: 'Glass Washer', category: 'cleaning', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'sanitizer-station', name: 'Sanitizer Station', category: 'cleaning', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'hand-wash-sink', name: 'Hand Wash Sink', category: 'cleaning', defaultCondition: 'good', suggestedSessionRate: 0 },
      { id: 'floor-drain', name: 'Floor Drain System', category: 'cleaning', defaultCondition: 'good', suggestedSessionRate: 0 },
    ],
  },
];

/**
 * Get all equipment templates as a flat array
 */
export function getAllEquipmentTemplates(): EquipmentTemplate[] {
  return EQUIPMENT_CATEGORIES.flatMap(cat => cat.items);
}

/**
 * Get equipment template by ID
 */
export function getEquipmentTemplateById(id: string): EquipmentTemplate | undefined {
  return getAllEquipmentTemplates().find(t => t.id === id);
}

/**
 * Get category by ID
 */
export function getCategoryById(id: string): EquipmentCategory | undefined {
  return EQUIPMENT_CATEGORIES.find(cat => cat.id === id);
}

/**
 * Map category ID to display name
 */
export function getCategoryDisplayName(categoryId: string): string {
  const category = getCategoryById(categoryId);
  return category?.name || categoryId;
}
