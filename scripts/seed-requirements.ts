
import 'dotenv/config';
import { db } from "../server/db";
import { locationRequirements } from "../shared/schema";
import { eq } from "drizzle-orm";

async function seedRequirements() {
    try {
        console.log("Seeding requirements for location 4...");

        // Check if exists
        const existing = await db.select().from(locationRequirements).where(eq(locationRequirements.locationId, 4));
        if (existing.length > 0) {
            console.log("Requirements already exist:", existing[0]);
            process.exit(0);
        }

        const result = await db.insert(locationRequirements).values({
            locationId: 4,
            requireFirstName: true,
            requireLastName: true,
            requireEmail: true,
            requirePhone: true,
            requireBusinessName: true,
            requireBusinessType: true,
            requireExperience: true,
            requireBusinessDescription: true, // Custom
            requireFoodHandlerCert: true,
            requireFoodHandlerExpiry: true,
            requireUsageFrequency: true,
            requireSessionDuration: true,
            requireTermsAgree: true,
            requireAccuracyAgree: true,
            // Tier 1 specifics
            tier1_years_experience_required: true,
            tier1_years_experience_minimum: 1,
            // Add a visible custom field to verify
            customFields: [
                {
                    id: "test_field",
                    label: "Tier 1 Test Field",
                    type: "text",
                    required: true
                }
            ]
        }).returning();

        console.log("Inserted:", result[0]);
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

seedRequirements();
