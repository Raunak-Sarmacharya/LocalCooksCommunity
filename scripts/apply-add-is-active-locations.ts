import * as dotenv from "dotenv";
dotenv.config();
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
    try {
        await db.execute(sql`ALTER TABLE locations ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL;`);
        console.log("Successfully added is_active column to locations table.");
    } catch (e: any) {
        if (e.message && e.message.includes("already exists")) {
            console.log("Column is_active already exists.");
        } else {
            console.error("Error migrating:", e);
        }
    }
    process.exit(0);
}
main();
