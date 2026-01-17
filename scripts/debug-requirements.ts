
import 'dotenv/config';
import { db } from "../server/db";
import { locationRequirements } from "../shared/schema";
import { eq } from "drizzle-orm";

async function checkRequirements() {
    try {
        console.log("Checking requirements for location 26...");
        const result = await db.select().from(locationRequirements).where(eq(locationRequirements.locationId, 26));
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

checkRequirements();
