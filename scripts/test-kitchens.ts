import { db, pool } from "../server/db";
import { kitchens, kitchenAvailability } from "@shared/schema";

async function testKitchens() {
  console.log("🔍 Testing kitchen database...\n");
  
  try {
    // Test 1: Get all kitchens using Drizzle
    console.log("Test 1: Fetching kitchens with Drizzle ORM...");
    const allKitchens = await db.select().from(kitchens);
    console.log(`✅ Found ${allKitchens.length} kitchens`);
    console.log("Kitchens:", JSON.stringify(allKitchens, null, 2));
    
    // Test 2: Get all kitchens using raw SQL
    if (pool) {
      console.log("\nTest 2: Fetching kitchens with raw SQL...");
      const result = await pool.query("SELECT * FROM kitchens");
      console.log(`✅ Found ${result.rows.length} kitchens`);
      console.log("Kitchens (raw):", JSON.stringify(result.rows, null, 2));
    }
    
    // Test 3: Check kitchen availability
    console.log("\nTest 3: Checking kitchen availability...");
    const availability = await db.select().from(kitchenAvailability);
    console.log(`✅ Found ${availability.length} availability records`);
    
    // Group by kitchen
    const byKitchen = availability.reduce((acc: any, avail: any) => {
      if (!acc[avail.kitchenId]) {
        acc[avail.kitchenId] = [];
      }
      acc[avail.kitchenId].push(avail);
      return acc;
    }, {});
    
    console.log("\nAvailability by kitchen:");
    for (const [kitchenId, avails] of Object.entries(byKitchen)) {
      console.log(`  Kitchen ${kitchenId}: ${(avails as any).length} time slots`);
    }
    
    // Test 4: Check for duplicates
    if (pool) {
      console.log("\nTest 4: Checking for duplicate availability records...");
      const duplicates = await pool.query(`
        SELECT kitchen_id, day_of_week, COUNT(*) as count
        FROM kitchen_availability
        GROUP BY kitchen_id, day_of_week
        HAVING COUNT(*) > 1
      `);
      
      if (duplicates.rows.length > 0) {
        console.log(`⚠️  Found ${duplicates.rows.length} duplicate groups:`);
        console.log(JSON.stringify(duplicates.rows, null, 2));
      } else {
        console.log("✅ No duplicates found!");
      }
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    process.exit(0);
  }
}

testKitchens();

