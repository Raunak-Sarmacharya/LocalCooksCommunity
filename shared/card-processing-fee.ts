/** Only the provider's original card-processing line. Connect/FX/tax costs are excluded. */
export function actualCardProcessingFee(details: Array<{ type: string; amount: number; currency: string }> | null | undefined, currency: string): number {
  const lines = details?.filter(item => item.type === 'stripe_fee');
  if (!lines?.length || lines.some(item => item.currency !== currency || !Number.isSafeInteger(item.amount) || item.amount < 0))
    throw Error('Actual card processing fee is not yet verified');
  const fee = lines.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(fee)) throw Error('Actual card processing fee requires review');
  return fee;
}
