/**
 * Dev-only Journey D prep: idempotent fixture identities + kitchen 11 readiness.
 * Ordering: revoke fixture grant → leave real Stripe Connect owner on location 8.
 * Clears only testsprite-jd-% tagged kitchen bookings and fixture-chef overstay blockers.
 */
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  chefKitchenApplications,
  chefLocationAccess,
  kitchenAvailability,
  kitchenBookings,
  kitchens,
  locations,
  users,
} from "@shared/schema";
import { db } from "./db";
import { issueDevAuthCustomToken } from "./dev-auth-bypass";
import {
  DEV_FIXTURE_MANAGER_EMAIL,
  isAllowedFixtureLocationId,
} from "./dev-auth-bypass-gates";
import { revokeFixtureManagerLocation } from "./dev-fixture-manager-location";
import { generateReferenceCode } from "./reference-code";
import {
  chunkBApplicationTarget,
  FULL_CHUNK_D_MARKER_PREFIX,
  isCheckinEligibleNow,
  pickBookingForChunkD,
} from "./dev-journey-full-chunk-state";

export const DEV_JOURNEY_D_LOCATION_ID = 8;
export const DEV_JOURNEY_D_KITCHEN_ID = 11;
export const DEV_JOURNEY_D_CHEF_EMAIL =
  "testsprite-journey-d-chef@localcooks.test";

const SEEDED_DOWS = [0, 1, 4, 5] as const;

