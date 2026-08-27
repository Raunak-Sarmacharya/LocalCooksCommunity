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
  locationSlug?: string;
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

export type StatusVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning";

export interface KitchenSummary {
  label: string;
  variant: StatusVariant;
}

// Application type alias
export type AnyApplication = Application;

// Microlearning completion data
export interface MicrolearningCompletion {
  confirmed?: boolean;
  completedModules?: number;
  totalModules?: number;
}

export interface TrainingVideoProgress {
  completed?: boolean;
  progress?: number;
  watchedPercentage?: number;
}

export function getTrainingStatusLabel(
  completion?: MicrolearningCompletion | null,
  videoProgress?: TrainingVideoProgress[] | null,
  t?: import("i18next").TFunction<"chef", undefined>
): string {
  const tr = (key: string, fallback: string): string =>
    t ? (t(key, { defaultValue: fallback }) as string) : fallback;

  if (completion?.confirmed) return tr("trainingCompleted", "Completed");
  const videos = videoProgress ?? [];
  const hasStarted = videos.some(
    (v) => Boolean(v.completed) || (v.progress ?? 0) > 0 || (v.watchedPercentage ?? 0) > 0
  );
  return hasStarted ? tr("trainingInProgress", "In Progress") : tr("trainingNotStarted", "Not Started");
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
