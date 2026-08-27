import React from "react";
import TermsContent_fr_1 from "./TermsContent_fr_1";
import TermsContent_fr_2 from "./TermsContent_fr_2";
import TermsContent_fr_3 from "./TermsContent_fr_3";

/**
 * Reusable Terms of Service content component in French.
 * Used standalone on the Terms page and inline in the TermsAcceptanceScreen.
 */
export default function TermsContent_fr() {
  return (
    <div className="prose prose-gray max-w-none">
      <TermsContent_fr_1 />
      <TermsContent_fr_2 />
      <TermsContent_fr_3 />
    </div>
  );
}
