import React from "react";
import TermsContent_uk_1 from "./TermsContent_uk_1";
import TermsContent_uk_2 from "./TermsContent_uk_2";
import TermsContent_uk_3 from "./TermsContent_uk_3";

/**
 * Reusable Terms of Service content component in Ukrainian.
 * Used standalone on the Terms page and inline in the TermsAcceptanceScreen.
 */
export default function TermsContent_uk() {
  return (
    <div className="prose prose-gray max-w-none">
      <TermsContent_uk_1 />
      <TermsContent_uk_2 />
      <TermsContent_uk_3 />
    </div>
  );
}
