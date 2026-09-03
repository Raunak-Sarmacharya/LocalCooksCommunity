/**
 * Dev-only: temporarily assign locations.managerId to the Journey C/D TestSprite manager.
 * Idempotent grant/revoke with DB backup of the original owner.
 * Does NOT borrow Stripe Connect accounts (unique + shared-DB risk).
 * Journey D ordering: revoke → checkout (Connect owner) → grant → manager approve.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { locations, kitchenViewings, users } from "@shared/schema";
import {
  DEV_FIXTURE_MANAGER_EMAIL,
  isAllowedFixtureLocationId,
  isAllowedFixtureManagerEmail,
} from "./dev-auth-bypass-gates";
import { logger } from "./logger";

const BACKUP_TABLE = "_dev_fixture_location_manager_backup";

async function ensureBackupTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.raw(BACKUP_TABLE)} (
      location_id integer PRIMARY KEY,
      original_manager_id integer,
      fixture_manager_id integer NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

type BackupRow = {
  location_id: number;
  original_manager_id: number | null;
  fixture_manager_id: number;
};

async function getBackup(locationId: number): Promise<BackupRow | undefined> {
  const result = await db.execute(sql`
    SELECT location_id, original_manager_id, fixture_manager_id
    FROM ${sql.raw(BACKUP_TABLE)}
    WHERE location_id = ${locationId}
  `);
  const raw = result as unknown as BackupRow[] | { rows?: BackupRow[] };
  const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
  return rows[0];
}

export type FixtureGrantResult = {
  locationId: number;
  fixtureManagerId: number;
  fixtureEmail: string;
  originalManagerId: number | null;
  alreadyGranted: boolean;
};

export type FixtureRevokeResult = {
  locationId: number;
  restoredManagerId: number | null;
  hadBackup: boolean;
};

export async function grantFixtureManagerLocation(opts: {
  locationId: number;
  managerEmail?: string;
}): Promise<FixtureGrantResult> {
  const locationId = opts.locationId;
  if (!isAllowedFixtureLocationId(locationId)) {
    throw Object.assign(new Error("Location not in fixture allowlist"), {
      status: 403,
    });
  }

  const email = (opts.managerEmail || DEV_FIXTURE_MANAGER_EMAIL)
    .trim()
    .toLowerCase();
  if (!isAllowedFixtureManagerEmail(email)) {
    throw Object.assign(new Error("Manager email not in fixture allowlist"), {
      status: 403,
    });
  }

  const [manager] = await db
    .select({ id: users.id, isManager: users.isManager })
    .from(users)
    .where(eq(users.username, email))
    .limit(1);

  if (!manager) {
    throw Object.assign(
      new Error(
        `Fixture manager not found — issue auth-bypass for ${email} first`
      ),
      { status: 404 }
    );
  }
  if (!manager.isManager) {
    throw Object.assign(new Error("Fixture user is not a manager"), {
      status: 403,
    });
  }

  const [location] = await db
    .select({ id: locations.id, managerId: locations.managerId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!location) {
    throw Object.assign(new Error("Location not found"), { status: 404 });
  }

  await ensureBackupTable();
  const backupRow = await getBackup(locationId);

  if (
    backupRow &&
    location.managerId === manager.id &&
    backupRow.fixture_manager_id === manager.id
  ) {
    await db
      .update(kitchenViewings)
      .set({ managerId: manager.id, updatedAt: new Date() })
      .where(
        and(
          eq(kitchenViewings.locationId, locationId),
          inArray(kitchenViewings.status, ["pending", "confirmed"])
        )
      );
    return {
      locationId,
      fixtureManagerId: manager.id,
      fixtureEmail: email,
      originalManagerId: backupRow.original_manager_id,
      alreadyGranted: true,
    };
  }

  const originalManagerId =
    backupRow?.original_manager_id ?? location.managerId ?? null;

  if (!backupRow) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(BACKUP_TABLE)}
        (location_id, original_manager_id, fixture_manager_id)
      VALUES (${locationId}, ${originalManagerId}, ${manager.id})
      ON CONFLICT (location_id) DO NOTHING
    `);
  } else {
    await db.execute(sql`
      UPDATE ${sql.raw(BACKUP_TABLE)}
      SET fixture_manager_id = ${manager.id}, granted_at = now()
      WHERE location_id = ${locationId}
    `);
  }

  await db
    .update(locations)
    .set({ managerId: manager.id, updatedAt: new Date() })
    .where(eq(locations.id, locationId));

  await db
    .update(kitchenViewings)
    .set({ managerId: manager.id, updatedAt: new Date() })
    .where(
      and(
        eq(kitchenViewings.locationId, locationId),
        inArray(kitchenViewings.status, ["pending", "confirmed"])
      )
    );

  logger.info(
    `[dev-fixture] granted location ${locationId} to manager ${email} (id=${manager.id}); original=${originalManagerId}`
  );

  return {
    locationId,
    fixtureManagerId: manager.id,
    fixtureEmail: email,
    originalManagerId,
    alreadyGranted: false,
  };
}

export async function revokeFixtureManagerLocation(opts: {
  locationId: number;
}): Promise<FixtureRevokeResult> {
  const locationId = opts.locationId;
  if (!isAllowedFixtureLocationId(locationId)) {
    throw Object.assign(new Error("Location not in fixture allowlist"), {
      status: 403,
    });
  }

  await ensureBackupTable();
  const backupRow = await getBackup(locationId);

  if (!backupRow) {
    return { locationId, restoredManagerId: null, hadBackup: false };
  }

  const restored = backupRow.original_manager_id;
  await db
    .update(locations)
    .set({ managerId: restored, updatedAt: new Date() })
    .where(eq(locations.id, locationId));

  if (restored != null) {
    await db
      .update(kitchenViewings)
      .set({ managerId: restored, updatedAt: new Date() })
      .where(
        and(
          eq(kitchenViewings.locationId, locationId),
          inArray(kitchenViewings.status, ["pending", "confirmed"]),
          eq(kitchenViewings.managerId, backupRow.fixture_manager_id)
        )
      );
  }

  await db.execute(sql`
    DELETE FROM ${sql.raw(BACKUP_TABLE)} WHERE location_id = ${locationId}
  `);

  logger.info(
    `[dev-fixture] revoked fixture ownership of location ${locationId}; restored manager=${restored}`
  );

  return { locationId, restoredManagerId: restored, hadBackup: true };
}
