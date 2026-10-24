import Stripe from 'stripe';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { locations, paymentTransactions, platformSettings, users } from '@shared/schema';
import { readManagerRevenue } from './manager-revenue-service';
import { recordPayoutTransferEvidence } from './payout-document-evidence';

/**
 * Daily check that every kitchen's Revenue "Paid out" matches the transfers Stripe actually holds (owner, Oct 24).
 * Read-only on Stripe. The one gap it can safely close itself is a reversal Stripe already holds but the database never
 * recorded (refunds before Oct 15); anything else is reported for Local Cooks to look at.
 */
export const RECONCILIATION_KEY = 'payout_reconciliation_latest';
// A transfer this recent may still be committing on our side.
const SETTLE_MS = 30 * 60_000;

export type ReconciliationIssue = {
  managerId: number; kitchenName: string; transferId: string;
  kind: 'missing_on_page' | 'not_in_stripe' | 'amount';
  pageCents: number | null; stripeCents: number | null;
};
export type ReconciliationResult = {
  checkedAt: string; kitchens: number; transfers: number; repairedReversals: number;
  issues: ReconciliationIssue[]; failures: Array<{ managerId: number; kitchenName: string; error: string }>;
};

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' as Stripe.LatestApiVersion, maxNetworkRetries: 2 });
}

