import { z } from "zod";

export const createLocationSchema = z.object({
    name: z.string().min(2, "Location name must be at least 2 characters"),
    address: z.string().min(5, "Address must be at least 5 characters"),
    notificationEmail: z.string().email("Invalid email address").optional().or(z.literal("")),
    notificationPhone: z.string().optional(), // Could add phone validation regex here if strictness is desired
    // File handling is often cleaner separate or as 'any' in schema if not sending direct to JSON API
    // We'll handle file separately or via a custom field in the form component
});

export type CreateLocationFormValues = z.infer<typeof createLocationSchema>;
