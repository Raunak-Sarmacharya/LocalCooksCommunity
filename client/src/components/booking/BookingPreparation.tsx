/** Current instructions stay available even before tracking actions open. */
export default function BookingPreparation({ arrivalInstructions, departureInstructions }: {
  arrivalInstructions?: string | null; departureInstructions?: string | null;
}) {
  return <div className="pt-3 space-y-2 text-sm">
    <p className="font-medium">Before your visit</p>
    <p className="whitespace-pre-line">{arrivalInstructions || 'Contact the kitchen manager before arrival if you need directions or meeting instructions.'}</p>
    {departureInstructions && <p className="whitespace-pre-line">{departureInstructions}</p>}
    <p className="text-muted-foreground">Use the kitchen contact below for arrival help. Your reservation remains valid when arrival tracking is off.</p>
  </div>;
}
