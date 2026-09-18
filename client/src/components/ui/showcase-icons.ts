import { addCollection } from "@iconify/react";

/**
 * Two icons from collections this repo does not bundle.
 *
 * The app registers whole Iconify collections in `components/ui/manager-icons.tsx`, and
 * `addCollection` pulls the *entire* JSON into the bundle. Installing `@iconify-json/carbon`
 * to get one glyph would add roughly 10 MB of icon data to the login page, so only the two
 * bodies actually used here are registered, under their canonical prefixes — `<Icon>` then
 * resolves `heroicons-outline:receipt-tax` and `carbon:email-new` exactly as it would if the
 * full packages were present.
 *
 * If either collection is ever installed properly, delete this file and add the real
 * `addCollection` calls alongside the existing ones.
 */
addCollection({
  prefix: "heroicons-outline",
  width: 24,
  height: 24,
  icons: {
    "receipt-tax": {
      // `fill="none"` is required: Iconify sets `fill="currentColor"` on the <svg>, and this
      // is a stroke-drawn outline — without it the receipt renders as a solid black blob.
      body:
        '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M9.75 8.25v4.5m4.5-4.5v4.5m3.75-6.75v11.25l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5V6l2.25 1.5L9 6l2.25 1.5L13.5 6l2.25 1.5L18 6Z"/>',
    },
  },
});

addCollection({
  prefix: "carbon",
  width: 32,
  height: 32,
  icons: {
    "email-new": {
      body:
        '<path fill="currentColor" d="M28 6H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m0 2v2.643l-10 6.25l-10-6.25V8Zm-20 16V12.143l9.714 6.071a.5.5 0 0 0 .572 0L28 12.143V24Z"/>' +
        '<path stroke="#7A7A7A" d="M21.5 8.5h8"/>' +
        '<circle cx="16" cy="7.5" r="4.5" fill="#7A7A7A"/>',
    },
  },
});

export const RECEIPT_TAX_ICON = "heroicons-outline:receipt-tax";
export const EMAIL_NEW_ICON = "carbon:email-new";
