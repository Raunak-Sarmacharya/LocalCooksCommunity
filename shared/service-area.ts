/**
 * Where this platform operates.
 *
 * One name for one fact, because it had none and that cost us a bug. The province was a bare
 * `"NL"` written out at each call site — twice — so when a THIRD address field was added it simply
 * omitted the restriction, and that field offered addresses anywhere in the United States and
 * Canada. Nothing failed; it just quietly served the wrong continent.
 *
 * It matters more than a display preference. `server/routes/places.ts` filters predictions to this
 * province, biases the search with bounds around it, and re-checks the province on the DETAILS call
 * — its own note says that second check exists "so a user can never persist an out-of-province pick".
 * Pass no province and that whole chain falls back to `country:us|country:ca`.
 *
 * So: any address field that creates or edits a location passes `province={SERVICE_PROVINCE}`. A
 * field that does not is not "unrestricted", it is a bug.
 */
export const SERVICE_PROVINCE = "NL";

/** Human-readable form, for copy that names the service area. */
export const SERVICE_PROVINCE_NAME = "Newfoundland and Labrador";
