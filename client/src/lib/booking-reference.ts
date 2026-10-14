/** One reference everywhere: the booking's code, or "#152" when it has none yet. */
export const bookingReference = (code: string | null | undefined, id: number | string) => code || `#${id}`;