export type JourneyDReadyResult = {
  ok: true;
  locationId: number;
  kitchenId: number;
  chef: { email: string; neonUserId: number };
  manager: { email: string; neonUserId: number };
  access: {
    applicationId: number;
    currentTier: number;
    status: string;
    locationAccessId: number;
  };
  readiness: {
    kitchenActive: boolean;
    pricing: {
      hourlyRate: string | null;
      currency: string;
      minimumBookingHours: number;
    };
    availabilityDays: number[];
    clearedTaggedBookings: number;
    waivedOverstays: number;
  };
  fixtureGrantRevoked: boolean;
  stripeTestMode: boolean;
  locationManager: {
    id: number;
    username: string | null;
    stripeConnectAccountId: string | null;
  } | null;
};

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function upsertTier3(chefId: number, email: string) {
  const [existing] = await db
    .select({
      id: chefKitchenApplications.id,
      current_tier: chefKitchenApplications.current_tier,
      status: chefKitchenApplications.status,
    })
    .from(chefKitchenApplications)
    .where(
      and(
        eq(chefKitchenApplications.chefId, chefId),
        eq(chefKitchenApplications.locationId, DEV_JOURNEY_D_LOCATION_ID)
      )
    )
    .limit(1);

  if (existing) {
    const nextTier = Math.max(Number(existing.current_tier) || 1, 3);
    await db
      .update(chefKitchenApplications)
      .set({
        status: "approved",
        current_tier: nextTier,
        tier2_completed_at: new Date(),
        tier3_submitted_at: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(chefKitchenApplications.id, existing.id));
    return { applicationId: existing.id, currentTier: nextTier, status: "approved" };
  }

  const [ins] = await db
    .insert(chefKitchenApplications)
    .values({
      chefId,
      locationId: DEV_JOURNEY_D_LOCATION_ID,
      fullName: "Journey D Chef",
      shopName: "TestSprite D Kitchen Shop",
      shopAddress: "1 Test St, St. John's NL",
      email,
      phone: "7095550100",
      kitchenPreference: "commercial",
      foodSafetyLicense: "yes",
      foodEstablishmentCert: "no",
      status: "approved",
      current_tier: 3,
      tier1_completed_at: new Date(),
      tier2_completed_at: new Date(),
      tier3_submitted_at: new Date(),
    })
    .returning({ id: chefKitchenApplications.id });

  return { applicationId: ins.id, currentTier: 3, status: "approved" };
}

async function ensureLocationAccess(chefId: number, grantedBy: number) {
  const [existing] = await db
    .select({ id: chefLocationAccess.id })
    .from(chefLocationAccess)
    .where(
      and(
        eq(chefLocationAccess.chefId, chefId),
        eq(chefLocationAccess.locationId, DEV_JOURNEY_D_LOCATION_ID)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [ins] = await db
    .insert(chefLocationAccess)
    .values({
      chefId,
      locationId: DEV_JOURNEY_D_LOCATION_ID,
      grantedBy,
      grantedAt: new Date(),
    })
    .returning({ id: chefLocationAccess.id });
  return ins.id;
}

async function ensureKitchenReadiness() {
  const [kitchen] = await db
    .select()
    .from(kitchens)
    .where(eq(kitchens.id, DEV_JOURNEY_D_KITCHEN_ID))
    .limit(1);

  if (!kitchen) fail(404, `Kitchen ${DEV_JOURNEY_D_KITCHEN_ID} not found`);
  if (kitchen.locationId !== DEV_JOURNEY_D_LOCATION_ID) {
    fail(
      400,
      `Kitchen ${DEV_JOURNEY_D_KITCHEN_ID} is not at location ${DEV_JOURNEY_D_LOCATION_ID}`
    );
  }

  const hourlyRate =
    kitchen.hourlyRate && Number(kitchen.hourlyRate) !== 0
      ? String(kitchen.hourlyRate)
      : "1239";
  const currency = kitchen.currency?.trim() ? kitchen.currency : "CAD";
  const minimumBookingHours = Math.max(kitchen.minimumBookingHours || 1, 1);
  const pricingModel = kitchen.pricingModel?.trim()
    ? kitchen.pricingModel
    : "hourly";

  const [updated] = await db
    .update(kitchens)
    .set({
      isActive: true,
      hourlyRate,
      currency,
      minimumBookingHours,
      pricingModel,
      updatedAt: new Date(),
    })
    .where(eq(kitchens.id, DEV_JOURNEY_D_KITCHEN_ID))
    .returning({
      isActive: kitchens.isActive,
      hourlyRate: kitchens.hourlyRate,
      currency: kitchens.currency,
      minimumBookingHours: kitchens.minimumBookingHours,
    });

  const availabilityDays: number[] = [];
  for (const dow of SEEDED_DOWS) {
    const [row] = await db
      .select({ id: kitchenAvailability.id })
      .from(kitchenAvailability)
      .where(
        and(
          eq(kitchenAvailability.kitchenId, DEV_JOURNEY_D_KITCHEN_ID),
          eq(kitchenAvailability.dayOfWeek, dow)
        )
      )
      .limit(1);
    if (row) {
      await db
        .update(kitchenAvailability)
        .set({
          startTime: "09:00",
          endTime: "17:00",
          isAvailable: true,
        })
        .where(eq(kitchenAvailability.id, row.id));
    } else {
      await db.insert(kitchenAvailability).values({
        kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
        dayOfWeek: dow,
        startTime: "09:00",
        endTime: "17:00",
        isAvailable: true,
      });
    }
    availabilityDays.push(dow);
  }

  return {
    kitchenActive: !!updated?.isActive,
    pricing: {
      hourlyRate: updated?.hourlyRate ?? null,
      currency: updated?.currency ?? "CAD",
      minimumBookingHours: updated?.minimumBookingHours ?? 1,
    },
    availabilityDays,
  };
}

/**
 * Only cancel pre-payment Journey-D leftovers. Any row with a PaymentIntent is
 * left untouched so this fixture can never orphan an authorization or charge.
 */
async function clearTaggedJourneyDBookings(chefId: number) {
  const cleared = await db
    .update(kitchenBookings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(kitchenBookings.chefId, chefId),
        eq(kitchenBookings.kitchenId, DEV_JOURNEY_D_KITCHEN_ID),
        eq(kitchenBookings.status, "pending"),
        inArray(kitchenBookings.paymentStatus, ["pending", "failed"]),
        isNull(kitchenBookings.paymentIntentId),
        like(kitchenBookings.specialNotes, "testsprite-jd-%")
      )
    )
    .returning({ id: kitchenBookings.id });
  return cleared.length;
}

/** Fixture chef unpaid overstays block checkout (shared with Journey G). */
async function clearBlockingOverstays(chefId: number) {
  const result = await db.execute(sql`
    UPDATE storage_overstay_records sor
    SET status = 'penalty_waived',
        penalty_waived = true,
        resolved_at = COALESCE(resolved_at, NOW()),
        resolution_type = COALESCE(resolution_type, 'waived'),
        waive_reason = COALESCE(
          waive_reason,
          'TestSprite Journey D booking fixture — cleared for checkout'
        ),
        updated_at = NOW()
    FROM storage_bookings sb
    WHERE sor.storage_booking_id = sb.id
      AND sb.chef_id = ${chefId}
      AND sor.status IN (
        'detected', 'grace_period', 'pending_review', 'penalty_approved',
        'charge_pending', 'charge_failed', 'escalated'
      )
    RETURNING sor.id
  `);
  const raw = result as unknown as { id: number }[] | { rows?: { id: number }[] };
  const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
  return rows.length;
}

export async function prepareJourneyDReady(): Promise<JourneyDReadyResult> {
  if (!isAllowedFixtureLocationId(DEV_JOURNEY_D_LOCATION_ID)) {
    fail(403, "Location not in fixture allowlist");
  }

  const stripeSecretIsTest = (process.env.STRIPE_SECRET_KEY || "").startsWith(
    "sk_test_"
  );
  const stripePublishableIsTest = (
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY ||
    ""
  ).startsWith("pk_test_");
  const stripeTestMode = stripeSecretIsTest && stripePublishableIsTest;
  if (!stripeTestMode) {
    fail(400, "Stripe must be in test mode for Journey D prep");
  }

  const [location] = await db
    .select({ id: locations.id, managerId: locations.managerId })
    .from(locations)
    .where(eq(locations.id, DEV_JOURNEY_D_LOCATION_ID))
    .limit(1);
  if (!location) fail(404, `Location ${DEV_JOURNEY_D_LOCATION_ID} not found`);

  await revokeFixtureManagerLocation({
    locationId: DEV_JOURNEY_D_LOCATION_ID,
  });
  const fixtureGrantRevoked = true;

  // Re-read after revoke; the pre-revoke location row may still name the fixture manager.
  const [checkoutLocation] = await db
    .select({ managerId: locations.managerId })
    .from(locations)
    .where(eq(locations.id, DEV_JOURNEY_D_LOCATION_ID))
    .limit(1);
  if (!checkoutLocation?.managerId) {
    fail(409, "Location 8 has no manager for Stripe Connect checkout");
  }

  const chef = await issueDevAuthCustomToken({
    email: DEV_JOURNEY_D_CHEF_EMAIL,
    role: "chef",
  });
  const manager = await issueDevAuthCustomToken({
    email: DEV_FIXTURE_MANAGER_EMAIL,
    role: "manager",
  });

  const app = await upsertTier3(chef.neonUserId, chef.email);
  const locationAccessId = await ensureLocationAccess(
    chef.neonUserId,
    checkoutLocation.managerId
  );
  const kitchen = await ensureKitchenReadiness();
  const clearedTaggedBookings = await clearTaggedJourneyDBookings(
    chef.neonUserId
  );
  const waivedOverstays = await clearBlockingOverstays(chef.neonUserId);

  const [owner] = checkoutLocation.managerId
    ? await db
        .select({
          id: users.id,
          username: users.username,
          stripeConnectAccountId: users.stripeConnectAccountId,
        })
        .from(users)
        .where(eq(users.id, checkoutLocation.managerId))
        .limit(1)
    : [null];

  if (!kitchen.kitchenActive) {
    fail(500, "Kitchen 11 could not be activated");
  }
  if (!owner?.stripeConnectAccountId) {
    fail(409, "Location 8 manager is not ready for Stripe Connect checkout");
  }

  return {
    ok: true,
    locationId: DEV_JOURNEY_D_LOCATION_ID,
    kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
    chef: { email: chef.email, neonUserId: chef.neonUserId },
    manager: { email: manager.email, neonUserId: manager.neonUserId },
    access: {
      applicationId: app.applicationId,
      currentTier: app.currentTier,
      status: app.status,
      locationAccessId,
    },
    readiness: {
      kitchenActive: kitchen.kitchenActive,
      pricing: kitchen.pricing,
      availabilityDays: kitchen.availabilityDays,
      clearedTaggedBookings,
      waivedOverstays,
    },
    fixtureGrantRevoked,
    stripeTestMode,
    locationManager: owner
      ? {
          id: owner.id,
          username: owner.username,
          stripeConnectAccountId: owner.stripeConnectAccountId,
        }
      : null,
  };
}

export const DEV_JOURNEY_FULL_CHEF_EMAIL =
  "testsprite-full-chef@localcooks.test";
export const DEV_JOURNEY_FULL_ADMIN_EMAIL =
  "testsprite-admin@localcooks.test";

export type JourneyFullReadyResult = {
  ok: true;
  locationId: number;
  kitchenId: number;
  chef: { email: string; neonUserId: number };
  manager: { email: string; neonUserId: number };
  admin: { email: string; neonUserId: number };
  accessReset: boolean;
  readiness: {
    kitchenActive: boolean;
    pricing: {
      hourlyRate: string | null;
      currency: string;
      minimumBookingHours: number;
    };
    availabilityDays: number[];
  };
  fixtureGrantRevoked: boolean;
  stripeTestMode: boolean;
  notes: string;
};

/**
 * Prep for apply→admin→Step2→manager→book→confirm.
 * Ensures kitchen readiness + identities; clears prior access so Tier 1→3 is exercised.
 * Does NOT grant tier-3 / location access.
 */
export async function prepareJourneyFullReady(): Promise<JourneyFullReadyResult> {
  if (!isAllowedFixtureLocationId(DEV_JOURNEY_D_LOCATION_ID)) {
    fail(403, "Location not in fixture allowlist");
  }

  const stripeSecretIsTest = (process.env.STRIPE_SECRET_KEY || "").startsWith(
    "sk_test_"
  );
  const stripePublishableIsTest = (
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY ||
    ""
  ).startsWith("pk_test_");
  const stripeTestMode = stripeSecretIsTest && stripePublishableIsTest;
  if (!stripeTestMode) {
    fail(400, "Stripe must be in test mode for Journey Full prep");
  }

  const [location] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, DEV_JOURNEY_D_LOCATION_ID))
    .limit(1);
  if (!location) fail(404, `Location ${DEV_JOURNEY_D_LOCATION_ID} not found`);

  const [chef, manager, admin, , kitchen] = await Promise.all([
    issueDevAuthCustomToken({
      email: DEV_JOURNEY_FULL_CHEF_EMAIL,
      role: "chef",
    }),
    issueDevAuthCustomToken({
      email: DEV_FIXTURE_MANAGER_EMAIL,
      role: "manager",
    }),
    issueDevAuthCustomToken({
      email: DEV_JOURNEY_FULL_ADMIN_EMAIL,
      role: "admin",
    }),
    revokeFixtureManagerLocation({
      locationId: DEV_JOURNEY_D_LOCATION_ID,
    }),
    ensureKitchenReadiness(),
  ]);

  await db
    .delete(chefLocationAccess)
    .where(
      and(
        eq(chefLocationAccess.chefId, chef.neonUserId),
        eq(chefLocationAccess.locationId, DEV_JOURNEY_D_LOCATION_ID)
      )
    );
  await db
    .delete(chefKitchenApplications)
    .where(
      and(
        eq(chefKitchenApplications.chefId, chef.neonUserId),
        eq(chefKitchenApplications.locationId, DEV_JOURNEY_D_LOCATION_ID)
      )
    );

  await Promise.all([
    db
      .update(kitchenBookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(kitchenBookings.chefId, chef.neonUserId),
          eq(kitchenBookings.kitchenId, DEV_JOURNEY_D_KITCHEN_ID),
          inArray(kitchenBookings.status, ["pending", "confirmed"]),
          like(kitchenBookings.specialNotes, "testsprite-full-%")
        )
      ),
    clearBlockingOverstays(chef.neonUserId),
  ]);

  if (!kitchen.kitchenActive) {
    fail(500, "Kitchen 11 could not be activated");
  }

  return {
    ok: true,
    locationId: DEV_JOURNEY_D_LOCATION_ID,
    kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
    chef: { email: chef.email, neonUserId: chef.neonUserId },
    manager: { email: manager.email, neonUserId: manager.neonUserId },
    admin: { email: admin.email, neonUserId: admin.neonUserId },
    accessReset: true,
    readiness: {
      kitchenActive: kitchen.kitchenActive,
      pricing: kitchen.pricing,
      availabilityDays: kitchen.availabilityDays,
    },
    fixtureGrantRevoked: true,
    stripeTestMode,
    notes:
      "Chef has no location access yet. Flow: Tier1→admin approve→Tier2→grant fixture→manager app approve tier3→revoke→Stripe book→grant→manager booking approve→chef confirmed+paid→revoke.",
  };
}

