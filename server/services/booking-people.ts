import { and, count, eq } from 'drizzle-orm';
import { kitchenBookings, kitchens, locations, users } from '@shared/schema';
import { db } from '../db';
import { getUserDisplayName } from '../utils/user-display';

/** Kitchen side "Chef" card: when the chef joined and visits completed at this manager's kitchens only (never other kitchens). */
export async function readChefCardFacts(managerId: number, chefId: number, database: Pick<typeof db, 'select'> = db) {
  const [user] = await database.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, chefId)).limit(1);
  const [row] = await database.select({ n: count() }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(eq(kitchenBookings.chefId, chefId), eq(locations.managerId, managerId), eq(kitchenBookings.status, 'completed')));
  return { memberSince: user?.createdAt?.toISOString() ?? null, completedBookingsHere: Number(row?.n ?? 0) };
}

/** Chef side "Hosted by": the manager's display name, or null when the only name we have is their email's local part. */
export async function readKitchenHostName(managerId: number, email: string, database: Pick<typeof db, 'select'> = db) {
  const name = (await getUserDisplayName(managerId, 'manager', database)).trim();
  return name && name !== 'Manager' && name !== email.split('@')[0] && !name.includes('@') ? name : null;
}
