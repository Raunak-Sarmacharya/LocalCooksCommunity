import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchens, locations,
  kitchenVisitArrivalChallenges as challengeTable } from '@shared/schema';
import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import { isCurrentVisit } from '@shared/dated-visits';
import { logger } from '../logger';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { VISIT_CODE_LENGTH, VISIT_CODE_MAX_ATTEMPTS, isVisitCodeFormat, visitCodeTargetKey,
  type ChefVisitCodeState, type ManagerVisitCodeState, type VisitCodeErrorCode, type VisitCodeMethod,
  type VisitCodeMode, type VisitCodeTargetKey } from '@shared/visit-code';

/*
 * Arrival challenge per arrival target (split-visit row, else the booking).
 *
 * The code is never stored. It is HMAC-SHA256(secret[key_version], `${targetKey}|${revision}|${nonce}`)
 * reduced to 6 digits by rejection sampling over the 32-bit chunks of the digest (no modulo bias).
 * Lock order in every writer: booking row -> visit row -> challenge row.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Challenge = typeof challengeTable.$inferSelect;
export type ArrivalInput = {
  bookingId: number; visitId?: number | null; chefId: number;
  visitCode?: unknown; requestKey?: unknown; evidence?: unknown;
};
export type ArrivalGate =
  | { kind: 'legacy' }
  | { kind: 'replay' }
  | { kind: 'ok'; challenge: Challenge; method: 'code' | 'self' };

const MESSAGES: Record<VisitCodeErrorCode, string> = {
  VISIT_CODE_REQUIRED: `Enter the ${VISIT_CODE_LENGTH}-digit check-in code the kitchen gave you to confirm arrival.`,
  VISIT_CODE_WRONG: 'That check-in code is not correct.',
  VISIT_CODE_LOCKED: 'Too many incorrect check-in codes. Ask the kitchen for a new check-in code.',
  VISIT_CODE_ALREADY_RECORDED: 'Arrival is already recorded for this visit.',
  VISIT_CODE_REVOKED: 'This check-in code is no longer valid. Contact the kitchen.',
};

export class VisitCodeError extends Error {
  constructor(public code: VisitCodeErrorCode, public attemptsLeft?: number) {
    super(code === 'VISIT_CODE_WRONG' && attemptsLeft !== undefined
      ? `That check-in code is not correct. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : MESSAGES[code]);
    this.name = 'VisitCodeError';
  }
}
/** Thrown inside an arrival transaction when the same chef/request already won; the writer returns the original success. */
export class VisitCodeReplay extends Error {
  constructor() { super('Arrival already recorded for this request'); this.name = 'VisitCodeReplay'; }
}
export class VisitCodeManagerError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'VisitCodeManagerError'; }
}

// ---------------------------------------------------------------------------------------------
// Keys and derivation (secrets are read lazily and never logged)
// ---------------------------------------------------------------------------------------------

export function currentKeyVersion(): number {
  const raw = process.env.VISIT_CODE_HMAC_KEY_VERSION;
  if (raw === undefined || raw === '') return 1;
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('VISIT_CODE_HMAC_KEY_VERSION must be a positive integer');
  return version;
}
function secretFor(version: number): string {
  const name = version === currentKeyVersion() ? 'VISIT_CODE_HMAC_SECRET' : `VISIT_CODE_HMAC_SECRET_V${version}`;
  const secret = process.env[name];
  if (!secret) throw new Error(`${name} is not configured`);
  if (Buffer.byteLength(secret) < 32) throw new Error(`${name} must be at least 32 bytes`);
  return secret;
}
/** True when the current signing key is usable; callers decide how to degrade. */
export function visitCodeKeyConfigured(): boolean {
  try { secretFor(currentKeyVersion()); return true; } catch { return false; }
}

