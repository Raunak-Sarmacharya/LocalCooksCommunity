import React from "react";

/**
 * Reusable Privacy Policy content component.
 * Used standalone on the Privacy page and inline in the TermsAcceptanceScreen.
 */
export default function PrivacyContent() {
  return (
    <div className="prose prose-gray max-w-none">
      <p className="text-sm text-gray-600 mb-8">
        <strong>Effective Date: 01-05-2026</strong><br />
        <strong>Jurisdiction: Newfoundland & Labrador, Canada (PIPEDA)</strong>
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">1. Introduction</h2>
      <p className="mb-4">
        Local Cooks Inc. (“Local Cooks”, “we”, “us”, or “our”) operates the Local Cooks platform that connects licensed commercial kitchen owners (“Kitchen Owners”) with chefs and food businesses (“Chefs”) who book and use those kitchens for commercial food preparation.
      </p>
      <p className="mb-4">
        This Privacy Policy explains how we collect, use, disclose, and protect Personal Information of Kitchen Owners and Chefs when they use our platform, including <strong>kitchen.localcooks.ca</strong>, <strong>chef.localcooks.ca</strong>, and any related web or mobile interfaces used to manage kitchen listings, bookings, and compliance documents (together, the “Platform”).
      </p>
      <p className="mb-4">
        We aim to comply with the <strong>Personal Information Protection and Electronic Documents Act (PIPEDA)</strong> and applicable privacy and consumer protection laws in Newfoundland & Labrador.
      </p>
      <p className="mb-4">
        By creating an account, submitting documents, or making/accepting bookings on the Platform, you consent to the collection, use, and disclosure of your Personal Information as described in this Privacy Policy, except where otherwise permitted or required by law.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">2. Who we are and how to contact us</h2>
      <p className="mb-4">
        <strong>Local Cooks Inc.</strong><br />
        Email: support@localcook.shop<br />
        Phone: +1 (709)-631-8480<br />
        Website: www.localcooks.ca
      </p>
      <p className="mb-4">
        Local Cooks Inc. is responsible for the Personal Information we collect in connection with the Platform and has appointed an internal privacy contact (“Privacy Officer”). You may contact us using the details above if you have questions about this Privacy Policy or wish to exercise your privacy rights.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">3. Scope of this Privacy Policy</h2>
      <p className="mb-4">
        This Privacy Policy applies to Personal Information we collect about:
      </p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Kitchen Owners / Hosts:</strong> who list and manage licensed commercial kitchens and related information on the Platform.</li>
        <li><strong>Chefs / Renters / Users:</strong> who register, submit documents, and book those kitchens through the Platform.</li>
      </ul>
      <p className="mb-4">It covers Personal Information collected when you:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Create and manage an account or profile on kitchen.localcooks.ca, chef.localcooks.ca, or related admin tools.</li>
        <li>Submit licences, certifications, insurance documents, or business details for verification.</li>
        <li>Create, accept, or manage bookings and payments for commercial kitchen rentals.</li>
      </ul>
      <p className="mb-4">This Policy <strong>does not</strong> apply to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Kitchen Owners’ or Chefs’ own websites, apps, or offline businesses, which have their own privacy practices.</li>
        <li>End consumers who purchase food from Chefs; consumer-facing privacy terms (if applicable) must be provided separately by the Chef or via a separate Local Cooks policy.</li>
      </ul>

      <h2 className="text-2xl font-bold mt-8 mb-4">4. Personal Information we collect</h2>
      <p className="mb-4">
        “Personal Information” means information about an identifiable individual, including information that relates to a business where it identifies an individual (e.g., a sole proprietor).
      </p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Information you provide directly</h3>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Account and contact information:</strong> Name, business or entity name, role (Kitchen Owner or Chef), email address, phone number, username, and password.</li>
        <li><strong>Business, licensing, and compliance information:</strong> Business address, kitchen address, description of your kitchen or food operation, Food Premises Licence number and copies, Food Handler Certification, other food business permits, inspection reports you choose to upload, and proof of authority to list or use a kitchen.</li>
        <li><strong>Insurance information:</strong> Insurance provider, policy type, coverage limits, certificate of insurance, additional insured endorsements, and renewal dates, where required under the Terms & Conditions.</li>
        <li><strong>Booking and transaction details:</strong> Booking dates and times, selected kitchen, agreed rates and fees, cancellation and refund information, and payout details for Kitchen Owners.</li>
        <li><strong>Communications and support:</strong> Messages exchanged through the Platform between Kitchen Owners, Chefs, and Local Cooks, email communications, support tickets, and feedback or surveys you choose to complete.</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Payment and payout information</h3>
      <p className="mb-4">
        Payments and payouts are processed through third-party payment processors such as <strong>Stripe</strong>. These processors collect and process your payment card or bank account information directly; Local Cooks does <strong>not</strong> store your full payment card number or CVV on its own systems.
      </p>
      <p className="mb-4">We may receive limited payment-related information from our processor, such as:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Payment method type, partial card digits, expiry month/year.</li>
        <li>Transaction amounts, currency, timestamps, and status.</li>
        <li>Payout amounts, dates, and status for Kitchen Owners and, where applicable, Chefs.</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Technical and usage information</h3>
      <p className="mb-4">When you access or use the Platform, we automatically collect certain technical data using cookies and similar technologies, including:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>IP address, browser type and version, operating system, and device identifiers.</li>
        <li>Pages visited, actions taken (e.g., creating a listing, uploading a document, making a booking), time and date of visits, and referral URLs.</li>
        <li>Approximate location derived from IP address; more precise location only if you enable it in your device or browser settings.</li>
      </ul>
      <p className="mb-4">
        We may use third-party analytics tools (such as Google Analytics or similar services) to understand how Kitchen Owners and Chefs use the Platform and to improve our services.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">5. How we use Personal Information</h2>
      <p className="mb-4">
        We collect, use, and disclose Personal Information only for purposes that a reasonable person would consider appropriate in the circumstances, including to:
      </p>
      <ul className="list-disc pl-6 mb-4">
        <li>Create and manage accounts for Kitchen Owners and Chefs, including authentication and role permissions.</li>
        <li>Verify eligibility and compliance, including Food Premises Licences, food safety training, business permits, insurance coverage, and other documents required under our Terms & Conditions.</li>
        <li>Display kitchen listings and profile information to the extent required to match Kitchen Owners and Chefs and facilitate bookings.</li>
        <li>Facilitate bookings, payments, and payouts between Kitchen Owners and Chefs via our payment processor.</li>
        <li>Operate and improve the Platform, including monitoring usage patterns, fixing bugs, and enhancing features relevant to kitchen rentals and chef access.</li>
        <li>Communicate with you, including sending booking confirmations, changes or cancellations, policy updates, service notices, and necessary account-related messages.</li>
        <li>Enforce and administer our Terms & Conditions, including eligibility checks, non-circumvention rules, food safety and acceptable-use provisions, and incident reporting.</li>
        <li>Prevent fraud, security incidents, and misuse of the Platform, and protect the rights, property, and safety of Local Cooks, Kitchen Owners, and Chefs.</li>
        <li>Comply with legal and regulatory obligations, including recordkeeping, food safety investigations, and responding to lawful requests from regulators and law enforcement.</li>
      </ul>
      <p className="mb-4">
        We may also use your contact information to send you <strong>optional marketing or informational communications</strong> about new features, kitchen opportunities, platform updates, or training resources. You can opt out of marketing communications at any time (see Section 11).
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">6. Legal basis and consent</h2>
      <p className="mb-4">
        Under PIPEDA, we generally rely on <strong>your consent</strong> to collect, use, and disclose your Personal Information, except where otherwise permitted or required by law.
      </p>
      <p className="mb-4">You provide consent when you:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Create an account or submit application/onboarding forms.</li>
        <li>Upload licences, certifications, or insurance documents.</li>
        <li>Click “I agree” to our Terms & Conditions and/or this Privacy Policy.</li>
      </ul>
      <p className="mb-4">
        You may <strong>withdraw your consent</strong> to certain uses or disclosures of your Personal Information at any time, subject to legal and contractual restrictions and reasonable notice. If you withdraw consent, we may not be able to continue providing some or all of the Platform functionality.
      </p>
      <p className="mb-4">We may process Personal Information without consent in limited situations permitted by law, such as:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Responding to an emergency threatening someone’s life, health, or security.</li>
        <li>Investigating or preventing fraud or violations of law or our Terms & Conditions.</li>
        <li>Responding to lawful requests from regulators or law enforcement, or complying with court orders.</li>
      </ul>

      <h2 className="text-2xl font-bold mt-8 mb-4">7. Cookies and similar technologies</h2>
      <p className="mb-4">We use cookies and similar technologies on the Platform to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Keep you signed in and maintain your session.</li>
        <li>Remember your preferences (e.g., default view, notification settings).</li>
        <li>Analyze how Kitchen Owners and Chefs use the Platform to improve performance and usability.</li>
      </ul>
      <p className="mb-4">
        You can manage cookie settings through your browser. If you disable essential cookies, some parts of the Platform (such as login or dashboard features) may not function properly.
      </p>
      <p className="mb-4">
        We may use third-party analytics cookies (e.g., Google Analytics) that collect aggregated, de-identified information about usage; we do not use analytics tools to view or disclose individual-level payment or licence details.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">8. How we share Personal Information</h2>
      <p className="mb-4">We do <strong>not</strong> sell or rent Personal Information. We share Personal Information only as reasonably necessary for the purposes described in this Policy:</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Between Kitchen Owners and Chefs</h3>
      <p className="mb-4">To enable bookings and allow both sides to assess suitability and compliance, we may share:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>For a Chef’s booking request:</strong> Chef’s name, contact details, relevant business and licensing information, description of food products, requested times, and insurance status with the Kitchen Owner.</li>
        <li><strong>For an accepted booking:</strong> Kitchen Owner’s contact information, kitchen location, access instructions, and any rules or documents shared through the Platform with the Chef.</li>
      </ul>
      <p className="mb-4">
        Kitchen Owners and Chefs are responsible for using each other’s information only as necessary for the booking, in line with applicable privacy and food safety laws.
      </p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Service providers and partners</h3>
      <p className="mb-4">We engage third-party service providers who process Personal Information on our behalf, including:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Payment processors (e.g., Stripe).</li>
        <li>Analytics providers (e.g., Google Analytics or similar).</li>
        <li>Email and communication tools (transactional and marketing emails).</li>
        <li>Cloud hosting and data storage providers.</li>
        <li>Customer support and ticketing tools.</li>
      </ul>
      <p className="mb-4">
        These providers receive only the information needed to perform their services and are required to use appropriate safeguards and to use the information only for Local Cooks’ purposes.
      </p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.3 Legal, regulatory, and safety disclosures</h3>
      <p className="mb-4">We may disclose Personal Information where required or permitted by law, including:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>To provincial or municipal food safety authorities, health inspectors, or other regulators in the context of inspections, investigations, or enforcement.</li>
        <li>To comply with subpoenas, court orders, or lawful requests by government authorities.</li>
        <li>To protect the rights, property, or safety of Local Cooks, our users, or the public.</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.4 Business transactions</h3>
      <p className="mb-4">
        If Local Cooks is involved in a merger, acquisition, financing, or sale of all or part of its business, Personal Information may be transferred as part of that transaction, subject to appropriate safeguards and applicable legal requirements.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">9. International transfers</h2>
      <p className="mb-4">
        Our servers and some service providers may be located outside Newfoundland & Labrador or outside Canada. As a result, your Personal Information may be transferred to and processed in other jurisdictions where privacy laws may differ from those in Canada, and may be accessible to courts, law enforcement, and national security authorities in those jurisdictions.
      </p>
      <p className="mb-4">
        When we transfer Personal Information outside Canada, we take reasonable steps to ensure that comparable protections are in place, consistent with Canadian privacy law.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">10. Retention of Personal Information</h2>
      <p className="mb-4">
        We retain Personal Information only as long as necessary to fulfill the purposes identified in this Policy or as required or permitted by law.
      </p>
      <p className="mb-4">For example, we typically retain:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Account, onboarding, and compliance documentation for as long as your account is active and for a period thereafter to manage potential disputes, audits, and regulatory requirements.</li>
        <li>Booking and transaction records for a period required to meet tax, accounting, and regulatory obligations.</li>
      </ul>
      <p className="mb-4">
        When Personal Information is no longer required, we will delete it, anonymize it, or securely destroy it in accordance with our data retention and destruction practices.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">11. Your rights and choices</h2>
      <p className="mb-4">Subject to applicable law, Kitchen Owners and Chefs have the right to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Access:</strong> Request access to the Personal Information we hold about you.</li>
        <li><strong>Correct:</strong> Request corrections or updates to inaccurate or incomplete information.</li>
        <li><strong>Withdraw consent:</strong> Withdraw your consent to certain uses/disclosures, subject to legal/contractual limits and reasonable notice.</li>
        <li><strong>Close your account:</strong> Request deactivation or deletion of your user account, subject to our retention obligations.</li>
      </ul>
      <p className="mb-4">
        You may also <strong>opt out of marketing emails</strong> at any time by clicking the “unsubscribe” link in those emails or by contacting us at support@localcook.shop.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">12. Security measures</h2>
      <p className="mb-4">
        We use reasonable physical, organizational, and technical safeguards to protect Personal Information from loss, theft, misuse, and unauthorized access, disclosure, alteration, or destruction. Measures may include encryption in transit (SSL/TLS), access controls, role-based permissions for staff, logging and monitoring of systems, and limiting access to Personal Information to personnel and service providers who need it to perform their duties.
      </p>
      <p className="mb-4">
        However, <strong>no method of transmission over the internet or electronic storage is completely secure</strong>, and we cannot guarantee absolute security. If we become aware of a privacy breach involving Personal Information that creates a real risk of significant harm, we will investigate, notify affected individuals and regulators as required, and take reasonable steps to reduce the risk of harm.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">13. Children’s privacy</h2>
      <p className="mb-4">
        The Platform is intended for adults involved in operating or managing commercial food businesses. We do not knowingly collect Personal Information from individuals under the age of 18. If we learn that we have collected Personal Information of a minor without appropriate consent, we will take steps to delete it.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">14. Third-party websites and services</h2>
      <p className="mb-4">
        The Platform may contain links or integrations with third-party websites or services (for example, training providers, government licensing portals, or document-signing tools). We are not responsible for the privacy practices or content of these third-party services, and we encourage you to review their privacy policies before providing them with Personal Information.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">15. Changes to this Privacy Policy</h2>
      <p className="mb-4">
        We may update this Privacy Policy from time to time to reflect changes in our practices, technologies, or legal requirements. When we make material changes, we will post the updated Policy on the Platform, update the “Effective Date” at the top, and may provide additional notice (such as email or in-app notification) where appropriate.
      </p>
      <p className="mb-4">
        Your continued use of the Platform after the updated Privacy Policy takes effect will constitute your acceptance of the changes.
      </p>

      <h2 className="text-2xl font-bold mt-8 mb-4">16. Questions or complaints</h2>
      <p className="mb-4">If you have questions, concerns, or complaints about this Privacy Policy or our handling of Personal Information, please contact:</p>
      <p className="mb-4">
        <strong>Privacy Officer</strong><br />
        Local Cooks Inc.<br />
        4 Priscilla Place, Paradise, Newfoundland and Labrador, A1L 1E6, Canada<br />
        Email: support@localcook.shop
      </p>
      <p className="mb-4">
        You also have the right to lodge a complaint with the <strong>Office of the Privacy Commissioner of Canada</strong> or the applicable provincial privacy regulator if you believe your privacy rights have been violated.
      </p>

      <hr className="my-8" />
      <p className="text-center text-gray-600">
        © 2026 Local Cooks Inc. All rights reserved.
      </p>
    </div>
  );
}
