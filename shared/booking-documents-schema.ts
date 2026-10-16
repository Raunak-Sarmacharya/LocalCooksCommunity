/**
 * Issued booking money documents (migration 0086, UNAPPLIED until the owner runs it). Kept out of schema.ts so the
 * table can ship independently; rows are immutable (a database trigger rejects UPDATE and DELETE).
 */
import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { DocumentAudience, DocumentKind, DocumentSnapshot } from './booking-documents';

export const bookingDocuments = pgTable('booking_documents', {
  id: serial('id').primaryKey(),
  number: text('number').notNull(),
  bookingId: integer('booking_id').notNull(),
  kind: text('kind').$type<DocumentKind>().notNull(),
  audience: text('audience').$type<DocumentAudience>().notNull(),
  /** Idempotency key: payment:chef:<pi>, refund:chef:<re>, refund:manager:<re>, remittance:manager:<tr>, statement:<audience>:<booking>. */
  sourceKey: text('source_key').notNull(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  stripeChargeId: text('stripe_charge_id'),
  stripeRefundId: text('stripe_refund_id'),
  stripeTransferId: text('stripe_transfer_id'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('CAD'),
  /** The full rendered snapshot (header facts, lines, totals, notes). */
  lines: jsonb('lines').$type<DocumentSnapshot>().notNull(),
  referencesDocumentId: integer('references_document_id'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex('booking_documents_number_key').on(table.number),
  uniqueIndex('booking_documents_source_key').on(table.sourceKey),
  index('booking_documents_booking_idx').on(table.bookingId, table.audience, table.id),
]);
export type BookingDocumentRow = typeof bookingDocuments.$inferSelect;
