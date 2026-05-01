import React from "react";

/**
 * Reusable Terms of Service content component.
 * Used standalone on the Terms page and inline in the TermsAcceptanceScreen.
 */
export default function TermsContent() {
  return (
    <div className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold mb-4">LOCAL COOKS PLATFORM COMPREHENSIVE TERMS & CONDITIONS</h1>
      <p className="text-sm text-gray-600 mb-2">
        <strong>St. John&apos;s, Newfoundland &amp; Labrador</strong><br />
        <strong>Effective Date:</strong> 01-02-2026<br />
        <strong>Last Updated:</strong> 01-02-2026<br />
        <strong>Jurisdiction:</strong> Newfoundland &amp; Labrador, Canada
      </p>

      <hr className="my-8" />

      <h2 className="text-2xl font-bold mt-8 mb-4">TABLE OF CONTENTS</h2>
      <ol className="list-decimal pl-6 mb-8">
        <li><strong>Definitions</strong></li>
        <li><strong>Platform Role &amp; Disclaimer</strong></li>
        <li><strong>Eligibility &amp; Onboarding</strong></li>
        <li><strong>Kitchen Owner (Host) Terms</strong></li>
        <li><strong>Chef/User (Renter) Terms</strong></li>
        <li><strong>Insurance Requirements</strong></li>
        <li><strong>Liability &amp; Indemnification</strong></li>
        <li><strong>Food Safety &amp; Legal Compliance</strong></li>
        <li><strong>Payments, Fees &amp; Taxes</strong></li>
        <li><strong>Acceptable Use &amp; Conduct</strong></li>
        <li><strong>Intellectual Property &amp; Data</strong></li>
        <li><strong>Dispute Resolution</strong></li>
        <li><strong>Termination &amp; Account Suspension</strong></li>
        <li><strong>Limitation of Liability</strong></li>
        <li><strong>Miscellaneous</strong></li>
        <li><strong>Acknowledgment &amp; Acceptance</strong></li>
      </ol>

      <hr className="my-8" />

      {/* SECTION 1 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">1. DEFINITIONS</h2>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>&quot;Local Cooks&quot; or &quot;Platform&quot;:</strong> The web/mobile application and marketplace operated by Local Cooks Inc. that facilitates bookings between Kitchen Owners and Chefs.</li>
        <li><strong>&quot;Kitchen Owner&quot; or &quot;Host&quot;:</strong> Any natural person or business entity that owns, leases, or operates a licensed commercial kitchen in Newfoundland &amp; Labrador and lists it on the Platform for rental to others.</li>
        <li><strong>&quot;Chef&quot; or &quot;Renter&quot; or &quot;User&quot;:</strong> Any natural person or business entity who books and uses a Kitchen through the Platform to prepare, cook, package, or process food products for commercial sale.</li>
        <li><strong>&quot;Kitchen&quot; or &quot;Licensed Space&quot;:</strong> A fixed or mobile food premises that holds a valid Food Premises Licence issued by Service NL, Department of Digital Government and Service NL, Newfoundland &amp; Labrador, and complies with the Food Premises Regulations under the Food and Drug Act.</li>
        <li><strong>&quot;Food Premises Licence&quot;:</strong> The regulatory licence issued by Service NL permitting operation of a commercial food preparation, manufacturing, or processing facility in compliance with Newfoundland &amp; Labrador&apos;s Food Premises Regulations (Consolidated Newfoundland Regulation 1022/96).</li>
        <li><strong>&quot;Booking&quot;:</strong> A confirmed rental agreement between a Kitchen Owner and Chef, specifying date, time, hourly or monthly rate, equipment use, and terms of access.</li>
        <li><strong>&quot;Applicable Law&quot;:</strong> All federal, provincial, territorial, and municipal laws, regulations, bylaws, and ordinances applicable in Newfoundland &amp; Labrador, including but not limited to the Food and Drug Act, Food Premises Regulations, Health and Community Services Act, Building Codes, and Occupational Health &amp; Safety legislation.</li>
        <li><strong>&quot;Personal Information&quot;:</strong> Information that identifies, relates to, or can be associated with an individual or business, including but not limited to name, address, email, phone, payment information, and food product details.</li>
        <li><strong>&quot;Confidential Information&quot;:</strong> Non-public information disclosed by a party that is marked as confidential or reasonably understood to be confidential.</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 2 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">2. PLATFORM ROLE &amp; DISCLAIMER</h2>
      
      <h3 className="text-xl font-semibold mt-6 mb-3">2.1 Intermediary Role Only</h3>
      <p className="mb-4">Local Cooks is a technology platform and marketplace intermediary only. The Platform does NOT:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Operate, own, manage, or supervise any Kitchen</li>
        <li>Provide food preparation, cooking, or food safety services</li>
        <li>Inspect, approve, or guarantee the condition, safety, or equipment of any Kitchen</li>
        <li>Inspect or approve the food products prepared in any Kitchen</li>
        <li>Represent or warrant the quality, safety, or legality of food prepared on the Platform</li>
        <li>Act as an agent, employee, or representative of either Kitchen Owners or Chefs</li>
        <li>Provide legal, tax, food safety, or business advice</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">2.2 Kitchen Owner Responsibility</h3>
      <p className="mb-4">Kitchen Owners are solely responsible for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Obtaining and maintaining a valid Food Premises Licence</li>
        <li>Complying with all Applicable Law, including the Food Premises Regulations</li>
        <li>Maintaining the Kitchen in sanitary, safe, and code-compliant condition</li>
        <li>Maintaining comprehensive insurance coverage</li>
        <li>Ensuring all equipment functions properly and is maintained to food safety standards</li>
        <li>Conducting cleaning and maintenance between rentals</li>
        <li>Inspecting the Kitchen before each Chef rental</li>
        <li>Cooperating fully with provincial and municipal food safety inspectors</li>
        <li>Reporting any kitchen condition changes, license suspensions, or equipment failures to Local Cooks immediately</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">2.3 Chef Responsibility</h3>
      <p className="mb-4">Chefs are solely responsible for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Obtaining and maintaining valid Food Handler Certification</li>
        <li>Complying with all Applicable Law and food safety regulations</li>
        <li>Operating only within the scope permitted by their food business licence/permit</li>
        <li>Using the Kitchen in a safe, sanitary, and legal manner</li>
        <li>Following all food safety protocols, temperature controls, and hygiene standards</li>
        <li>Supervising their staff and controlling access to the Kitchen during their rental period</li>
        <li>Leaving the Kitchen in clean, sanitary, orderly condition after use</li>
        <li>Reporting any injuries, incidents, or kitchen defects to the Kitchen Owner immediately</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">2.4 &quot;AS IS&quot; &amp; &quot;AS AVAILABLE&quot; Disclaimer</h3>
      <p className="mb-4">The Platform, Kitchen listings, and all services are provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranties of any kind, express or implied. Local Cooks does NOT warrant that:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Any Kitchen is safe, clean, compliant with food safety regulations, or suitable for intended use</li>
        <li>Any Kitchen equipment functions properly or meets food service standards</li>
        <li>Any Kitchen Owner possesses valid licenses or insurance</li>
        <li>Any Chef possesses proper certifications or legal authority to operate</li>
        <li>The Platform will be uninterrupted, error-free, or secure</li>
        <li>Food prepared in any Kitchen is safe, wholesome, or fit for human consumption</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 3 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">3. ELIGIBILITY &amp; ONBOARDING</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">3.1 Kitchen Owner Eligibility</h3>
      <p className="mb-4">To list a Kitchen on Local Cooks, the Kitchen Owner must:</p>
      <ol className="list-decimal pl-6 mb-4">
        <li>Hold a valid, unexpired Food Premises Licence issued by Service NL for a fixed food premises OR have an approved plan for obtaining one within 30 days of listing request. Proof of licence (or application confirmation) must be provided.</li>
        <li>Own, lease, or have documented authority to list and rent the Kitchen. Local Cooks may request proof (deed, lease, property manager authorization, etc.).</li>
        <li>Maintain comprehensive insurance coverage meeting the minimums specified in Section 6 of these Terms, with Local Cooks named as additional insured.</li>
        <li>Certify compliance with Applicable Law, including but not limited to building code, fire code, zoning, occupancy permits, water supply and sewage standards, and equipment maintenance.</li>
        <li>Be of legal age (18+ in Canada) and of sound legal capacity.</li>
        <li>Agree to conduct background screening if requested by Local Cooks for fraud/safety purposes (per privacy laws).</li>
      </ol>

      <h3 className="text-xl font-semibold mt-6 mb-3">3.2 Chef Eligibility</h3>
      <p className="mb-4">To book a Kitchen on Local Cooks, the Chef must:</p>
      <ol className="list-decimal pl-6 mb-4">
        <li>Hold a valid Food Handler Certification (or equivalent food safety training) issued by an approved provider. Proof must be provided before first booking.</li>
        <li>Hold all required food business permits/licenses for the food product(s) they intend to prepare (e.g., Health Permit from Provincial Health Authority, municipal business registration).</li>
        <li>Agree to operate legally and ethically, including no preparation of prohibited foods and no misrepresentation of product origin or safety credentials.</li>
        <li>Be of legal age (18+ in Canada) and of sound legal capacity.</li>
        <li>Agree to conduct background screening if requested by Local Cooks (per privacy laws).</li>
      </ol>

      <h3 className="text-xl font-semibold mt-6 mb-3">3.3 Onboarding &amp; Verification Process</h3>
      <p className="mb-4"><strong>Kitchen Owner Onboarding:</strong> Local Cooks will require and verify Food Premises Licence, Liability Insurance, zoning verification, and signed Terms before a Kitchen is listed as &quot;Active&quot;.</p>
      <p className="mb-4"><strong>Kitchen Owner Annual Re-Verification:</strong> Local Cooks will request updated documents annually. If not provided within 30 days, the listing will be automatically suspended.</p>
      <p className="mb-4"><strong>Chef Onboarding:</strong> Local Cooks will require Food Handler Certification, food business permits (if applicable), Liability Insurance, and signed Terms before a Chef may make a booking.</p>
      <p className="mb-4"><strong>Verification Scope:</strong> Local Cooks verifies the validity and non-expiry of documents provided, but does NOT conduct independent inspections or monitor ongoing compliance between verifications.</p>

      <hr className="my-8" />

      {/* SECTION 4 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">4. KITCHEN OWNER (HOST) TERMS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Listing Creation &amp; Accuracy</h3>
      <p className="mb-4">Kitchen Owners grant Local Cooks a non-exclusive right to display their listing and warrant that all information—including description, location, equipment, and pricing—is accurate and not misleading.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Kitchen Access &amp; Condition</h3>
      <p className="mb-4">Kitchen Owners agree to grant access on the scheduled date/time, provide functioning equipment, ensure the kitchen is clean and safe before each rental, and maintain fire safety systems.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Rental Agreement with Chefs</h3>
      <p className="mb-4">Kitchen Owners must execute a written Rental Agreement with each Chef, defining rental periods, fees, cleaning obligations, indemnity, and insurance requirements. Sample language is available from Local Cooks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.4 Insurance &amp; Liability</h3>
      <p className="mb-4"><strong>Mandatory Insurance:</strong> Kitchen Owners must maintain Commercial General Liability (min $1M/$2M) and Property Insurance, naming Local Cooks Inc. as an additional insured.</p>
      <p className="mb-4"><strong>Owner Liability:</strong> Owners are fully liable for injuries or damages caused by their negligence, defective equipment, or failure to comply with Applicable Law. Owners shall indemnify Local Cooks from all claims arising from their operation or breach of Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.5 Food Safety Compliance</h3>
      <p className="mb-4">Kitchen Owners must maintain a valid Food Premises Licence, notify Local Cooks of any suspensions, and require at least one Food Handler Certified staff member on premises during food preparation.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.6 Inspection Rights</h3>
      <p className="mb-4">Local Cooks reserves the right to request updated documentation at any time and work with regulatory authorities to verify compliance.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.7 Reservation &amp; Cancellation Policies</h3>
      <p className="mb-4">Owners may set their own cancellation policies, which must be clearly stated in the listing. Frequent cancellations by an Owner may result in account termination.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.8 Damage Deposits &amp; Damage Claims</h3>
      <p className="mb-4">Owners may require a refundable damage deposit. Claims must be documented and submitted to Local Cooks within 7 days of rental completion. Local Cooks will attempt to mediate unresolved disputes.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.9 Payment &amp; Payout</h3>
      <p className="mb-4">Local Cooks collects payments via Stripe, retains a Platform Fee, and remits the Owner&apos;s share within 5-7 business days. Circumventing the Platform for payment is prohibited.</p>

      <hr className="my-8" />

      {/* SECTION 5 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">5. CHEF/USER (RENTER) TERMS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.1 Booking &amp; Reservation</h3>
      <p className="mb-4">Chefs agree to rent the Kitchen for the specified duration, provide accurate food product information, disclose allergens, and use the Kitchen only for commercial food preparation. Bookings are confirmed upon acceptance through the Platform.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.2 Food Safety &amp; Legal Compliance</h3>
      <p className="mb-4">Chefs must hold valid Food Handler Certification and business permits, comply with Food Premises Regulations, maintain proper temperatures, and follow sanitation protocols. Specific high-risk products may require pre-approval.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.3 Kitchen Use &amp; Rules</h3>
      <p className="mb-4">Chefs must respect rental times, use only specified areas and equipment, follow Kitchen-specific rules, and supervise their own staff. No modifications to the Kitchen are permitted without consent.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.4 Cleaning &amp; Sanitation</h3>
      <p className="mb-4">Chefs must leave the Kitchen in the same sanitary condition as arrival, following a cleaning checklist. Failure to clean adequately may result in loss of damage deposit or additional cleaning fees.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.5 Insurance &amp; Liability</h3>
      <p className="mb-4"><strong>Mandatory Insurance:</strong> Chefs must provide proof of General Liability Insurance (min $1M) and Workers&apos; Compensation (if applicable), naming the Kitchen Owner as an additional insured.</p>
      <p className="mb-4"><strong>Chef Liability:</strong> Chefs are fully liable for injuries, damages, or illnesses caused by their negligence, food products, or staff. Chefs shall indemnify the Kitchen Owner and Local Cooks from all related claims.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.6 No Liability for Third-Party Injuries or Food Safety</h3>
      <p className="mb-4">Chef acknowledges that Local Cooks and the Kitchen Owner are NOT liable for any injury or illness caused by food prepared by the Chef or the Chef&apos;s handling practices.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.7 Incident Reporting</h3>
      <p className="mb-4">Chefs must immediately report any injuries, foodborne illness complaints, equipment malfunctions, or safety hazards to the Kitchen Owner and Local Cooks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.8 Non-Circumvention Agreement</h3>
      <p className="mb-4">Chefs agree not to contact Owners directly to bypass Local Cooks and avoid Platform fees. Violations may result in account termination and legal action to recover fees.</p>

      <hr className="my-8" />

      {/* SECTION 6 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">6. INSURANCE REQUIREMENTS</h2>
      
      <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Kitchen Owner Insurance Summary</h3>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Commercial General Liability:</strong> $1M per occurrence / $2M aggregate.</li>
        <li><strong>Property Insurance:</strong> Full replacement cost for building and equipment.</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Chef Insurance Summary</h3>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>General or Product Liability:</strong> $1M per occurrence, naming Owner as additional insured.</li>
        <li><strong>Workers&apos; Compensation:</strong> Statutory limits where applicable.</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.3 Certificate of Insurance</h3>
      <p className="mb-4">Both parties must provide a Certificate of Insurance evidencing required coverage, additional insured endorsements, and a 10-day non-cancellation notice.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.4 Insurance Verification</h3>
      <p className="mb-4">Local Cooks verifies that certificates meet minimums but does not independently confirm if policies remain active or adequate for specific risks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.5 Waiver of Subrogation</h3>
      <p className="mb-4">Kitchen Owners and Chefs grant each other and Local Cooks a mutual waiver of subrogation rights to reduce claim disputes and foster cooperation.</p>

      <hr className="my-8" />

      {/* SECTION 7 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">7. LIABILITY &amp; INDEMNIFICATION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.1 Local Cooks&apos; Limited Liability</h3>
      <p className="mb-4">Local Cooks does NOT assume liability for kitchen conditions, food safety, injuries, illnesses, equipment failures, or third-party claims occurring on the Platform.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.2 Chef Indemnity to Kitchen Owner</h3>
      <p className="mb-4">Chefs shall indemnify and hold Kitchen Owners harmless from all claims arising from the Chef&apos;s use of the kitchen, food products, negligence, or breach of Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.3 Kitchen Owner Indemnity to Chef</h3>
      <p className="mb-4">Kitchen Owners shall indemnify and hold Chefs harmless from claims arising from kitchen conditions, equipment failure, or the Owner&apos;s negligence/breach of Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.4 Local Cooks Indemnity (Limited)</h3>
      <p className="mb-4">Local Cooks indemnifies Users solely for claims arising from Local Cooks&apos; gross negligence or data breaches caused by its own security failures.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.5 Mutual Cooperation on Claims</h3>
      <p className="mb-4">Parties agree to cooperate fully in defending third-party claims, sharing relevant information with insurers to determine proportional liability.</p>

      <hr className="my-8" />

      {/* SECTION 8 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">8. FOOD SAFETY &amp; LEGAL COMPLIANCE</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Newfoundland &amp; Labrador Regulations</h3>
      <p className="mb-4">All preparation must comply with the Food Premises Regulations, Health and Community Services Act, and applicable Building and Fire Codes.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Food Premises Licence Requirements</h3>
      <p className="mb-4">Owners must maintain a valid licence, notify Local Cooks of any status changes, and cooperate with regulatory inspections.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.3 Food Handler Certification</h3>
      <p className="mb-4">At least one person present during food preparation must hold a valid certification from an accredited provider recognized in NL.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.4 Approved Food Products &amp; Processes</h3>
      <p className="mb-4">Chefs must disclose product details and obtain Owner approval for high-risk or specialized items. Local Cooks does not approve products or processes.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.5 Temperature Control &amp; HACCP</h3>
      <p className="mb-4">Chefs must maintain strict temperature controls (Hot ≥63°C, Cold ≤4°C) and are encouraged to implement HACCP principles for monitoring and record-keeping.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.6 Allergen Management</h3>
      <p className="mb-4">Chefs are solely responsible for disclosing allergens, labeling products accurately, and preventing cross-contamination during preparation.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.7 Inspection Cooperation</h3>
      <p className="mb-4">Chefs must cooperate fully with regulatory inspectors visiting the kitchen during their rental. Failure to do so may result in fines or Platform suspension.</p>

      <hr className="my-8" />

      {/* SECTION 9 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">9. PAYMENTS, FEES &amp; TAXES</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.1 Rental Fees &amp; Pricing</h3>
      <p className="mb-4">Owners set their own fees, and Chefs agree to pay the stated amount. Overstays are charged at the hourly rate or as per the Owner&apos;s policy.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.2 Local Cooks Platform Fee</h3>
      <p className="mb-4">Local Cooks deducts a Platform Fee (typically 15-20%) from the rental fee to cover maintenance, support, and processing costs.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.3 Payment Processing &amp; Payout</h3>
      <p className="mb-4">Payments flow through Stripe. Remittances are made to Owners within 5-7 business days after rental completion. Chargebacks are prohibited except for processing errors.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.4 HST/Sales Tax Obligations</h3>
      <p className="mb-4">Owners and Chefs are solely responsible for determining their GST/HST registration requirements and remitting taxes to the CRA. Local Cooks does not collect HST on behalf of Owners.</p>

      <hr className="my-8" />

      {/* SECTION 10 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">10. ACCEPTABLE USE &amp; CONDUCT</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.1 Prohibited Conduct</h3>
      <p className="mb-4">Users must not engage in illegal activity, fraud, harassment, food tampering, or any conduct that compromises Platform security or operations.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.2 Compliance with Laws</h3>
      <p className="mb-4">All users warrant that they are of legal age, possess required licenses, and will comply with all federal, provincial, and municipal laws.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.3 Monitoring &amp; Enforcement</h3>
      <p className="mb-4">Local Cooks may monitor conduct, request documentation, and suspend accounts for violations. Users remain responsible for their own actions.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.4 Third-Party Claims &amp; Dispute Resolution</h3>
      <p className="mb-4">Foodborne illness claims are legal matters between the parties and their insurers; Local Cooks does not mediate such claims.</p>

      <hr className="my-8" />

      {/* SECTION 11 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">11. INTELLECTUAL PROPERTY &amp; DATA</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.1 Platform Intellectual Property</h3>
      <p className="mb-4">Local Cooks retains all rights to the Platform technology, branding, and databases. Users grant a perpetual right to use any feedback provided.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.2 User-Generated Content</h3>
      <p className="mb-4">Users retain ownership of their photos and descriptions but grant Local Cooks a perpetual, royalty-free right to display and use them for marketing.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.3 Personal Information &amp; Privacy</h3>
      <p className="mb-4">Personal Information is collected to facilitate bookings and comply with laws. Local Cooks will not sell or rent this data. Refer to the Privacy Policy for full details.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.4 Data Security</h3>
      <p className="mb-4">Local Cooks uses industry-standard encryption, but users are responsible for protecting their login credentials and reporting unauthorized access.</p>

      <hr className="my-8" />

      {/* SECTION 12 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">12. DISPUTE RESOLUTION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">12.1 Communication &amp; Informal Resolution</h3>
      <p className="mb-4">Parties must attempt to resolve disputes directly within 7 days before contacting Local Cooks for mediation support.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">12.2 Binding Arbitration</h3>
      <p className="mb-4">Any dispute arising from these Terms will be resolved by final and binding arbitration in St. John&apos;s, NL, on an individual basis only. Class actions are waived.</p>

      <hr className="my-8" />

      {/* SECTION 13 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">13. TERMINATION &amp; ACCOUNT SUSPENSION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">13.1 Voluntary Termination by User</h3>
      <p className="mb-4">Users may close their accounts at any time, subject to settling outstanding obligations. Profiles will be removed and pending bookings cancelled.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">13.2 Suspension for Violation</h3>
      <p className="mb-4">Local Cooks may immediately suspend or terminate accounts for food safety violations, insurance lapses, fraud, illegal activity, or material breach of Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">13.3 Appeal Process</h3>
      <p className="mb-4">Users may appeal suspensions within 7 days. If unresolved, the dispute will be referred to binding arbitration.</p>

      <hr className="my-8" />

      {/* SECTION 14 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">14. LIMITATION OF LIABILITY</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.1 Disclaimer of Warranties</h3>
      <p className="mb-4">The Platform and Kitchens are provided &quot;AS IS&quot; without warranties of merchantability, safety, or fitness for a particular purpose.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.2 Cap on Liability</h3>
      <p className="mb-4">Local Cooks&apos; total liability for any claim shall not exceed the Platform Fees paid by the user in the 12 months preceding the claim.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.3 No Liability for Consequential Damages</h3>
      <p className="mb-4">Local Cooks is not liable for indirect, incidental, or punitive damages, lost profits, or business opportunities, even if advised of their possibility.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.4 No Liability for User Conduct</h3>
      <p className="mb-4">Local Cooks is not liable for the actions of Owners, Chefs, or third parties, including food safety violations or injuries occurring in kitchens.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.5 No Liability for Platform Downtime</h3>
      <p className="mb-4">Local Cooks is not liable for business losses resulting from Platform interruptions, maintenance, or cyber-attacks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.6 Exception: Gross Negligence</h3>
      <p className="mb-4">Limitations do not apply to Local Cooks&apos; gross negligence, willful misconduct, or specific data breach failures.</p>

      <hr className="my-8" />

      {/* SECTION 15 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">15. MISCELLANEOUS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.1 Governing Law &amp; Jurisdiction</h3>
      <p className="mb-4">These Terms are governed by the laws of Newfoundland &amp; Labrador. Disputes are resolved via binding arbitration in St. John&apos;s.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.2 Entire Agreement</h3>
      <p className="mb-4">These Terms, the Privacy Policy, and individual Rental Agreements constitute the entire agreement between users and Local Cooks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.3 Amendment &amp; Updates</h3>
      <p className="mb-4">Local Cooks may update these Terms at any time. Continued use of the Platform after notification constitutes acceptance of updated Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.4 Severability</h3>
      <p className="mb-4">If any provision is found invalid, it will be severed, and the remaining provisions will remain in full force and effect.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.5 No Waiver</h3>
      <p className="mb-4">Failure to enforce any right does not constitute a waiver of that right or any subsequent rights.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.6 Assignment</h3>
      <p className="mb-4">Users may not assign their rights without consent. Local Cooks may assign rights to a successor in the event of a merger or sale.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.7 Notices</h3>
      <p className="mb-4">Notices are delivered via email, postal mail, or in person at Local Cooks&apos; office in Paradise, NL.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.8 Force Majeure</h3>
      <p className="mb-4">Neither party is liable for failures caused by natural disasters or other circumstances beyond reasonable control. Payment obligations are not excused.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.9 Relationship of Parties</h3>
      <p className="mb-4">Local Cooks is an independent contractor, and no user is an employee, agent, or partner of Local Cooks.</p>

      <hr className="my-8" />

      {/* SECTION 16 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">16. ACKNOWLEDGMENT &amp; ACCEPTANCE</h2>
      <p className="mb-4">By registering an account and/or making a Booking, you acknowledge and agree that you:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Have read and understood these Terms and Conditions in their entirety.</li>
        <li>Agree to be bound by all terms, conditions, and provisions herein.</li>
        <li>Understand that you are assuming all risks associated with using the Platform and the Kitchen.</li>
        <li>Understand that you are waiving certain legal rights (including the right to sue in court).</li>
        <li>Represent that you possess all necessary licenses, permits, certifications, and insurance.</li>
        <li>Accept personal responsibility for food safety, regulatory compliance, and any injuries or damage.</li>
        <li>Release Local Cooks and other users from liability to the fullest extent permitted by law.</li>
        <li>Indemnify and defend the other party from all third-party claims arising from your conduct.</li>
        <li>Understand that failure to comply may result in suspension, termination, and legal liability.</li>
        <li>Agree to submit disputes to binding arbitration rather than court litigation.</li>
      </ul>

      <p className="text-center font-bold mt-12 mb-4">END OF TERMS &amp; CONDITIONS</p>
      
      <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 mt-8">
        <h3 className="text-lg font-bold mb-2">Questions? Contact Local Cooks:</h3>
        <p className="text-sm mb-1"><strong>Email:</strong> support@localcook.shop</p>
        <p className="text-sm mb-1"><strong>Phone:</strong> +1 (709)-631-8480</p>
        <p className="text-sm mb-1"><strong>Website:</strong> www.localcooks.ca</p>
        <p className="text-sm"><strong>Mailing Address:</strong> 4 Priscilla Place, Paradise, Newfoundland and Labrador, A1L 1E6, Canada</p>
        
        <p className="text-xs text-gray-500 mt-4 italic">
          Document Version: 1.0 | Effective Date: 01-02-2026 | Jurisdiction: Newfoundland &amp; Labrador, Canada
        </p>
      </div>

      <div className="mt-8 p-4 border-l-4 border-yellow-400 bg-yellow-50 text-xs text-gray-700">
        <p className="font-bold mb-2 uppercase text-yellow-800">Important Disclaimer</p>
        <p>These Terms &amp; Conditions are provided for Local Cooks and should be reviewed by a lawyer licensed in Newfoundland &amp; Labrador before use. This document is not legal advice. Specific food safety, tax, insurance, and liability laws vary by jurisdiction and may change. Local Cooks must ensure full compliance with current legislation, including but not limited to the Food Premises Act, Health and Community Services Act, Consumer Protection Act, Personal Information Protection Act, and PIPEDA. Consult with legal counsel and tax professionals before launching the platform.</p>
      </div>
    </div>
  );
}
