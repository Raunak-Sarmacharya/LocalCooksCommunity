import { eq } from "drizzle-orm";
import { checkinCheckoutChecklists } from "@shared/schema";
import { db } from "../db";

export async function storageInstructions(locationId: number, reader: Pick<typeof db, "select"> = db) {
  const [settings] = await reader.select({
    storageCheckinInstructions: checkinCheckoutChecklists.storageCheckinInstructions,
    storageCheckoutInstructions: checkinCheckoutChecklists.storageCheckoutInstructions,
  }).from(checkinCheckoutChecklists).where(eq(checkinCheckoutChecklists.locationId, locationId)).limit(1);
  return settings ?? null;
}