const LIMIT = Math.floor(2 ** 32 / 10 ** VISIT_CODE_LENGTH) * 10 ** VISIT_CODE_LENGTH;
export function deriveVisitCode(params: { targetKey: string; revision: number; nonce: string; keyVersion: number }): string {
  const mac = createHmac('sha256', secretFor(params.keyVersion))
    .update(`${params.targetKey}|${params.revision}|${params.nonce}`).digest();
  // Unbiased: skip 32-bit chunks at or above the largest multiple of 1e6. Eight chunks make exhaustion negligible.
  for (let offset = 0; offset < mac.length; offset += 4) {
    const chunk = mac.readUInt32BE(offset);
    if (chunk < LIMIT) return String(chunk % 10 ** VISIT_CODE_LENGTH).padStart(VISIT_CODE_LENGTH, '0');
  }
  return String(mac.readUInt32BE(0) % 10 ** VISIT_CODE_LENGTH).padStart(VISIT_CODE_LENGTH, '0');
}
export function deriveForChallenge(row: Pick<Challenge, 'targetKey' | 'revision' | 'nonce' | 'keyVersion'>): string {
  return deriveVisitCode(row);
}
export function verifyVisitCode(row: Pick<Challenge, 'targetKey' | 'revision' | 'nonce' | 'keyVersion'>, submitted: string): boolean {
  const expected = Buffer.from(deriveVisitCode(row));
  const actual = Buffer.from(submitted);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const newNonce = () => randomBytes(16).toString('hex');

/** Idempotency key supplied by the client, else a stable digest of who/what is arriving. */
export function resolveRequestKey(input: Pick<ArrivalInput, 'requestKey' | 'chefId' | 'evidence'>, targetKey: string): string {
  if (typeof input.requestKey === 'string' && input.requestKey.trim()) return `client:${input.requestKey.trim().slice(0, 128)}`;
  const digest = createHash('sha256').update(JSON.stringify([targetKey, input.chefId, input.evidence ?? null])).digest('hex');
  return `derived:${digest.slice(0, 32)}`;
}

// ---------------------------------------------------------------------------------------------
// Row access. Reads are raw SQL so they can lock (FOR UPDATE) and tolerate the table being absent.
// ---------------------------------------------------------------------------------------------

const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function mapRow(raw: Record<string, unknown>): Challenge {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [camel(key), value])) as unknown as Challenge;
}
const rowsOf = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result) ? result : ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []);
const pgCode = (error: unknown): string | undefined =>
  (error as { cause?: { code?: string }; code?: string } | null)?.cause?.code ?? (error as { code?: string } | null)?.code;
const tableMissing = (error: unknown) => pgCode(error) === '42P01';

async function readByTarget(exec: Tx, targetKey: string, lock: boolean): Promise<Challenge | undefined> {
  const result = await exec.execute(lock
    ? sql`SELECT * FROM kitchen_visit_arrival_challenges WHERE target_key = ${targetKey} FOR UPDATE`
    : sql`SELECT * FROM kitchen_visit_arrival_challenges WHERE target_key = ${targetKey}`);
  const [row] = rowsOf(result);
  return row ? mapRow(row) : undefined;
}
async function lockForBooking(exec: Tx, bookingId: number): Promise<Challenge[]> {
  const result = await exec.execute(
    sql`SELECT * FROM kitchen_visit_arrival_challenges WHERE booking_id = ${bookingId} ORDER BY visit_id NULLS FIRST, id FOR UPDATE`);
  return activeChallenges(exec, bookingId, rowsOf(result).map(mapRow));
}
/** Plain read (no lock, no raw SQL): safe for GET handlers. */
async function activeChallenges(exec: Tx, bookingId: number, rows: Challenge[]) {
  const [booking] = await exec.select({ scheduleRevision: kitchenBookings.scheduleRevision }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!booking?.scheduleRevision) return rows;
  const visits = await exec.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
  return rows.filter(row => visits.some(visit => visit.id === row.visitId && isCurrentVisit(booking, visit)));
}
async function readForBooking(exec: Tx, bookingId: number): Promise<Challenge[]> {
  return activeChallenges(exec, bookingId, await exec.select().from(challengeTable).where(eq(challengeTable.bookingId, bookingId)).orderBy(asc(challengeTable.id)));
}
/** Runs inside a savepoint when possible so a missing table cannot abort the caller's transaction. */
async function tolerant<T>(exec: Tx, fallback: T, run: (inner: Tx) => Promise<T>): Promise<T> {
  try {
    const maybe = exec as unknown as { transaction?: (fn: (inner: Tx) => Promise<T>) => Promise<T> };
    return typeof maybe.transaction === 'function' ? await maybe.transaction(run) : await run(exec);
  } catch (error) {
    if (tableMissing(error)) return fallback;
    throw error;
  }
}