const FULL_TZ = "America/St_Johns";
const DUMMY_CERT_URL =
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

function assertStripeTestMode(label: string): boolean {
  const stripeSecretIsTest = (process.env.STRIPE_SECRET_KEY || "").startsWith(
    "sk_test_"
  );
  const stripePublishableIsTest = (
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY ||
    ""
  ).startsWith("pk_test_");
  const stripeTestMode = stripeSecretIsTest && stripePublishableIsTest;
  if (!stripeTestMode) {
    fail(400, `Stripe must be in test mode for ${label}`);
  }
  return stripeTestMode;
}

async function issueFullIdentities() {
  const [chef, manager, admin] = await Promise.all([
    issueDevAuthCustomToken({
      email: DEV_JOURNEY_FULL_CHEF_EMAIL,
      role: "chef",
    }),
    issueDevAuthCustomToken({
      email: DEV_FIXTURE_MANAGER_EMAIL,
      role: "manager",
    }),
    issueDevAuthCustomToken({
      email: DEV_JOURNEY_FULL_ADMIN_EMAIL,
      role: "admin",
    }),
  ]);
  return { chef, manager, admin };
}

async function findFullApplication(chefId: number) {
  const [row] = await db
    .select({
      id: chefKitchenApplications.id,
      status: chefKitchenApplications.status,
      current_tier: chefKitchenApplications.current_tier,
      tier1_completed_at: chefKitchenApplications.tier1_completed_at,
      tier2_completed_at: chefKitchenApplications.tier2_completed_at,
    })
    .from(chefKitchenApplications)
    .where(
      and(
        eq(chefKitchenApplications.chefId, chefId),
        eq(chefKitchenApplications.locationId, DEV_JOURNEY_D_LOCATION_ID)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Cancel only tagged pre-payment leftovers (never touch PaymentIntent rows). */
async function clearTaggedFullBookingsSafe(chefId: number) {
  const cleared = await db
    .update(kitchenBookings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(kitchenBookings.chefId, chefId),
        eq(kitchenBookings.kitchenId, DEV_JOURNEY_D_KITCHEN_ID),
        eq(kitchenBookings.status, "pending"),
        inArray(kitchenBookings.paymentStatus, ["pending", "failed"]),
        isNull(kitchenBookings.paymentIntentId),
        like(kitchenBookings.specialNotes, "testsprite-full-%")
      )
    )
    .returning({ id: kitchenBookings.id });
  return cleared.length;
}

async function upsertFullTier3(chefId: number, email: string) {
  const existing = await findFullApplication(chefId);
  if (existing) {
    const nextTier = Math.max(Number(existing.current_tier) || 1, 3);
    await db
      .update(chefKitchenApplications)
      .set({
        status: "approved",
        current_tier: nextTier,
        foodEstablishmentCert: "yes",
        foodEstablishmentCertUrl: DUMMY_CERT_URL,
        foodEstablishmentCertExpiry: "2030-12-31",
        tier1_completed_at: existing.tier1_completed_at ?? new Date(),
        tier2_completed_at: existing.tier2_completed_at ?? new Date(),
        tier3_submitted_at: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(chefKitchenApplications.id, existing.id));
    return { applicationId: existing.id, currentTier: nextTier, status: "approved" as const };
  }

  const [ins] = await db
    .insert(chefKitchenApplications)
    .values({
      chefId,
      locationId: DEV_JOURNEY_D_LOCATION_ID,
      fullName: "Test FullChef",
      shopName: "TestSprite Full Kitchen Shop",
      shopAddress: "1 Test St, St. John's NL",
      email,
      phone: "7095550100",
      kitchenPreference: "commercial",
      foodSafetyLicense: "yes",
      foodEstablishmentCert: "yes",
      foodEstablishmentCertUrl: DUMMY_CERT_URL,
      foodEstablishmentCertExpiry: "2030-12-31",
      status: "approved",
      current_tier: 3,
      tier1_completed_at: new Date(),
      tier2_completed_at: new Date(),
      tier3_submitted_at: new Date(),
    })
    .returning({ id: chefKitchenApplications.id });

  return { applicationId: ins.id, currentTier: 3, status: "approved" as const };
}

function zonedYmdHm(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`.replace(/^24:/, "00:"),
  };
}

function addMinutesHhmm(hhmm: string, delta: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (((h * 60 + m + delta) % (24 * 60)) + 24 * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

/**
 * Chunk A: reset identities + clear access (alias of journey-full-ready).
 * Leaves chef with no application at location 8.
 */
export async function prepareJourneyFullChunkAReady(): Promise<
  JourneyFullReadyResult & { chunk: "A" }
> {
  const result = await prepareJourneyFullReady();
  return { ...result, chunk: "A" };
}

export type JourneyFullChunkBReadyResult = {
  ok: true;
  chunk: "B";
  locationId: number;
  kitchenId: number;
  applicationId: number;
  currentTier: number;
  status: string;
  step2Unlocked: true;
  step2AlreadyDone: boolean;
  chef: { email: string; neonUserId: number };
  admin: { email: string; neonUserId: number };
  manager: { email: string; neonUserId: number };
  notes: string;
};

/**
 * Chunk B prep (backend): admin Step 1 accept so chef Step 2 UI is unlocked.
 * Idempotent: seeds approved tier-1 app if A was skipped.
 */
export async function prepareJourneyFullChunkBReady(): Promise<JourneyFullChunkBReadyResult> {
  if (!isAllowedFixtureLocationId(DEV_JOURNEY_D_LOCATION_ID)) {
    fail(403, "Location not in fixture allowlist");
  }

  const { chef, manager, admin } = await issueFullIdentities();
  const existing = await findFullApplication(chef.neonUserId);
  const target = chunkBApplicationTarget(existing);

  let applicationId: number;
  let currentTier: number;
  let status: string;

  if (!existing) {
    const [ins] = await db
      .insert(chefKitchenApplications)
      .values({
        chefId: chef.neonUserId,
        locationId: DEV_JOURNEY_D_LOCATION_ID,
        fullName: "Test FullChef",
        shopName: "TestSprite Full Kitchen Shop",
        shopAddress: "1 Test St, St. John's NL",
        email: chef.email,
        phone: "7095550100",
        kitchenPreference: "commercial",
        foodSafetyLicense: "yes",
        foodEstablishmentCert: "no",
        status: "approved",
        current_tier: 1,
        tier1_completed_at: new Date(),
      })
      .returning({ id: chefKitchenApplications.id });
    applicationId = ins.id;
    currentTier = 1;
    status = "approved";
  } else if (target.needsAdminApprove) {
    await db
      .update(chefKitchenApplications)
      .set({
        status: "approved",
        current_tier: 1,
        tier1_completed_at: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(chefKitchenApplications.id, existing.id));
    applicationId = existing.id;
    currentTier = 1;
    status = "approved";
  } else {
    applicationId = existing.id;
    currentTier = Number(existing.current_tier) || 1;
    status = existing.status;
  }

  return {
    ok: true,
    chunk: "B",
    locationId: DEV_JOURNEY_D_LOCATION_ID,
    kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
    applicationId,
    currentTier,
    status,
    step2Unlocked: true,
    step2AlreadyDone: target.step2AlreadyDone,
    chef: { email: chef.email, neonUserId: chef.neonUserId },
    admin: { email: admin.email, neonUserId: admin.neonUserId },
    manager: { email: manager.email, neonUserId: manager.neonUserId },
    notes: target.step2AlreadyDone
      ? "Step 2 already submitted; UI may assert existing tier≥2."
      : "Admin Step 1 done. Chef may submit kitchen docs Step 2.",
  };
}

export type JourneyFullChunkCReadyResult = {
  ok: true;
  chunk: "C";
  locationId: number;
  kitchenId: number;
  applicationId: number;
  currentTier: number;
  status: string;
  locationAccessId: number;
  chef: { email: string; neonUserId: number };
  manager: { email: string; neonUserId: number };
  admin: { email: string; neonUserId: number };
  readiness: JourneyDReadyResult["readiness"];
  fixtureGrantRevoked: boolean;
  stripeTestMode: boolean;
  notes: string;
};

/**
 * Chunk C prep (backend): manager tier-3 / Ready to book + kitchen ready + fixture revoke.
 * Does not create a booking — UI books via Stripe.
 */
export async function prepareJourneyFullChunkCReady(): Promise<JourneyFullChunkCReadyResult> {
  if (!isAllowedFixtureLocationId(DEV_JOURNEY_D_LOCATION_ID)) {
    fail(403, "Location not in fixture allowlist");
  }
  const stripeTestMode = assertStripeTestMode("Journey Full chunk C");

  const [location] = await db
    .select({ id: locations.id, managerId: locations.managerId })
    .from(locations)
    .where(eq(locations.id, DEV_JOURNEY_D_LOCATION_ID))
    .limit(1);
  if (!location) fail(404, `Location ${DEV_JOURNEY_D_LOCATION_ID} not found`);

  await revokeFixtureManagerLocation({
    locationId: DEV_JOURNEY_D_LOCATION_ID,
  });

  const [checkoutLocation] = await db
    .select({ managerId: locations.managerId })
    .from(locations)
    .where(eq(locations.id, DEV_JOURNEY_D_LOCATION_ID))
    .limit(1);
  if (!checkoutLocation?.managerId) {
    fail(409, "Location 8 has no manager for Stripe Connect checkout");
  }

  const { chef, manager, admin } = await issueFullIdentities();
  const app = await upsertFullTier3(chef.neonUserId, chef.email);
  const locationAccessId = await ensureLocationAccess(
    chef.neonUserId,
    checkoutLocation.managerId
  );
  const kitchen = await ensureKitchenReadiness();
  const clearedTaggedBookings = await clearTaggedFullBookingsSafe(chef.neonUserId);
  const waivedOverstays = await clearBlockingOverstays(chef.neonUserId);

  const [owner] = await db
    .select({
      stripeConnectAccountId: users.stripeConnectAccountId,
    })
    .from(users)
    .where(eq(users.id, checkoutLocation.managerId))
    .limit(1);

  if (!kitchen.kitchenActive) fail(500, "Kitchen 11 could not be activated");
  if (!owner?.stripeConnectAccountId) {
    fail(409, "Location 8 manager is not ready for Stripe Connect checkout");
  }

  return {
    ok: true,
    chunk: "C",
    locationId: DEV_JOURNEY_D_LOCATION_ID,
    kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
    applicationId: app.applicationId,
    currentTier: app.currentTier,
    status: app.status,
    locationAccessId,
    chef: { email: chef.email, neonUserId: chef.neonUserId },
    manager: { email: manager.email, neonUserId: manager.neonUserId },
    admin: { email: admin.email, neonUserId: admin.neonUserId },
    readiness: {
      kitchenActive: kitchen.kitchenActive,
      pricing: kitchen.pricing,
      availabilityDays: kitchen.availabilityDays,
      clearedTaggedBookings,
      waivedOverstays,
    },
    fixtureGrantRevoked: true,
    stripeTestMode,
    notes:
      "Tier≥3 bookable. Fixture grant revoked for Stripe Connect. UI: book kitchen 11 with testsprite-full marker → pending+authorized.",
  };
}

export type JourneyFullChunkDReadyResult = {
  ok: true;
  chunk: "D";
  locationId: number;
  kitchenId: number;
  applicationId: number;
  bookingId: number;
  referenceCode: string | null;
  marker: string;
  bookingStatus: string;
  paymentStatus: string;
  bookingAction: "advance" | "reuse" | "seed";
  checkin: {
    eligibleNow: boolean;
    bookingDate: string;
    startTime: string;
    endTime: string;
    windowMinutesBefore: number;
    timezone: string;
  };
  chef: { email: string; neonUserId: number };
  manager: { email: string; neonUserId: number };
  stripeTestMode: boolean;
  notes: string;
};

/**
 * Chunk D prep: ensure confirmed+paid testsprite-full booking for continuity.
 * Advances pending+authorized from chunk C when present; else seeds deterministic booking
 * with check-in window open now (America/St_Johns).
 */
export async function prepareJourneyFullChunkDReady(): Promise<JourneyFullChunkDReadyResult> {
  if (!isAllowedFixtureLocationId(DEV_JOURNEY_D_LOCATION_ID)) {
    fail(403, "Location not in fixture allowlist");
  }
  const stripeTestMode = assertStripeTestMode("Journey Full chunk D");

  const [location] = await db
    .select({ managerId: locations.managerId })
    .from(locations)
    .where(eq(locations.id, DEV_JOURNEY_D_LOCATION_ID))
    .limit(1);
  if (!location?.managerId) {
    fail(409, "Location 8 has no manager");
  }

  await revokeFixtureManagerLocation({
    locationId: DEV_JOURNEY_D_LOCATION_ID,
  });

  const { chef, manager } = await issueFullIdentities();
  const app = await upsertFullTier3(chef.neonUserId, chef.email);
  await ensureLocationAccess(chef.neonUserId, location.managerId);
  await ensureKitchenReadiness();

  const existingBookings = await db
    .select({
      id: kitchenBookings.id,
      status: kitchenBookings.status,
      paymentStatus: kitchenBookings.paymentStatus,
      specialNotes: kitchenBookings.specialNotes,
      referenceCode: kitchenBookings.referenceCode,
      bookingDate: kitchenBookings.bookingDate,
      startTime: kitchenBookings.startTime,
      endTime: kitchenBookings.endTime,
    })
    .from(kitchenBookings)
    .where(
      and(
        eq(kitchenBookings.chefId, chef.neonUserId),
        eq(kitchenBookings.kitchenId, DEV_JOURNEY_D_KITCHEN_ID),
        like(kitchenBookings.specialNotes, "testsprite-full-%")
      )
    );

  const pick = pickBookingForChunkD(
    existingBookings.map((b) => ({
      id: b.id,
      status: b.status,
      paymentStatus: b.paymentStatus,
      specialNotes: b.specialNotes,
      referenceCode: b.referenceCode,
    }))
  );

  const windowMinutesBefore = 15;
  let bookingId: number;
  let referenceCode: string | null;
  let marker: string;
  let bookingStatus: string;
  let paymentStatus: string;
  let bookingDateYmd: string;
  let startTime: string;
  let endTime: string;

  if (pick.action === "advance" && pick.booking) {
    const [updated] = await db
      .update(kitchenBookings)
      .set({
        status: "confirmed",
        paymentStatus: "paid",
        updatedAt: new Date(),
      })
      .where(eq(kitchenBookings.id, pick.booking.id))
      .returning({
        id: kitchenBookings.id,
        referenceCode: kitchenBookings.referenceCode,
        specialNotes: kitchenBookings.specialNotes,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        endTime: kitchenBookings.endTime,
      });
    bookingId = updated.id;
    referenceCode = updated.referenceCode;
    marker = updated.specialNotes || pick.booking.specialNotes || "";
    bookingStatus = "confirmed";
    paymentStatus = "paid";
    bookingDateYmd = updated.bookingDate.toISOString().slice(0, 10);
    startTime = updated.startTime;
    endTime = updated.endTime;
  } else if (pick.action === "reuse" && pick.booking) {
    const row = existingBookings.find((b) => b.id === pick.booking!.id)!;
    bookingId = row.id;
    referenceCode = row.referenceCode;
    marker = row.specialNotes || "";
    bookingStatus = "confirmed";
    paymentStatus = "paid";
    bookingDateYmd = row.bookingDate.toISOString().slice(0, 10);
    startTime = row.startTime;
    endTime = row.endTime;
  } else {
    const now = new Date();
    const { ymd, hhmm } = zonedYmdHm(now, FULL_TZ);
    startTime = addMinutesHhmm(hhmm, -5);
    endTime = addMinutesHhmm(hhmm, 120);
    bookingDateYmd = ymd;
    marker = `${FULL_CHUNK_D_MARKER_PREFIX}${Date.now()}`;
    const ref = await generateReferenceCode("kitchen_booking");
    const [ins] = await db
      .insert(kitchenBookings)
      .values({
        referenceCode: ref,
        chefId: chef.neonUserId,
        kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
        bookingDate: new Date(`${ymd}T12:00:00.000Z`),
        startTime,
        endTime,
        selectedSlots: [{ startTime, endTime }],
        status: "confirmed",
        paymentStatus: "paid",
        specialNotes: marker,
        bookingType: "chef",
        totalPrice: "1239",
        hourlyRate: "1239",
        durationHours: "2",
        currency: "CAD",
        checkinStatus: "not_checked_in",
      })
      .returning({
        id: kitchenBookings.id,
        referenceCode: kitchenBookings.referenceCode,
      });
    bookingId = ins.id;
    referenceCode = ins.referenceCode;
    bookingStatus = "confirmed";
    paymentStatus = "paid";
  }

  // Approximate eligibility using UTC wall clock of stored times (same as client date+time in TZ).
  const startMs = Date.parse(`${bookingDateYmd}T${startTime}:00`);
  const endMs = Date.parse(`${bookingDateYmd}T${endTime}:00`);
  const eligibleNow = isCheckinEligibleNow({
    nowMs: Date.now(),
    startMs: Number.isFinite(startMs) ? startMs : Date.now() - 60_000,
    endMs: Number.isFinite(endMs) ? endMs : Date.now() + 3_600_000,
    windowMinutesBefore,
  });

  return {
    ok: true,
    chunk: "D",
    locationId: DEV_JOURNEY_D_LOCATION_ID,
    kitchenId: DEV_JOURNEY_D_KITCHEN_ID,
    applicationId: app.applicationId,
    bookingId,
    referenceCode,
    marker,
    bookingStatus,
    paymentStatus,
    bookingAction: pick.action,
    checkin: {
      eligibleNow,
      bookingDate: bookingDateYmd,
      startTime,
      endTime,
      windowMinutesBefore,
      timezone: FULL_TZ,
    },
    chef: { email: chef.email, neonUserId: chef.neonUserId },
    manager: { email: manager.email, neonUserId: manager.neonUserId },
    stripeTestMode,
    notes:
      pick.action === "seed"
        ? "Seeded confirmed+paid booking with check-in window open (fixture; no Stripe PI)."
        : pick.action === "advance"
          ? "Advanced pending+authorized → confirmed+paid (manager approve simulation)."
          : "Reused existing confirmed+paid testsprite-full booking.",
  };
}

