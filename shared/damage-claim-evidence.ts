/**
 * Damage-claim evidence rules, shared by the manager UI and the server.
 *
 * One source of truth on purpose: the manager's "Submit claim" button and the
 * submit endpoint must never disagree about what counts as enough evidence.
 *
 * Modelled on Turo, which requires pre-trip and post-trip photos of the damaged
 * area plus a repair quote or estimate before a claim can proceed
 * (help.turo.com/reporting-damage). A claim that proves only one of the three
 * either cannot show the damage was caused during the booking, or cannot show
 * what the repair costs.
 */

/** Evidence categories a claim must contain before it can be submitted. */
export interface DamageClaimEvidenceGaps {
  /** No "before" photo of the undamaged item. */
  beforePhoto: boolean;
  /** No "after" photo of the damage. */
  afterPhoto: boolean;
  /** No receipt, invoice or quote establishing the cost. */
  costDocument: boolean;
}

/** Evidence types that establish what the repair or replacement costs. */
const COST_DOCUMENT_TYPES = ['receipt', 'invoice'] as const;

interface DamageClaimEvidenceLike {
  evidenceType: string;
}

/**
 * Which required evidence categories are still missing.
 * All-false means the claim is ready to submit.
 */
export function damageClaimEvidenceGaps(
  evidence: readonly DamageClaimEvidenceLike[] | null | undefined,
): DamageClaimEvidenceGaps {
  const types = new Set((evidence ?? []).map((item) => item.evidenceType));
  return {
    beforePhoto: !types.has('photo_before'),
    afterPhoto: !types.has('photo_after'),
    costDocument: !COST_DOCUMENT_TYPES.some((type) => types.has(type)),
  };
}

/** True when the claim carries a before photo, an after photo and a cost document. */
export function hasRequiredDamageClaimEvidence(
  evidence: readonly DamageClaimEvidenceLike[] | null | undefined,
): boolean {
  const gaps = damageClaimEvidenceGaps(evidence);
  return !gaps.beforePhoto && !gaps.afterPhoto && !gaps.costDocument;
}

/** Human-readable list of the missing categories, for error messages. */
export function describeMissingDamageClaimEvidence(
  evidence: readonly DamageClaimEvidenceLike[] | null | undefined,
): string[] {
  const gaps = damageClaimEvidenceGaps(evidence);
  const missing: string[] = [];
  if (gaps.beforePhoto) missing.push('a before photo');
  if (gaps.afterPhoto) missing.push('an after photo');
  if (gaps.costDocument) missing.push('a receipt or invoice/quote');
  return missing;
}