/** Saves reversals Stripe holds for recorded kitchen transfers that the database is missing. Returns how many were saved. */
export async function saveMissingTransferReversals(stripe = stripeClient(), apply = true, log: (line: string) => void = () => {},
  known?: Map<string, Stripe.Transfer>) {
  const rows = await db.select({ id: paymentTransactions.id, intentId: paymentTransactions.paymentIntentId, transferId: paymentTransactions.transferId })
    .from(paymentTransactions).where(and(isNotNull(paymentTransactions.transferId), isNotNull(paymentTransactions.paymentIntentId)));
  const seen = new Set<string>();
  let saved = 0;
  for (const row of rows) {
    const key = `${row.intentId}:${row.transferId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The daily check already listed each kitchen's transfers; the script asks Stripe one by one.
    const transfer = known ? known.get(row.transferId!) : await stripe.transfers.retrieve(row.transferId!);
    if (!transfer?.amount_reversed) continue;
    const recorded = await db.execute(sql`SELECT max((ph.metadata->>'reversedCents')::int) AS reversed FROM payment_history ph
      JOIN payment_transactions pt ON pt.id = ph.transaction_id WHERE pt.payment_intent_id = ${row.intentId}
      AND ph.event_type = 'payout_transfer_verified' AND ph.metadata->>'transferId' = ${transfer.id}`) as { rows: Array<{ reversed: number | null }> };
    if ((recorded.rows[0]?.reversed ?? 0) >= transfer.amount_reversed) continue;
    saved += 1;
    log(`payment ${row.id} ${transfer.id}: Stripe reversed ${transfer.amount_reversed} of ${transfer.amount}; saved ${recorded.rows[0]?.reversed ?? 0}`);
    if (apply) await db.transaction(async tx => {
      await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, row.intentId!)).for('update');
      await recordPayoutTransferEvidence(tx, row.intentId!, { transferId: transfer.id, originalAmountCents: transfer.amount, reversedCents: transfer.amount_reversed });
    });
  }
  return saved;
}

/** Per-transfer comparison: the page's net for each Stripe transfer against Stripe's own net (amount − reversed). */
export function compareTransfers(page: Map<string, number>, stripe: Map<string, number>, settledBefore: Map<string, boolean>) {
  const issues: Array<Pick<ReconciliationIssue, 'transferId' | 'kind' | 'pageCents' | 'stripeCents'>> = [];
  for (const [transferId, stripeCents] of Array.from(stripe)) {
    if (!settledBefore.get(transferId)) continue;
    const pageCents = page.get(transferId);
    if (pageCents == null) issues.push({ transferId, kind: 'missing_on_page', pageCents: null, stripeCents });
    else if (pageCents !== stripeCents) issues.push({ transferId, kind: 'amount', pageCents, stripeCents });
  }
  for (const [transferId, pageCents] of Array.from(page)) if (!stripe.has(transferId)) issues.push({ transferId, kind: 'not_in_stripe', pageCents, stripeCents: null });
  return issues;
}

export async function runPayoutReconciliation(now = new Date()): Promise<ReconciliationResult> {
  const stripe = stripeClient();
  const managers = await db.selectDistinct({ id: users.id, account: users.stripeConnectAccountId, kitchenName: locations.name })
    .from(users).innerJoin(locations, eq(locations.managerId, users.id)).where(isNotNull(users.stripeConnectAccountId));
  const start = new Date(now.getTime() - 1095 * 86_400_000).toISOString().slice(0, 10);
  const range = { startDate: start, endDate: now.toISOString().slice(0, 10) };
  const result: ReconciliationResult = { checkedAt: now.toISOString(), kitchens: 0, transfers: 0, repairedReversals: 0, issues: [], failures: [] };
  const byManager = new Map<number, { account: string; names: string[] }>();
  for (const m of managers) {
    const entry = byManager.get(m.id) ?? { account: m.account!, names: [] };
    entry.names.push(m.kitchenName);
    byManager.set(m.id, entry);
  }
  // One paged list per kitchen account, then repair known reversals once, then compare.
  const transfers = new Map<number, Stripe.Transfer[]>(), all = new Map<string, Stripe.Transfer>();
  for (const [managerId, { account, names }] of Array.from(byManager)) {
    try {
      const list: Stripe.Transfer[] = [];
      for await (const transfer of stripe.transfers.list({ destination: account, limit: 100 })) { list.push(transfer); all.set(transfer.id, transfer); }
      transfers.set(managerId, list);
    } catch (error) {
      result.failures.push({ managerId, kitchenName: names.join(', '), error: error instanceof Error ? error.message : String(error) });
    }
  }
  result.repairedReversals = await saveMissingTransferReversals(stripe, true, () => {}, all);
  for (const [managerId, { names }] of Array.from(byManager)) {
    const kitchenName = names.join(', ');
    const list = transfers.get(managerId);
    if (!list) continue;
    try {
      const ledger = await readManagerRevenue(managerId, range);
      const page = new Map<string, number>();
      for (const row of ledger.paid) {
        const transferId = row.stripeUrl?.split('/').pop();
        if (transferId) page.set(decodeURIComponent(transferId), (page.get(decodeURIComponent(transferId)) ?? 0) + row.amountCents - row.reversedCents);
      }
      const stripeNet = new Map<string, number>(), settled = new Map<string, boolean>();
      for (const transfer of list) {
        stripeNet.set(transfer.id, transfer.amount - transfer.amount_reversed);
        settled.set(transfer.id, transfer.created * 1000 < now.getTime() - SETTLE_MS);
      }
      // A page transfer Stripe doesn't list yet may simply be newer than the settle window.
      for (const id of Array.from(page.keys())) if (!stripeNet.has(id)) settled.set(id, true);
      result.kitchens += 1;
      result.transfers += stripeNet.size;
      for (const issue of compareTransfers(page, stripeNet, settled)) result.issues.push({ managerId, kitchenName, ...issue });
    } catch (error) {
      result.failures.push({ managerId, kitchenName, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await saveAndAlert(result);
  return result;
}

export async function latestPayoutReconciliation(): Promise<(ReconciliationResult & { alerted?: string[] }) | null> {
  const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, RECONCILIATION_KEY)).limit(1);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

const issueKey = (issue: ReconciliationIssue) => `${issue.transferId}:${issue.kind}:${issue.pageCents}:${issue.stripeCents}`;

/** Admins hear about a mismatch once, when it first appears; the card always shows the current state. */
async function saveAndAlert(result: ReconciliationResult) {
  const previous = await latestPayoutReconciliation();
  const known = new Set(previous?.alerted ?? []);
  const fresh = result.issues.filter(issue => !known.has(issueKey(issue)));
  const value = JSON.stringify({ ...result, alerted: result.issues.map(issueKey) });
  await db.insert(platformSettings).values({ key: RECONCILIATION_KEY, value, description: 'Latest payout check against Stripe' })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
  if (!fresh.length && !result.failures.length) return;
  const { notifyAdmins } = await import('./document-waivers');
  const kitchens = Array.from(new Set([...fresh.map(issue => issue.kitchenName), ...result.failures.map(f => f.kitchenName)]));
  await notifyAdmins({
    subject: fresh.length ? 'Kitchen payouts don’t match Stripe' : 'The payout check against Stripe couldn’t finish',
    message: fresh.length
      ? `${fresh.length} payout${fresh.length === 1 ? '' : 's'} on kitchen Revenue pages differ from Stripe. Nothing was moved; review them in Manager Revenues.`
      : 'Some kitchens couldn’t be checked against Stripe. Nothing was moved; review them in Manager Revenues.',
    facts: [{ label: 'Kitchens', value: kitchens.join('; ') }],
    path: '/admin?section=manager-revenues', trackingPrefix: 'payout_reconciliation', actionLabel: 'Review payouts',
    metadata: { kind: 'payout_reconciliation', issues: fresh.length, failures: result.failures.length },
  });
}