/** The canonical arrival target: the visit row when one is given, else the booking itself. */
export function resolveArrivalTarget(target: { bookingId: number; visitId?: number | null }) {
  return { bookingId: target.bookingId, visitId: target.visitId ?? null, targetKey: visitCodeTargetKey(target) };
}

// ---------------------------------------------------------------------------------------------
// Enrollment and revocation
// ---------------------------------------------------------------------------------------------

type InheritedArrivalMode = Pick<Challenge, 'mode' | 'modeChangedByUserId' | 'modeChangedAt' | 'modeReason'>;

/** Before replacing the schedule, preserve the kitchen's most recent mode decision across its current days. */
export async function arrivalModeForChangedBooking(tx: Tx, bookingId: number): Promise<InheritedArrivalMode | undefined> {
  const rows = (await readForBooking(tx, bookingId)).filter(row => !row.revokedAt && !row.consumedAt);
  rows.sort((a, b) => new Date(b.modeChangedAt || 0).getTime() - new Date(a.modeChangedAt || 0).getTime() || b.id - a.id);
  const latest = rows[0];
  return latest ? { mode: latest.mode, modeChangedByUserId: latest.modeChangedByUserId,
    modeChangedAt: latest.modeChangedAt, modeReason: latest.modeReason } : undefined;
}

/**
 * Called inside the confirmation transaction (booking row already locked). Creates one revision-1
 * challenge per arrival target, carrying the kitchen mode when replacing a schedule. Idempotent. If the signing key is not configured it logs and leaves the
 * booking on today's tap-to-arrive behaviour rather than failing a payment reconciliation.
 */
