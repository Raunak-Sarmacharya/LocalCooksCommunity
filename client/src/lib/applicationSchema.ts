import { z } from "zod";

// Create a schema for the application form
export const applicationSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string()
    .min(13, "Phone numbers must be 10 digits")
    .regex(/^\+1\s[0-9\s\(\)\-\.]+$/, "Phone numbers must be 10 digits")
    .refine((val) => {
      const digitsOnly = val.replace(/\D/g, '');
      return digitsOnly.length === 11 && digitsOnly.startsWith('1');
    }, "Phone numbers must be 10 digits"),
  foodSafetyLicense: z.enum(["yes", "no"], {
    required_error: "Please select an option",
  }),
  foodEstablishmentCert: z.enum(["yes", "no"], {
    required_error: "Please select an option",
  }),
  feedback: z.string().optional(),
  kitchenPreference: z.enum(["commercial", "home", "notSure"], {
    required_error: "Please select an option",
  }),
  // Document URL fields (optional)
  foodSafetyLicenseUrl: z.string().optional(),
  foodEstablishmentCertUrl: z.string().optional(),
});

export type ApplicationFormData = z.infer<typeof applicationSchema>;

// Helper function to format certification status for display
export function formatCertificationStatus(status: string): string {
  switch (status) {
    case "yes": return "Yes";
    case "no": return "No";
    case "notSure": return "Not sure";
    default: return status;
  }
}

// Helper function to format kitchen preference for display
export function formatKitchenPreference(preference: string): string {
  switch (preference) {
    case "commercial": return "Commercial Kitchen";
    case "home": return "Home Kitchen";
    case "notSure": return "Not sure";
    default: return preference;
  }
}

// Helper function to get status badge color
export function getStatusBadgeColor(status: string): string {
  switch (status) {
    case "new": return "bg-yellow-100 text-yellow-800";
    case "inReview": return "bg-blue-100 text-blue-800";
    case "approved": return "bg-green-100 text-green-800";
    case "rejected": return "bg-red-100 text-red-800";
    case "cancelled": return "bg-gray-100 text-gray-800";
    default: return "bg-gray-100 text-gray-800";
  }
}

// Helper function to format application status for display
export function formatApplicationStatus(status: string): string {
  switch (status) {
    case "new": return "Getting Started";
    case "inReview": return "In Review";
    case "approved": return "Approved";
    case "rejected": return "Rejected";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}
