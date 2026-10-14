export function instructionReleaseAt(startInstant: Date, preparationHours: number): Date {
  return new Date(startInstant.getTime() - preparationHours * 3600000);
}

export function isInstructionReleased(now: Date, startInstant: Date, preparationHours: number): boolean {
  return now.getTime() >= instructionReleaseAt(startInstant, preparationHours).getTime();
}
