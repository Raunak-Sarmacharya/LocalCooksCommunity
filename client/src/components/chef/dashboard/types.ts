import { Application } from "@shared/schema";
import { ChefKitchenApplication } from "@shared/schema";

// Kitchen application with location data - using Omit to override the location type
export type KitchenApplicationWithLocation = Omit<ChefKitchenApplication, 'location'> & {
  location: {
    id: number;
    name: string;
    address: string;
    logoUrl?: string;
    brandImageUrl?: string;
    managerId?: number;
  } | null;
};

// Public kitchen data for enriching cards
export interface PublicKitchen {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  equipment?: string[];
  hourlyRate?: number | null;
  locationId: number;
  locationName: string;
  address: string;
  storageSummary?: {
    hasDryStorage: boolean;
    hasColdStorage: boolean;
    hasFreezerStorage: boolean;
    totalStorageUnits: number;
  };
}

// Booking location for booking sheet
export interface BookingLocation {
  id: number;
  name: string;
  address?: string;
}

// Kitchen summary for overview
export interface KitchenSummary {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
}

// Status variant helper type
export type StatusVariant = "default" | "secondary" | "destructive" | "outline";

// Application type alias
export type AnyApplication = Application;

// Microlearning completion data
export interface MicrolearningCompletion {
  confirmed?: boolean;
  completedModules?: number;
  totalModules?: number;
}

// Enriched booking type
export interface EnrichedBooking {
  id: number;
  kitchenId: number;
  kitchenName?: string;
  locationName?: string;
  location?: {
    id: number;
    name: string;
    cancellationPolicyHours?: number;
    cancellationPolicyMessage?: string;
  };
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  [key: string]: any;
}