export async function ensureChallengesForBooking(tx: Tx, bookingId: number, actorUserId?: number | null, inheritedMode?: InheritedArrivalMode): Promise<number> {
  if (!visitCodeKeyConfigured()) {
    logger.error('[VisitCode] Signing key is not configured; booking keeps tap-to-arrive behaviour', { bookingId });
    return 0;
  }
  const keyVersion = currentKeyVersion();
  return tolerant(tx, 0, async inner => {
    const visits = await ensureKitchenBookingVisits(bookingId, inner) || [];
    const [booking] = await inner.select({ scheduleRevision: kitchenBookings.scheduleRevision }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (booking?.scheduleRevision && !visits.length) return 0;
    const targets = visits.length ? visits.map(visit => ({ bookingId, visitId: visit.id as number | null })) : [{ bookingId, visitId: null as number | null }];
    const created = await inner.insert(challengeTable).values(targets.map(target => ({
      bookingId, visitId: target.visitId, targetKey: visitCodeTargetKey(target), mode: 'staffed' as const, revision: 1,
      keyVersion, nonce: newNonce(), issuedByUserId: actorUserId ?? null, ...inheritedMode,
    }))).onConflictDoNothing({ target: challengeTable.targetKey }).returning({ id: challengeTable.id });
    return created.length;
  });
}

/** Called inside a cancellation transaction. Consumed challenges keep their historical method. */
export async function revokeForBooking(tx: Tx, bookingId: number, reason: string): Promise<number> {
  return tolerant(tx, 0, async inner => {
    const revoked = await inner.update(challengeTable).set({ revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() })
      .where(and(eq(challengeTable.bookingId, bookingId), isNull(challengeTable.revokedAt), isNull(challengeTable.consumedAt)))
      .returning({ id: challengeTable.id });
    return revoked.length;
  });
}

/** A dropped/moved day revokes only that target; other dates keep their own codes. */
export async function revokeForVisit(tx: Tx, bookingId: number, visitId: number, reason: string) {
  return tolerant(tx, 0, async inner => {
    const rows = await inner.update(challengeTable).set({ revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() })
      .where(and(eq(challengeTable.bookingId, bookingId), eq(challengeTable.visitId, visitId), isNull(challengeTable.revokedAt), isNull(challengeTable.consumedAt))).returning({ id: challengeTable.id });
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------
// Arrival gate
// ---------------------------------------------------------------------------------------------

const attemptsLeftOf = (row: Pick<Challenge, 'failedAttempts'>) => Math.max(0, VISIT_CODE_MAX_ATTEMPTS - row.failedAttempts);

/** Pure decision. `ok` without counting; the caller decides whether a mismatch is recorded. */
function decide(row: Challenge | undefined, input: ArrivalInput): ArrivalGate | { kind: 'wrong' } {
  if (!row) return { kind: 'legacy' };
  if (row.consumedAt) {
    const key = resolveRequestKey(input, row.targetKey);
    if (row.consumedByUserId === input.chefId && row.consumedRequestKey === key) return { kind: 'replay' };
    throw new VisitCodeError('VISIT_CODE_ALREADY_RECORDED');
  }
  if (row.revokedAt) throw new VisitCodeError('VISIT_CODE_REVOKED');
  if (row.mode === 'self') return { kind: 'ok', challenge: row, method: 'self' };
  if (row.lockedAt || row.failedAttempts >= VISIT_CODE_MAX_ATTEMPTS) throw new VisitCodeError('VISIT_CODE_LOCKED');
  const submitted = typeof input.visitCode === 'string' ? input.visitCode.trim() : input.visitCode;
  if (!isVisitCodeFormat(submitted)) throw new VisitCodeError('VISIT_CODE_REQUIRED');
  return verifyVisitCode(row, submitted) ? { kind: 'ok', challenge: row, method: 'code' } : { kind: 'wrong' };
}

/** Read-only lookup used before the usual "already checked in" checks. Never counts or locks. */
export async function arrivalAlreadyRecordedForRequest(input: ArrivalInput): Promise<boolean> {
  const { targetKey } = resolveArrivalTarget(input);
  try {
    const row = await readByTarget(db as unknown as Tx, targetKey, false);
    return !!row?.consumedAt && row.consumedByUserId === input.chefId && row.consumedRequestKey === resolveRequestKey(input, targetKey);
  } catch (error) {
    if (tableMissing(error)) return false;
    throw error;
  }
}

/**
 * Failed-attempt counter. Atomic increment of the exact revision; locks at the limit. Callers run it on a
 * connection whose commit is independent of the arrival transaction (see verifyArrivalCode).
 */
export async function recordFailedAttempt(exec: Tx, challenge: Pick<Challenge, 'id' | 'revision'>): Promise<number> {
  const [row] = await exec.update(challengeTable).set({
    failedAttempts: sql`${challengeTable.failedAttempts} + 1`,
    lockedAt: sql`CASE WHEN ${challengeTable.failedAttempts} + 1 >= ${VISIT_CODE_MAX_ATTEMPTS} THEN now() ELSE ${challengeTable.lockedAt} END`,
    updatedAt: new Date(),
  }).where(and(eq(challengeTable.id, challenge.id), eq(challengeTable.revision, challenge.revision),
    isNull(challengeTable.consumedAt), isNull(challengeTable.revokedAt), isNull(challengeTable.lockedAt)))
    .returning({ failedAttempts: challengeTable.failedAttempts });
  return row ? attemptsLeftOf(row) : 0;
}

/**
 * Step 1 of arrival: runs in its OWN short transaction BEFORE the arrival transaction. A wrong code is counted
 * and committed here, then rejected, so the rejected arrival cannot roll the counter back. Holds only the
 * challenge row lock, so it cannot deadlock with the booking -> visit -> challenge writers.
 */
export async function verifyArrivalCode(input: ArrivalInput): Promise<ArrivalGate> {
  const { targetKey } = resolveArrivalTarget(input);
  let outcome: ArrivalGate | { kind: 'rejected'; error: VisitCodeError };
  try {
    outcome = await db.transaction(async tx => {
      const row = await readByTarget(tx, targetKey, true);
      try {
        const decision = decide(row, input);
        if (decision.kind !== 'wrong') return decision;
        const left = await recordFailedAttempt(tx, row!);
        return { kind: 'rejected' as const, error: new VisitCodeError(left > 0 ? 'VISIT_CODE_WRONG' : 'VISIT_CODE_LOCKED', left) };
      } catch (error) {
        if (error instanceof VisitCodeError) return { kind: 'rejected' as const, error };
        throw error;
      }
    });
  } catch (error) {
    if (tableMissing(error)) return { kind: 'legacy' };
    throw error;
  }
  if (outcome.kind === 'rejected') throw outcome.error;
  return outcome;
}

/** Step 2: inside the arrival transaction after booking (and visit) locks. Re-checks; never counts. */
export async function gateArrivalInTx(tx: Tx, input: ArrivalInput): Promise<ArrivalGate> {
  const [booking] = await tx.select({ scheduleRevision: kitchenBookings.scheduleRevision, chefId: kitchenBookings.chefId }).from(kitchenBookings).where(eq(kitchenBookings.id, input.bookingId)).limit(1);
  if (booking?.scheduleRevision) {
    const [visit] = input.visitId ? await tx.select().from(kitchenBookingVisits).where(and(eq(kitchenBookingVisits.id, input.visitId), eq(kitchenBookingVisits.bookingId, input.bookingId))).limit(1) : [];
    if (!visit || !isCurrentVisit(booking, visit) || booking.chefId !== input.chefId) throw new VisitCodeError('VISIT_CODE_REVOKED');
  }
  const { targetKey } = resolveArrivalTarget(input);
  const row = await tolerant<Challenge | undefined>(tx, undefined, inner => readByTarget(inner, targetKey, true));
  const decision = decide(row, input);
  if (decision.kind === 'wrong') throw new VisitCodeError('VISIT_CODE_WRONG', attemptsLeftOf(row!));
  if (decision.kind === 'replay') throw new VisitCodeReplay();
  return decision;
}

/** Step 3: after the arrival write, same transaction. Pairs with exactly one outbox event from the writer. */
export async function consumeChallenge(tx: Tx, gate: ArrivalGate, input: { userId: number; requestKey: string; method?: VisitCodeMethod }) {
  if (gate.kind !== 'ok') return;
  const [consumed] = await tx.update(challengeTable).set({
    consumedAt: new Date(), consumedMethod: input.method ?? gate.method, consumedByUserId: input.userId,
    consumedRequestKey: input.requestKey, updatedAt: new Date(),
  }).where(and(eq(challengeTable.id, gate.challenge.id), eq(challengeTable.revision, gate.challenge.revision),
    isNull(challengeTable.consumedAt), isNull(challengeTable.revokedAt))).returning({ id: challengeTable.id });
  if (!consumed) throw new VisitCodeError('VISIT_CODE_ALREADY_RECORDED');
}

/** Convenience for the two chef writers: gate, then (after their arrival write) consume. */
export async function consumeForArrival(tx: Tx, gate: ArrivalGate, input: ArrivalInput) {
  await consumeChallenge(tx, gate, { userId: input.chefId, requestKey: resolveRequestKey(input, resolveArrivalTarget(input).targetKey) });
}

/** Manager-assisted arrival needs no code and consumes any open challenge with method `assisted`. */
export async function consumeForAssistedArrival(tx: Tx, target: { bookingId: number; visitId?: number | null }, managerId: number) {
  const { targetKey } = resolveArrivalTarget(target);
  await tolerant(tx, undefined, async inner => {
    const row = await readByTarget(inner, targetKey, true);
    if (!row || row.consumedAt) return;
    await consumeChallenge(inner, { kind: 'ok', challenge: row, method: 'self' },
      { userId: managerId, requestKey: `assisted:${managerId}:${Date.now()}`, method: 'assisted' });
  });
}

// ---------------------------------------------------------------------------------------------
// Projections (the only places a code can leave this module)
// ---------------------------------------------------------------------------------------------

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

export function chefProjection(row: Challenge): ChefVisitCodeState {
  const locked = !!row.lockedAt || row.failedAttempts >= VISIT_CODE_MAX_ATTEMPTS;
  return {
    targetKey: row.targetKey as VisitCodeTargetKey, visitId: row.visitId ?? null, mode: row.mode,
    codeRequired: row.mode === 'staffed' && !row.consumedAt && !row.revokedAt,
    locked: locked && !row.consumedAt, attemptsLeft: attemptsLeftOf(row),
    consumed: !!row.consumedAt, consumedMethod: row.consumedMethod ?? null, consumedAt: iso(row.consumedAt), revoked: !!row.revokedAt,
  };
}

export function arrivalModeFor(states: Pick<ChefVisitCodeState, 'mode'>[]): 'staffed' | 'self' | 'mixed' | 'legacy' {
  if (!states.length) return 'legacy';
  return states.every(state => state.mode === states[0].mode) ? states[0].mode : 'mixed';
}

export function managerProjection(row: Challenge): ManagerVisitCodeState {
  const open = !row.consumedAt && !row.revokedAt && row.mode === 'staffed';
  let code: string | null = null;
  let codeUnavailable = false;
  if (open) {
    try { code = deriveForChallenge(row); } catch (error) {
      codeUnavailable = true;
      logger.error('[VisitCode] Could not derive code for the owning manager', { reason: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return {
    targetKey: row.targetKey as VisitCodeTargetKey, visitId: row.visitId ?? null, mode: row.mode, revision: row.revision, code, codeUnavailable,
    locked: (!!row.lockedAt || row.failedAttempts >= VISIT_CODE_MAX_ATTEMPTS) && !row.consumedAt,
    failedAttempts: row.failedAttempts, attemptsLeft: attemptsLeftOf(row), issuedAt: iso(row.issuedAt)!,
    modeChangedAt: iso(row.modeChangedAt), modeReason: row.modeReason ?? null,
    consumed: !!row.consumedAt, consumedMethod: row.consumedMethod ?? null, consumedAt: iso(row.consumedAt), revoked: !!row.revokedAt,
  };
}

/** Chef status helper (caller has already verified the chef owns the booking). Empty for legacy bookings. Table-absent tolerant. */
export async function chefVisitCodes(bookingId: number, tx: Tx = db as unknown as Tx): Promise<ChefVisitCodeState[]> {
  try { return (await readForBooking(tx, bookingId)).map(chefProjection); }
  catch (error) { if (tableMissing(error)) return []; throw error; }
}

export type ArrivalNoticeTarget = { targetKey: string; visitId: number | null; revision: number; mode: VisitCodeMode };
export async function currentArrivalNoticeTargets(bookingId: number, targets: ArrivalNoticeTarget[], tx: Tx = db as unknown as Tx) {
  const rows = await readForBooking(tx, bookingId);
  return targets.filter(target => rows.some(row => row.targetKey === target.targetKey && row.revision === target.revision
    && row.mode === target.mode && !row.consumedAt && !row.revokedAt));
}

// ---------------------------------------------------------------------------------------------
// Owning-manager operations
// ---------------------------------------------------------------------------------------------

async function lockOwnedBooking(tx: Tx, bookingId: number, managerId: number) {
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  const [row] = await tx.select({ managerId: locations.managerId, status: kitchenBookings.status }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || row.managerId !== managerId) throw new VisitCodeManagerError('Booking not found', 404);
  return row;
}
function selectTargets(rows: Challenge[], which: { targetKey?: string; all?: boolean }) {
  const picked = which.all ? rows : rows.filter(row => row.targetKey === which.targetKey);
  if (!picked.length) throw new VisitCodeManagerError('Check-in code target not found for this booking', 404);
  return picked;
}

export async function getManagerVisitCodes(bookingId: number, managerId: number): Promise<ManagerVisitCodeState[]> {
  const [row] = await db.select({ managerId: locations.managerId }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || row.managerId !== managerId) throw new VisitCodeManagerError('Booking not found', 404);
  try { return (await readForBooking(db as unknown as Tx, bookingId)).map(managerProjection); }
  catch (error) { if (tableMissing(error)) return []; throw error; }
}

/** Revokes the previous revision: new nonce, revision + 1, attempts reset, unlocked. */
export async function issueNewCode(bookingId: number, managerId: number, targetKey: string): Promise<ManagerVisitCodeState[]> {
  if (!visitCodeKeyConfigured()) throw new VisitCodeManagerError('Check-in codes are not configured on this server', 503);
  return db.transaction(async tx => {
    const booking = await lockOwnedBooking(tx, bookingId, managerId);
    if (booking.status !== 'confirmed') throw new VisitCodeManagerError('Only a confirmed booking has a check-in code');
    const [row] = selectTargets(await lockForBooking(tx, bookingId), { targetKey });
    if (row.consumedAt) throw new VisitCodeManagerError('Arrival is already recorded for this visit');
    if (row.revokedAt) throw new VisitCodeManagerError('This check-in code was revoked');
    if (row.mode === 'self') throw new VisitCodeManagerError('This visit uses self check-in. Switch it back to staffed to issue a code');
    await rotate(tx, row, managerId, {});
    await queueBookingLifecycleEvent(tx, bookingId, 'arrival_code_reissued', 'Arrival details updated',
      'Meet kitchen staff as planned. If they already gave you a check-in code, ask for the current one before confirming arrival.', managerId,
      { targets: [{ targetKey: row.targetKey, visitId: row.visitId, revision: row.revision + 1, mode: row.mode }] }, row.failedAttempts > 0);
    return (await readForBooking(tx, bookingId)).map(managerProjection);
  });
}

async function rotate(tx: Tx, row: Challenge, managerId: number, extra: Partial<typeof challengeTable.$inferInsert>) {
  await tx.update(challengeTable).set({
    revision: row.revision + 1, nonce: newNonce(), keyVersion: currentKeyVersion(), failedAttempts: 0, lockedAt: null,
    issuedByUserId: managerId, issuedAt: new Date(), updatedAt: new Date(), ...extra,
  }).where(and(eq(challengeTable.id, row.id), isNull(challengeTable.consumedAt), isNull(challengeTable.revokedAt)));
}

/** Switching mode always rotates, so a prior code or self-service permission cannot be reused. */
export async function setMode(bookingId: number, managerId: number,
  input: { targetKey?: string; all?: boolean; mode: VisitCodeMode; reason?: string }): Promise<ManagerVisitCodeState[]> {
  if (input.mode !== 'staffed' && input.mode !== 'self') throw new VisitCodeManagerError('Choose staffed or self check-in');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (input.mode === 'self' && (reason.length < 10 || reason.length > 500))
    throw new VisitCodeManagerError('Explain why self check-in is allowed (10-500 characters)');
  if (reason.length > 500) throw new VisitCodeManagerError('Reason is too long (500 characters maximum)');
  if (input.mode === 'staffed' && !visitCodeKeyConfigured()) throw new VisitCodeManagerError('Check-in codes are not configured on this server', 503);
  return db.transaction(async tx => {
    const booking = await lockOwnedBooking(tx, bookingId, managerId);
    if (booking.status !== 'confirmed') throw new VisitCodeManagerError('Only a confirmed booking has a check-in code');
    const targets = selectTargets(await lockForBooking(tx, bookingId), input);
    const changeable = targets.filter(row => !row.consumedAt && !row.revokedAt && row.mode !== input.mode);
    if (!input.all && targets.length === 1 && targets[0].consumedAt) throw new VisitCodeManagerError('Arrival is already recorded for this visit');
    for (const row of changeable) await rotate(tx, row, managerId, {
      mode: input.mode, modeChangedByUserId: managerId, modeChangedAt: new Date(), modeReason: reason || null,
    });
    if (changeable.length) await queueBookingLifecycleEvent(tx, bookingId, 'arrival_mode_changed', 'Arrival method updated',
      'Your arrival method has changed. Open your visit for the current arrival plan. Your booked time has not changed.', managerId,
      { targets: changeable.map(row => ({ targetKey: row.targetKey, visitId: row.visitId, revision: row.revision + 1, mode: input.mode })) });
    return (await readForBooking(tx, bookingId)).map(managerProjection);
  });
}
