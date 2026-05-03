import React from "react";

/**
 * Reusable Terms of Service content component.
 * Used standalone on the Terms page and inline in the TermsAcceptanceScreen.
 */
export default function TermsContent() {
  return (
    <div className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold mb-4">LOCAL COOKS PLATFORM COMPREHENSIVE TERMS &amp; CONDITIONS</h1>
      <p className="mb-4">
        These Terms and Conditions form a legally binding agreement between Jawrophi Delivery Inc., operating as &ldquo;Local Cooks&rdquo; (collectively, &ldquo;Local Cooks&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) and you, the Kitchen Owner or Chef using the Platform.
      </p>
      <p className="text-sm text-gray-600 mb-2">
        <strong>St. John&apos;s, Newfoundland &amp; Labrador</strong><br />
        <strong>Effective Date:</strong> 01-02-2026<br />
        <strong>Last Updated:</strong> 01-05-2026<br />
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
      </ol>

      <hr className="my-8" />

      {/* SECTION 1 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">1. DEFINITIONS</h2>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>&quot;Local Cooks&quot; or &quot;Platform&quot;:</strong> The web/mobile application and marketplace operated by Jawrophi Delivery Inc., operating as &ldquo;Local Cooks&rdquo;, that facilitates bookings between Kitchen Owners and Chefs.</li>
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
      <ul className="list-disc pl-6 mb-4">
        <li>Hold a valid, unexpired Food Premises Licence issued by Service NL for a fixed food premises OR have an approved plan for obtaining one within 30 days of listing request. Proof of licence (or application confirmation) must be provided.</li>
        <li>Own, lease, or have documented authority to list and rent the Kitchen. Local Cooks may request proof (deed, lease, property manager authorization, etc.).</li>
        <li>
          Certify compliance with Applicable Law, including but not limited to:
          <ul className="list-disc pl-6 mt-2">
            <li>Building code, fire code, zoning, occupancy permits</li>
            <li>Water supply and sewage standards</li>
            <li>Equipment maintenance and food safety standards</li>
            <li>No outstanding violations, suspensions, or delinquencies with regulatory bodies</li>
          </ul>
        </li>
        <li>Be of legal age (18+ in Canada) and of sound legal capacity.</li>
        <li>Agree to conduct background screening if requested by Local Cooks for fraud/safety purposes (per privacy laws).</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">3.2 Chef Eligibility</h3>
      <p className="mb-4">To book a Kitchen on Local Cooks, the Chef must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Hold a valid Food Handler Certification (or equivalent food safety training) issued by an approved provider. Proof must be provided before first booking.</li>
        <li>
          Hold all required food business permits/licenses for the food product(s) they intend to prepare. This may include:
          <ul className="list-disc pl-6 mt-2">
            <li>A Health Permit / Food Business Licence from the Provincial Health Authority (if preparing for retail sale)</li>
            <li>Municipal business registration (if operating in St. John&apos;s)</li>
            <li>Proof that their intended food products are legally permissible in a commercial kitchen</li>
          </ul>
        </li>
        <li>
          Agree to operate legally and ethically, including:
          <ul className="list-disc pl-6 mt-2">
            <li>No preparation of prohibited foods (e.g., foods requiring specialized facilities or licensing)</li>
            <li>No home-based business expansion without proper conversion/licensing</li>
            <li>No misrepresentation of product origin or safety credentials</li>
          </ul>
        </li>
        <li>Be of legal age (18+ in Canada) and of sound legal capacity.</li>
        <li>Agree to conduct background screening if requested by Local Cooks (per privacy laws).</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">3.3 Onboarding &amp; Verification Process</h3>

      <p className="mb-2 font-semibold">Kitchen Owner Onboarding:</p>
      <p className="mb-2">Local Cooks will require and verify the following before a Kitchen is listed as &quot;Active&quot;:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Food Premises Licence (copy, expiry date, renewal dates)</li>
        <li>Building occupancy permit or zoning verification (St. John&apos;s)</li>
        <li>Signed Kitchen Owner Terms &amp; Conditions (this document)</li>
        <li>Kitchen photos/description for listing</li>
        <li>Owner contact information and emergency contact</li>
        <li>Cancellation/no-show policy preferences</li>
        <li>Equipment list and any equipment restrictions</li>
      </ul>

      <p className="mb-2 font-semibold">Kitchen Owner Annual Re-Verification:</p>
      <p className="mb-4">Local Cooks will request updated Food Premises Licence and insurance certificates annually. If not provided within 30 days of request, the Kitchen listing will be automatically suspended until documentation is provided.</p>

      <p className="mb-2 font-semibold">Chef Onboarding:</p>
      <p className="mb-2">Local Cooks will require and verify the following before a Chef may make a booking:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Food Handler Certification (copy, expiry date)</li>
        <li>Proof of food business licence/permit (if required for their food product)</li>
        <li>Proof of General/Product Liability Insurance (min $1M&ndash;$2M per occurrence) naming the Kitchen Owner as additional insured, where required by the Kitchen Owner</li>
        <li>Signed Chef Terms &amp; Conditions (this document)</li>
        <li>Chef contact information and emergency contact</li>
        <li>Food product description (type, ingredients, allergens)</li>
        <li>Experience/background in food preparation (brief description)</li>
      </ul>

      <p className="mb-2 font-semibold">Local Cooks Verification Scope:</p>
      <p className="mb-2">Local Cooks will verify the validity and non-expiry of documents provided, but will NOT:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Conduct independent food safety inspections</li>
        <li>Verify accuracy of information provided</li>
        <li>Monitor ongoing regulatory compliance between verifications</li>
        <li>Conduct criminal background checks (unless Privacy Act permits)</li>
      </ul>
      <p className="mb-4">By submitting documents, both Owners and Chefs represent and warrant that all information is true, accurate, and complete.</p>

      <hr className="my-8" />

      {/* SECTION 4 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">4. KITCHEN OWNER (HOST) TERMS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Listing Creation &amp; Accuracy</h3>
      <p className="mb-4">Kitchen Owners grant Local Cooks a non-exclusive, non-transferable right to display their Kitchen listing on the Platform and related marketing channels.</p>
      <p className="mb-4">Kitchen Owners warrant that all listing information&mdash;including description, location, amenities, equipment, hours, restrictions, and pricing&mdash;is accurate, complete, and not misleading. Local Cooks may remove listings or suspend Owners for material misrepresentations.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Kitchen Access &amp; Condition</h3>
      <p className="mb-4">Kitchen Owners agree to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Grant Chefs access to the full Kitchen (all areas described in the listing) on the date/time specified in the Booking.</li>
        <li>Provide functioning, food-safe equipment as represented in the listing. If equipment fails mid-rental, Owner shall offer a refund or rescheduling option.</li>
        <li>Ensure Kitchen is clean, sanitary, pest-free, and in safe condition before each Chef arrival.</li>
        <li>Maintain all food service equipment to manufacturer specifications and Applicable Law.</li>
        <li>Provide hot and cold running water, adequate refrigeration, and cooking appliances as listed.</li>
        <li>Ensure fire safety systems (extinguishers, alarms) are functional.</li>
        <li>Provide or clearly state any equipment/resource restrictions.</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Rental Agreement with Chefs</h3>
      <p className="mb-4">Kitchen Owners must execute a written Rental Agreement with each Chef before Kitchen use. At minimum, the Rental Agreement must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>State rental period, hours, and fees</li>
        <li>List specific equipment included and any restrictions</li>
        <li>Define cleaning obligations and expected condition upon return</li>
        <li>Include indemnity clause requiring Chef to hold Kitchen Owner harmless from claims arising from Chef&apos;s use, food products, or negligence</li>
        <li>Require Chef to name Kitchen Owner as additional insured on Chef&apos;s insurance (where Chef insurance is required)</li>
        <li>Reserve Owner&apos;s right to inspect/enter during rental (with notice where practical)</li>
        <li>Specify damage deposit, damage liability, and remedies</li>
        <li>Address cancellation, no-show, and dispute resolution terms</li>
      </ul>
      <p className="mb-4">Sample language is available from Local Cooks, but Owners may customize with legal counsel.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.4 Insurance &amp; Liability</h3>
      <p className="mb-4"><strong>Kitchen Owner Insurance Expectations.</strong> Local Cooks strongly recommends that all Kitchen Owners maintain appropriate Commercial General Liability Insurance and Property Insurance for their premises and operations. The specific type and amount of insurance required for a particular Kitchen is determined by the Kitchen Owner and any Applicable Law.</p>
      <p className="mb-4">Kitchen Owners may choose to make proof of insurance a condition of listing their Kitchen on the Platform or a condition of allowing Chefs to book and use the Kitchen. Any such requirements must be disclosed in the Kitchen listing and/or the Rental Agreement.</p>
      <p className="mb-4"><strong>Additional Insured.</strong> Local Cooks may request that a Kitchen Owner name Local Cooks as an additional insured on the Kitchen Owner&apos;s Commercial General Liability policy. If this is required for a particular Kitchen, it will be communicated in writing and reflected in the Kitchen listing or Rental Agreement.</p>
      <p className="mb-4"><strong>Kitchen Owner Liability.</strong> Kitchen Owner remains fully responsible for complying with Applicable Law and for any injuries, property damage, or losses arising from the condition, maintenance, or operation of the Kitchen, as further described in this Section and Section 7.</p>
      <p className="mb-2 font-semibold">Kitchen Owner is fully liable for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>All injuries, death, or property damage caused by the Kitchen Owner&apos;s negligence or willful misconduct</li>
        <li>All injuries, death, or property damage caused by defective equipment, poor maintenance, or unsafe conditions</li>
        <li>All claims arising from the Kitchen Owner&apos;s failure to comply with Applicable Law</li>
        <li>All claims arising from the Kitchen Owner&apos;s breach of these Terms</li>
      </ul>
      <p className="mb-4">Kitchen Owner shall indemnify and hold harmless Local Cooks, its officers, employees, and agents from all claims, losses, damages, and costs (including reasonable attorneys&apos; fees) arising from Kitchen Owner&apos;s operation of the Kitchen or breach of these Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.5 Food Safety Compliance</h3>
      <p className="mb-2">Kitchen Owners must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Maintain a valid, non-suspended Food Premises Licence at all times.</li>
        <li>Cooperate fully with food safety inspectors and provide Local Cooks with copies of any inspection reports or violation notices within 5 business days.</li>
        <li>Immediately notify Local Cooks if the Food Premises Licence is suspended, revoked, or placed under conditions.</li>
        <li>Maintain kitchen sanitation, temperature control, and equipment per Food Premises Regulations.</li>
        <li>Require at least one Food Handler Certified staff member on premises at all times when food preparation is occurring.</li>
        <li>Not allow any Chef to operate without proof of Food Handler Certification.</li>
        <li>Ensure Chefs&apos; food products comply with Applicable Law (e.g., approved menu items, proper labeling, allergen disclosure).</li>
      </ul>
      <p className="mb-2 font-semibold">Upon License Suspension or Revocation:</p>
      <p className="mb-4">If a Kitchen Owner&apos;s Food Premises Licence is suspended or revoked, Local Cooks will immediately and automatically suspend or remove the Kitchen listing and notify all affected Chefs. Suspended Kitchens cannot be re-listed until the Food Premises Licence is reinstated.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.6 Inspection Rights</h3>
      <p className="mb-2">Local Cooks reserves the right, without prior notice, to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Request updated documentation (licenses, insurance, inspection reports) at any time</li>
        <li>Remove or suspend a Kitchen listing if requested documentation is not provided within 7 days</li>
        <li>Work with regulatory authorities (provincial food safety inspectors, municipal health officials) to verify Kitchen compliance</li>
      </ul>
      <p className="mb-4">Regulatory inspections by provincial/municipal authorities shall proceed without Local Cooks&apos; intervention. Kitchen Owners are responsible for coordinating with inspectors.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.7 Reservation &amp; Cancellation Policies</h3>
      <p className="mb-2">Kitchen Owners may set their own cancellation policies (within reason), such as:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>No cancellations:</strong> Non-refundable bookings</li>
        <li>Full refund if cancelled &gt;7 days in advance</li>
        <li>Partial refund (e.g., 50%) if cancelled 3&ndash;7 days in advance</li>
        <li>No refund if cancelled &lt;24 hours</li>
      </ul>
      <p className="mb-4">Policies must be clearly stated in the Kitchen listing and Booking confirmation. Local Cooks will facilitate refunds per the stated policy.</p>
      <p className="mb-4">Kitchen Owners who frequently cancel or no-show may face suspension of listing or account termination.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.8 Damage Deposits &amp; Damage Claims</h3>
      <p className="mb-4"><strong>Damage Deposits.</strong> Kitchen Owners may require a refundable damage deposit for a Booking. Where a deposit applies, it will be disclosed in the Kitchen listing or at checkout. Unless otherwise stated, any unused portion of the deposit will be released within a reasonable time after the Booking ends, once any damage assessments are complete.</p>

      <p className="mb-4"><strong>Checkout review and auto-clear.</strong> After a Chef checks out, Local Cooks may provide Kitchen Owners with a limited review period (for example, a few hours) to inspect the Kitchen and storage areas before the Booking is auto-cleared in the system. Once this review window closes and the Booking is auto-cleared, new damage discovered afterwards may only be eligible for platform-facilitated claims if still within the separate Damage Claim Window described below.</p>

      <p className="mb-2"><strong>Damage Claim Window and limits.</strong> Local Cooks provides Kitchen Owners with a limited window after a Booking ends during which they can submit damage claims through the Platform (&ldquo;Damage Claim Window&rdquo;). Only Bookings falling within that window (for example, up to 14 days after the Booking end) will appear as eligible when creating a claim. Local Cooks may also apply platform-wide limits on:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The minimum and maximum amounts that can be claimed per damage claim (for example, between a stated minimum such as $10 and a stated maximum such as $5,000); and</li>
        <li>The maximum number of claims that may be filed per Booking (for example, up to 3 claims per Booking).</li>
      </ul>
      <p className="mb-4">The current Damage Claim Window and claim limits will be displayed in the damage claim settings in the Platform and may be updated by Local Cooks from time to time.</p>

      <p className="mb-2"><strong>Filing a claim.</strong> To submit a platform-facilitated damage claim, a Kitchen Owner must use the damage claim tools in the Platform and provide:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The relevant Booking;</li>
        <li>A clear title and description of the alleged damage;</li>
        <li>The claimed amount (within the applicable claim limits);</li>
        <li>The date the damage occurred or was discovered; and</li>
        <li>Supporting evidence, which may include photos, videos, invoices, and/or repair or replacement estimates.</li>
      </ul>
      <p className="mb-4">Local Cooks may reject or return incomplete or unsupported claims.</p>

      <p className="mb-4"><strong>Chef notification and response.</strong> When a Kitchen Owner submits a damage claim, Local Cooks will notify the Chef and provide a fixed response period (for example, 72 hours) to accept, pay, dispute, or provide additional information. If the Chef does not respond within the stated time, Local Cooks may treat the claim as undisputed for the purpose of facilitating payment, subject to Applicable Law and the available claim limits.</p>

      <p className="mb-2"><strong>Platform review and decision.</strong> Local Cooks may review the Booking details, messages, evidence, and any responses and, in its discretion, may:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Facilitate a payment from Chef to the Kitchen Owner (including by charging Chef&apos;s payment method and transferring funds up to the applicable limits);</li>
        <li>Approve part of a claim and facilitate a partial payment;</li>
        <li>Decline to process a claim; or</li>
        <li>Refer the parties to resolve the matter directly or through their insurers.</li>
      </ul>
      <p className="mb-4">Local Cooks&apos; decision regarding platform-facilitated claims is final with respect to any amounts processed through the Platform, but does not limit any rights the Kitchen Owner or Chef may have against each other outside the Platform under Applicable Law.</p>

      <p className="mb-4"><strong>Claims outside the Platform.</strong> If a Kitchen Owner does not file a claim within the Damage Claim Window, if the claimed amount exceeds platform limits, or if Local Cooks declines to process a claim, the Kitchen Owner may pursue any available remedies directly against Chef, subject to these Terms and Applicable Law. In such cases, Local Cooks has no obligation to assist with or enforce any outcome.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">4.9 Payment &amp; Payout</h3>
      <p className="mb-2">Local Cooks will:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Collect Chef&apos;s rental payment via Stripe or similar secure payment processor</li>
        <li>Remit Kitchen Owner&apos;s share (e.g., 80&ndash;85%) within 5&ndash;7 business days of rental completion</li>
      </ul>
      <p className="mb-4">Kitchen Owner may not charge Chefs directly or circumvent the Platform for payment; doing so may result in account suspension.</p>

      <hr className="my-8" />

      {/* SECTION 5 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">5. CHEF/USER (RENTER) TERMS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.1 Booking &amp; Reservation</h3>
      <p className="mb-4">By submitting a Booking request, Chef agrees to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Rent the Kitchen for the specified date, time, and fee</li>
        <li>Provide accurate information about the food product(s) to be prepared</li>
        <li>Disclose all major allergens and ingredients in food products</li>
        <li>Use the Kitchen only for the stated purpose and for the stated duration</li>
        <li>Not sublicense, share, or transfer Kitchen access to others without written Owner consent</li>
        <li>Not use the Kitchen for purposes other than food preparation for commercial sale</li>
      </ul>
      <p className="mb-2 font-semibold">Booking Confirmation:</p>
      <p className="mb-4">A Booking is confirmed when Chef receives an acceptance email from the Kitchen Owner through Local Cooks. Local Cooks facilitates this communication but is not a party to the Kitchen rental agreement.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.2 Food Safety &amp; Legal Compliance</h3>
      <p className="mb-2">Chefs must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Hold a valid Food Handler Certification (or equivalent) from an accredited provider. Proof must be current and non-expired.</li>
        <li>Operate only with valid food business permits/licenses required by Newfoundland &amp; Labrador (Provincial Health Authority, municipality, etc.).</li>
        <li>Disclose all major allergens and ingredients in food products to the Kitchen Owner.</li>
        <li>Comply with all Applicable Law regarding food preparation, packaging, labeling, storage, and sale.</li>
        <li>Follow the Food Premises Regulations and all kitchen-specific rules provided by Kitchen Owner.</li>
        <li>Prepare, handle, store, and transport food under sanitary conditions to prevent contamination.</li>
        <li>Use only single-service food contact surfaces (unless approved otherwise) and avoid cross-contamination.</li>
        <li>Maintain proper food temperatures (hot foods &ge;63&deg;C, cold foods &le;4&deg;C).</li>
        <li>Wear appropriate clothing (hair restraint, clean clothing, no exposed jewelry) while food preparation occurs.</li>
        <li>Not allow any person who is ill or has infected skin lesions to handle food.</li>
        <li>Not use tobacco while preparing food.</li>
      </ul>
      <p className="mb-2 font-semibold">Food Product Pre-Approval:</p>
      <p className="mb-4">If the Kitchen Owner requires Chef to obtain pre-approval of specific food products (e.g., for licensing/process verification), Chef must submit product description, ingredients, and process details for Owner review before rental date. Unapproved products may not be prepared in the Kitchen.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.3 Kitchen Use &amp; Rules</h3>
      <p className="mb-2">Chefs must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Arrive no earlier than 15 minutes before scheduled rental start time</li>
        <li>Depart no later than the scheduled rental end time (additional hourly fees apply for overstays)</li>
        <li>Use ONLY the Kitchen areas specified in the Booking (e.g., do not access private areas or other renters&apos; storage)</li>
        <li>Operate only the equipment specified in the Booking; do not remove, alter, or repair equipment</li>
        <li>Follow all Kitchen-specific rules provided by Kitchen Owner (safety, equipment operation, parking, entry/exit, etc.)</li>
        <li>Not make any modifications, installations, or changes to the Kitchen without prior written Owner consent</li>
        <li>Not sublet, share, or allow unauthorized persons to access the Kitchen during rental time</li>
        <li>Supervise all employees/staff working in the Kitchen; Chef is solely responsible for their conduct</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.4 Overstays, Storage &amp; Late Checkout</h3>
      <p className="mb-4"><strong>Definition of Overstay.</strong> If a Chef does not fully vacate the Kitchen and remove all equipment, ingredients, and stored items by the Booking end time, the Chef will be considered to have overstayed. For any overstay period, Chef remains bound by these Terms and is fully responsible for safety, compliance, and any damage caused.</p>
      <p className="mb-4"><strong>Location and listing-level policies.</strong> Kitchen Owners may set their own overstay and storage policies for a Kitchen, including grace periods, daily penalty rates, maximum penalty days, and any additional handling or storage fees. Where a Kitchen Owner has set such policies, they must be disclosed in the Kitchen listing and/or during the checkout or storage-booking flow and will take priority over any platform-wide default settings.</p>
      <p className="mb-2"><strong>Platform-wide defaults.</strong> Where a Kitchen Owner has not set custom values, Local Cooks may apply platform-wide default settings for storage and overstay penalties, including:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>A grace period (for example, 3 days) after the Booking end before penalties begin to accrue;</li>
        <li>A daily penalty rate calculated as a percentage of the applicable daily storage or rental rate for each day (or part day) of overstay (for example, 10% per overdue day); and</li>
        <li>A maximum number of penalty days (for example, 30 days) after which penalties stop accruing.</li>
      </ul>
      <p className="mb-4">The current default values in effect at the time of Booking will be displayed in the Platform&apos;s settings or in the Booking summary and may be updated by Local Cooks from time to time.</p>
      <p className="mb-4"><strong>Auto-charging and escalation.</strong> Chef authorizes Local Cooks to calculate and charge overstay penalties to Chef&apos;s payment method on file on behalf of the Kitchen Owner. If an automatic charge fails, Local Cooks may immediately escalate the penalty (for example, by sending a self-serve payment link, pausing Chef&apos;s ability to make new Bookings, and/or referring the matter to the dispute and collections process described in these Terms). Local Cooks has no obligation to re-attempt automatic charges.</p>
      <p className="mb-4"><strong>No tenancy rights.</strong> Overstays do not create any tenancy, lease, or occupancy rights in favour of Chef. Local Cooks and the Kitchen Owner reserve all rights and remedies available under these Terms and Applicable Law, including seeking additional compensation for losses caused by an overstay.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.5 Cleaning &amp; Sanitation</h3>
      <p className="mb-2">Chef must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Leave the Kitchen in clean, sanitary, orderly condition at the end of the rental period, equivalent to condition upon arrival</li>
        <li>Clean and sanitize all food contact surfaces, equipment, and utensils used</li>
        <li>Empty all trash, compost, and recycling into designated receptacles</li>
        <li>Mop floors and wipe down counters, sinks, and stove</li>
        <li>Clean inside refrigerators/freezers if used</li>
        <li>Clean any spills immediately to prevent slipping hazards or pest attraction</li>
        <li>Complete a Cleaning Checklist (provided by Kitchen Owner or Local Cooks) confirming tasks completed</li>
      </ul>
      <p className="mb-2">Failure to clean adequately may result in:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Loss of damage deposit</li>
        <li>Cleaning fee charged to Chef&apos;s payment account (typically $100&ndash;$300)</li>
        <li>Suspension of Chef&apos;s ability to book in future</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.6 Insurance &amp; Liability</h3>
      <p className="mb-4"><strong>Chef Insurance Expectations.</strong> Chefs are responsible for ensuring they have appropriate insurance for their food operations. Whether insurance is required as a condition of booking is determined by the Kitchen Owner and Applicable Law.</p>
      <p className="mb-4">Some Kitchens will require Chefs to carry and provide proof of General or Product Liability Insurance (and, where applicable, Workers&apos; Compensation Insurance) before a booking is accepted. Where a Kitchen Owner requires such coverage, this requirement will be disclosed in the Kitchen listing and/or Rental Agreement, and Chef must provide acceptable proof of insurance before using that Kitchen and maintain such coverage for the duration of use.</p>
      <p className="mb-4">Where a Kitchen Owner does not require insurance, Chef is still strongly encouraged to maintain appropriate coverage for their operations and remains fully responsible for any injuries, illnesses, property damage, or other losses caused by Chef&apos;s food products, staff, or activities in the Kitchen.</p>
      <p className="mb-2 font-semibold">Chef is fully liable for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>All injuries, death, or property damage caused by Chef&apos;s negligence or willful misconduct</li>
        <li>All injuries, death, or property damage caused by Chef&apos;s food products (foodborne illness, allergic reactions, contamination)</li>
        <li>All injuries, death, or property damage caused by Chef&apos;s employees or staff</li>
        <li>All property damage to the Kitchen caused by Chef&apos;s use or negligence</li>
        <li>All violations of Applicable Law or Kitchen rules caused by Chef</li>
        <li>All claims arising from Chef&apos;s failure to comply with these Terms</li>
      </ul>
      <p className="mb-2">Chef shall indemnify and hold harmless Kitchen Owner and Local Cooks, their officers, employees, and agents from all claims, losses, damages, costs, and expenses (including reasonable attorneys&apos; fees) arising from:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Chef&apos;s use of the Kitchen</li>
        <li>Chef&apos;s food products or food safety practices</li>
        <li>Chef&apos;s employees or staff</li>
        <li>Chef&apos;s breach of these Terms or Applicable Law</li>
        <li>Any injury to third parties (e.g., Chef&apos;s customers) caused by Chef&apos;s food or operations</li>
      </ul>
      <p className="mb-4">Chefs may wish to discuss with their insurance broker whether to add the Kitchen Owner and/or Local Cooks as additional insureds on their policies. This is optional unless expressly required by a Kitchen Owner or by Local Cooks in writing.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.7 No Liability for Third-Party Injuries or Food Safety</h3>
      <p className="mb-2">Chef acknowledges that Local Cooks and the Kitchen Owner are NOT liable for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Any injury or illness caused by food prepared by Chef</li>
        <li>Any injury or illness caused by Chef&apos;s handling, storage, or preparation practices</li>
        <li>Any property damage caused by Chef&apos;s use of equipment or the Kitchen</li>
        <li>Any violations of Applicable Law by Chef</li>
        <li>Any claims by third parties (e.g., Chef&apos;s customers or Chef&apos;s employees)</li>
      </ul>
      <p className="mb-4">Chef assumes all risk of preparing food in the Kitchen and is solely responsible for food safety, ingredient quality, and compliance with food science and labeling requirements.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.8 Incident Reporting</h3>
      <p className="mb-2">Chef must immediately report to Kitchen Owner (and Local Cooks within 24 hours) any:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Injuries to Chef or staff</li>
        <li>Allergic reactions or foodborne illness complaints from customers</li>
        <li>Equipment damage or malfunction</li>
        <li>Health and safety hazards observed in Kitchen</li>
        <li>Spills, contamination, or sanitation issues</li>
      </ul>
      <p className="mb-4">Prompt reporting helps document incidents and allows Kitchen Owner to take corrective action.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">5.9 Non-Circumvention Agreement</h3>
      <p className="mb-2">Chef agrees NOT to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Obtain Kitchen Owner&apos;s contact information from the Platform and contact Owner directly to bypass Local Cooks and avoid Platform fees</li>
        <li>Arrange future bookings with Kitchen Owner outside of Local Cooks Platform</li>
        <li>Recommend to other Chefs that they contact Kitchen Owner directly to avoid the Platform fee</li>
      </ul>
      <p className="mb-2">Violation of this clause may result in:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Chef account suspension or termination</li>
        <li>Dispute regarding any Platform fees owed</li>
        <li>Legal action to recover Platform fees (which may exceed the single transaction value)</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 6 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">6. INSURANCE REQUIREMENTS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Chef Insurance Summary</h3>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full border border-gray-300 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border border-gray-300 px-3 py-2 text-left">Coverage Type</th>
              <th className="border border-gray-300 px-3 py-2 text-left">Minimum Limit</th>
              <th className="border border-gray-300 px-3 py-2 text-left">Key Provisions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 px-3 py-2">General or Product Liability</td>
              <td className="border border-gray-300 px-3 py-2">$1M per occurrence</td>
              <td className="border border-gray-300 px-3 py-2">Must name Kitchen Owner as additional insured where required; primary, non-contributory</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2">Workers&apos; Compensation (if applicable)</td>
              <td className="border border-gray-300 px-3 py-2">Statutory limits (per province)</td>
              <td className="border border-gray-300 px-3 py-2">Mandatory if Chef has employees; depends on provincial legislation</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2">Food Borne Illness</td>
              <td className="border border-gray-300 px-3 py-2">Industry standard</td>
              <td className="border border-gray-300 px-3 py-2">Recommended if preparing potentially hazardous foods</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Certificate of Insurance</h3>
      <p className="mb-2">Both Kitchen Owners and Chefs must provide, where insurance is required:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Certificate of Insurance</strong> (issued by broker or insurer) evidencing the required coverage</li>
        <li><strong>Proof of Additional Insured endorsement</strong> (e.g., ISO CG 20 01 for liability, or policy schedule)</li>
        <li><strong>Non-cancellation notice</strong> (at least 10 days&apos; notice to Local Cooks if policy is cancelled or non-renewed)</li>
      </ul>
      <p className="mb-4">Certificates are valid for one year. Local Cooks will request updated certificates annually.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.3 Insurance Verification</h3>
      <p className="mb-2">Local Cooks will verify that:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Certificate is issued by a licensed insurance broker/insurer</li>
        <li>Coverage limits meet minimums</li>
        <li>Additional insured endorsement is present</li>
        <li>Certificate has not expired</li>
      </ul>
      <p className="mb-2">Local Cooks will NOT:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Verify that insurance is active or has been paid</li>
        <li>Contact insurers independently to confirm coverage</li>
        <li>Assess adequacy of coverage for specific risks</li>
        <li>Provide insurance advice</li>
      </ul>
      <p className="mb-4">Both parties are responsible for ensuring their insurance is active and adequate.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.4 Waiver of Subrogation</h3>
      <p className="mb-2">Both Kitchen Owners and Chefs grant each other and Local Cooks a waiver of subrogation rights. This means:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>If a Chef is injured in the Kitchen and their insurance covers the injury, the Chef&apos;s insurer waives the right to sue the Kitchen Owner for reimbursement.</li>
        <li>Conversely, if the Kitchen Owner causes property damage to the Chef&apos;s equipment, the Kitchen Owner&apos;s insurer waives the right to sue the Chef.</li>
      </ul>
      <p className="mb-4">This mutual waiver reduces claim disputes and fosters cooperation.</p>

      <hr className="my-8" />

      {/* SECTION 7 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">7. LIABILITY &amp; INDEMNIFICATION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.1 Local Cooks&apos; Limited Liability</h3>
      <p className="mb-2">Local Cooks does NOT assume liability for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The condition, safety, or regulatory compliance of any Kitchen</li>
        <li>The quality, safety, or legality of food prepared in any Kitchen</li>
        <li>Any injuries, illnesses, or property damage occurring in any Kitchen</li>
        <li>Any breach by Kitchen Owner or Chef of Applicable Law</li>
        <li>Any foodborne illness or allergic reactions caused by food products</li>
        <li>Any equipment failure or malfunction in any Kitchen</li>
        <li>Any third-party claims (e.g., Chef&apos;s customer claims)</li>
        <li>Any business losses, lost profits, or interruption caused by Kitchen unavailability</li>
        <li>Any cyber-attacks, data breaches, or platform downtime</li>
        <li>Any acts or omissions of Kitchen Owners, Chefs, or third parties</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.2 Chef Indemnity to Kitchen Owner</h3>
      <p className="mb-2">Chef shall indemnify, defend (at Chef&apos;s expense), and hold harmless Kitchen Owner and all Kitchen Owner affiliates, officers, employees, agents, and representatives from and against all claims, lawsuits, damages, liabilities, costs, and expenses (including reasonable attorneys&apos; fees and court costs) arising from or related to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Chef&apos;s use of the Kitchen or food products prepared by Chef</li>
        <li>Chef&apos;s breach of these Terms or Applicable Law</li>
        <li>Injury to any person (including Chef&apos;s staff, customers, or third parties) caused by Chef&apos;s actions or food</li>
        <li>Property damage to the Kitchen or Kitchen Owner&apos;s equipment caused by Chef</li>
        <li>Chef&apos;s negligence, willful misconduct, or violation of food safety regulations</li>
        <li>Any foodborne illness, allergic reaction, or contamination claim related to Chef&apos;s food</li>
      </ul>
      <p className="mb-4">This indemnity survives termination of the Booking and survives Local Cooks&apos; involvement.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.3 Kitchen Owner Indemnity to Chef</h3>
      <p className="mb-2">Kitchen Owner shall indemnify, defend (at Owner&apos;s expense), and hold harmless Chef and all Chef affiliates, officers, employees, agents, and representatives from and against all claims, lawsuits, damages, liabilities, costs, and expenses (including reasonable attorneys&apos; fees and court costs) arising from or related to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The Kitchen condition, equipment, or facilities (including defective equipment, unsafe conditions, poor maintenance)</li>
        <li>Kitchen Owner&apos;s breach of these Terms or Applicable Law</li>
        <li>Injury to Chef caused by the Kitchen condition, equipment failure, or Kitchen Owner&apos;s negligence</li>
        <li>Any violation of food safety, building, or fire code requirements caused by Kitchen Owner</li>
        <li>Kitchen Owner&apos;s failure to maintain valid licensing, insurance, or permits</li>
      </ul>
      <p className="mb-4">This indemnity survives termination of the Booking and survives Local Cooks&apos; involvement.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.4 Local Cooks Indemnity (Limited)</h3>
      <p className="mb-2">Local Cooks shall indemnify Kitchen Owner and Chef from claims arising solely from:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Local Cooks&apos; gross negligence or willful misconduct in operating the Platform</li>
        <li>Local Cooks&apos; breach of these Terms (but NOT from third-party actions or food safety claims)</li>
        <li>Data breach or unauthorized access to Personal Information (if caused by Local Cooks&apos; security failure)</li>
      </ul>
      <p className="mb-2">Local Cooks does NOT indemnify for claims arising from:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Kitchen Owner or Chef conduct or negligence</li>
        <li>Food safety or foodborne illness claims</li>
        <li>Equipment or kitchen condition issues</li>
        <li>Third-party claims (e.g., customers&apos; complaints)</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.5 Mutual Cooperation on Claims</h3>
      <p className="mb-2">If a third party (e.g., a customer injured by Chef&apos;s food) sues both Kitchen Owner and Chef through Local Cooks:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Chef and Kitchen Owner shall cooperate fully in defending the claim</li>
        <li>Each shall share relevant information with the other&apos;s insurer</li>
        <li>Indemnities apply to the extent one party&apos;s conduct caused the injury (Chef if food-related; Owner if kitchen condition-related)</li>
        <li>If a court determines both parties are jointly liable, their insurers shall contribute proportionally</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 8 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">8. FOOD SAFETY &amp; LEGAL COMPLIANCE</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Newfoundland &amp; Labrador Food Premises Regulations</h3>
      <p className="mb-2">All Kitchens and food preparation must comply with:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Food Premises Regulations (Consolidated Newfoundland Regulation 1022/96) under the Food and Drug Act</li>
        <li>Health and Community Services Act</li>
        <li>Occupational Health &amp; Safety Act (for worker safety)</li>
        <li>Building Code (National Building Code as adopted by Newfoundland)</li>
        <li>Municipal bylaws (St. John&apos;s or applicable municipality)</li>
      </ul>
      <p className="mb-4">Copies of regulations are available from Service NL (www.gov.nl.ca) and must be reviewed by all Owners and Chefs.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Food Premises Licence Requirements</h3>
      <p className="mb-2">Kitchen Owner&apos;s Food Premises Licence must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Be valid and non-expired (as shown on the certificate)</li>
        <li>Cover the specific address and type of food operation listed on Local Cooks</li>
        <li>Have no outstanding violations, conditions, or suspensions (as of the most recent inspection)</li>
        <li>Be maintained in continuous good standing for the duration of Kitchen Owner&apos;s use of the Platform</li>
      </ul>
      <p className="mb-2">Kitchen Owner must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Provide a copy of the licence to Local Cooks at the time of listing and annually thereafter</li>
        <li>Notify Local Cooks within 24 hours if the licence is suspended, revoked, or placed under conditions</li>
        <li>Immediately cooperate with food safety inspectors and provide Local Cooks with inspection reports within 5 days</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.3 Food Handler Certification</h3>
      <p className="mb-2">At least one person present during food preparation in the Kitchen must hold a valid Food Handler Certification (or equivalent food safety training certificate) issued by an approved provider, such as:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Health Canada-approved online courses</li>
        <li>Canadian Food Safety Certification Board courses</li>
        <li>Alberta Health Services&apos; FoodSafe training</li>
        <li>Other accredited providers recognized in Newfoundland &amp; Labrador</li>
      </ul>
      <p className="mb-2">Both Kitchen Owner staff and Chefs must provide proof of certification to Local Cooks. Proof must include:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Certificate name and number</li>
        <li>Certificant&apos;s name (matching the person&apos;s identity)</li>
        <li>Issue and expiry dates</li>
        <li>Course provider name</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.4 Approved Food Products &amp; Processes</h3>
      <p className="mb-2">Kitchen Owner may restrict the types of food products prepared in the Kitchen. Common restrictions include:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>High-risk foods (potentially hazardous):</strong> Require special handling, temperature control, and hazard analysis</li>
        <li><strong>Meat and fish products:</strong> May require separate facilities or specific licensing</li>
        <li><strong>Allergen-prone foods:</strong> May require separate preparation areas and equipment</li>
        <li><strong>Foods requiring Scheduled Processes:</strong> Acidified foods (pickles, relishes, dressings, jams) may require additional licensing/process approval</li>
      </ul>
      <p className="mb-2">Chef must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Disclose the specific food product(s) planned for preparation (e.g., &quot;vegan chocolate mousse&quot; vs. &quot;raw ground meat patties&quot;)</li>
        <li>Obtain Kitchen Owner approval before the Booking if product type is not pre-approved</li>
        <li>Follow all food safety protocols specific to the product (time/temperature logs, allergen separation, etc.)</li>
        <li>Obtain any required regulatory approvals before preparation (e.g., if the product requires a Scheduled Process approval from a qualified processing authority)</li>
      </ul>
      <p className="mb-4">Local Cooks does not approve food products or processes. This is solely between Kitchen Owner and Chef.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.5 Temperature Control &amp; HACCP</h3>
      <p className="mb-2">Chefs must maintain proper food temperatures:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Hot foods:</strong> &ge;63&deg;C (145&deg;F) until service</li>
        <li><strong>Cold foods:</strong> &le;4&deg;C (40&deg;F) during storage and service</li>
        <li><strong>Freezer:</strong> &le;&minus;18&deg;C (0&deg;F)</li>
      </ul>
      <p className="mb-2">Chefs preparing potentially hazardous foods are recommended to implement Hazard Analysis and Critical Control Points (HACCP) principles:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Identify critical control points (e.g., cooking temperature, cooling time)</li>
        <li>Establish monitoring procedures (e.g., use of food thermometers)</li>
        <li>Maintain records/logs of critical temperatures</li>
        <li>Corrective actions if temperatures are out of range</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.6 Allergen Management</h3>
      <p className="mb-2">Chef must:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Disclose all major allergens in food products (peanuts, tree nuts, milk, eggs, soy, wheat, fish, shellfish, sesame, sulphites, mustard, celery, etc.)</li>
        <li>Label finished products with complete ingredient lists and allergen statements</li>
        <li>Prevent cross-contamination by using separate utensils, cutting boards, and surfaces for allergen-sensitive foods</li>
        <li>Inform customers of all allergens before sale</li>
      </ul>
      <p className="mb-4">Local Cooks and Kitchen Owner are NOT responsible for allergen accuracy; this is Chef&apos;s responsibility.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.7 Inspection Cooperation</h3>
      <p className="mb-2">If local/provincial food safety inspectors visit the Kitchen during Chef&apos;s rental:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Chef must cooperate fully with inspectors and answer all questions truthfully</li>
        <li>Chef must not obstruct or impede the inspection in any way</li>
        <li>Chef must remain on premises until the inspection is complete</li>
        <li>Chef must provide documentation (Food Handler Cert, product labels, process records) upon request</li>
      </ul>
      <p className="mb-2">Failure to cooperate may result in:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Inspection violations noted against the Kitchen&apos;s Food Premises Licence</li>
        <li>Health code citations or fines</li>
        <li>Potential license suspension or revocation</li>
        <li>Chef suspension from the Platform</li>
      </ul>
      <p className="mb-4">Kitchen Owner is responsible for Kitchen maintenance; Chef is responsible for food product safety during Chef&apos;s rental.</p>

      <hr className="my-8" />

      {/* SECTION 9 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">9. PAYMENTS, FEES &amp; TAXES</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.1 Rental Fees &amp; Pricing</h3>
      <p className="mb-4">Kitchen Owner sets the hourly rental fee for the Kitchen (e.g., $25/hour). This fee is displayed in the Kitchen listing and Booking confirmation.</p>
      <p className="mb-4">Chef agrees to pay the stated fee for the rental period booked. Overstay (use beyond the scheduled end time) will be charged at the hourly rate (prorated) or as stated in the Kitchen Owner&apos;s cancellation policy.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.2 Payment Processing &amp; Payout</h3>
      <p className="mb-2 font-semibold">Payment Flow:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Chef submits Booking and payment through Local Cooks (via Stripe or similar processor)</li>
        <li>Local Cooks verifies payment with the processor (typically 1&ndash;2 business days)</li>
        <li>Upon rental completion and Chef&apos;s confirmation (or automatic 24 hours post-rental): Local Cooks pays Kitchen Owner&apos;s share (e.g., 80&ndash;85%) within 5&ndash;7 business days</li>
        <li>Kitchen Owner receives payment to their designated bank account (e-transfer, direct deposit, etc.)</li>
      </ul>
      <p className="mb-2 font-semibold">Refunds:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>If Kitchen Owner cancels a Booking, the Chef is entitled to a full refund (processed within 5&ndash;7 business days)</li>
        <li>If Chef cancels per Kitchen Owner&apos;s stated cancellation policy, the refund amount depends on the policy (non-refundable, 50%, 100%, etc.)</li>
      </ul>
      <p className="mb-2 font-semibold">No Chargebacks:</p>
      <p className="mb-4">Chef agrees not to dispute or chargeback the payment with their credit card company unless Local Cooks fails to process the payment correctly. Fraudulent chargebacks may result in Chef account termination.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.3 HST/Sales Tax Obligations</h3>
      <p className="mb-2 font-semibold">Kitchen Owner Tax Responsibility:</p>
      <p className="mb-2">If Kitchen Owner&apos;s annual income from kitchen rentals exceeds $30,000 CAD, Owner must register for GST/HST with the Canada Revenue Agency (CRA) and collect/remit HST on rental fees.</p>
      <p className="mb-2">Local Cooks does NOT collect HST on behalf of Kitchen Owners. Kitchen Owner is solely responsible for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Determining HST registration requirement</li>
        <li>Registering with CRA if required</li>
        <li>Collecting HST from Chefs (by invoicing separately or including in stated fee)</li>
        <li>Remitting HST to CRA quarterly or as required</li>
        <li>Maintaining records of all rentals and HST collected</li>
        <li>Filing annual tax returns with CRA and provincial tax authority</li>
      </ul>
      <p className="mb-2 font-semibold">Chef Tax Responsibility:</p>
      <p className="mb-2">If Chef&apos;s annual food business revenue exceeds $30,000 CAD, Chef must register for GST/HST and remit on sales of food products. Chef is solely responsible for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Determining HST registration requirement</li>
        <li>Registering with CRA if required</li>
        <li>Collecting HST from customers if required</li>
        <li>Remitting HST to CRA</li>
        <li>Maintaining accurate business records</li>
        <li>Filing tax returns with CRA</li>
      </ul>
      <p className="mb-2 font-semibold">Local Cooks Tax Responsibility:</p>
      <p className="mb-2">Local Cooks&apos; Platform Fee is subject to HST. Local Cooks will:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Register for HST with CRA (if not already registered)</li>
        <li>Collect HST on Platform Fees where applicable</li>
        <li>Remit HST to CRA quarterly</li>
        <li>Provide tax reporting to Kitchen Owners annually (if applicable)</li>
      </ul>
      <p className="mb-2 font-semibold">No Tax Advice:</p>
      <p className="mb-2">Local Cooks does NOT provide tax or accounting advice. Both Kitchen Owners and Chefs should:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Consult with an accountant or tax professional about GST/HST obligations</li>
        <li>Keep detailed records of all bookings, fees, and income</li>
        <li>File accurate tax returns with CRA and provincial authorities</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.4 Overstay and Storage Fees</h3>
      <p className="mb-4">Any overstay and storage-related penalties and fees described in Section 5.4 form part of the Booking charges and may be collected and remitted by Local Cooks through the Platform in the same manner as other Booking and service fees.</p>

      <hr className="my-8" />

      {/* SECTION 10 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">10. ACCEPTABLE USE &amp; CONDUCT</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.1 Prohibited Conduct</h3>
      <p className="mb-2">Users agree NOT to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Use the Platform for any illegal purpose or violate Applicable Law</li>
        <li>Prepare or distribute food that is unsafe, contaminated, mislabeled, or misrepresented</li>
        <li>Discriminate against, harass, threaten, or abuse other users based on protected characteristics (race, gender, religion, disability, etc.)</li>
        <li>Engage in fraud, misrepresentation, or deception</li>
        <li>Access or use the Platform with automated tools (bots, scrapers) without permission</li>
        <li>Reverse-engineer, hack, or attempt to compromise the Platform&apos;s security</li>
        <li>Disrupt Platform operations or interfere with other users&apos; access</li>
        <li>Engage in any form of food tampering, contamination, or adulteration</li>
        <li>Operate without required licenses, permits, or certifications</li>
        <li>Sublicense, resell, or transfer Platform access to unauthorized parties</li>
        <li>Post false, defamatory, or malicious content in user profiles or reviews</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.2 Compliance with Laws</h3>
      <p className="mb-2">All users represent and warrant that:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>They are of legal age (18+) and of sound legal capacity</li>
        <li>They possess all necessary licenses, permits, and certifications required by Applicable Law</li>
        <li>They will comply with all federal, provincial, territorial, and municipal laws and regulations</li>
        <li>They will comply with food safety, health, building, fire, zoning, and labor laws</li>
        <li>They will not engage in any illegal activity</li>
        <li>Their use of the Platform does not violate any third-party rights or obligations</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.3 Monitoring &amp; Enforcement</h3>
      <p className="mb-2">Local Cooks may:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Monitor user conduct on the Platform and respond to complaints</li>
        <li>Request documentation (licenses, insurance, certifications) at any time</li>
        <li>Suspend or terminate accounts for violations of these Terms or Applicable Law</li>
        <li>Cooperate with law enforcement and regulatory authorities as required by law</li>
        <li>Remove content (messages, reviews, listings) that violates these Terms</li>
      </ul>
      <p className="mb-4">Local Cooks is NOT responsible for monitoring every interaction or ensuring 100% compliance. Users are responsible for their own conduct.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.4 Third-Party Claims &amp; Dispute Resolution</h3>
      <p className="mb-2">If a Chef&apos;s customer suffers foodborne illness or injury and files a claim against both Chef and Kitchen Owner:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Local Cooks will not mediate the claim (it is a legal matter between the parties and their insurers)</li>
        <li>Both parties should immediately notify their insurers and retain legal counsel if necessary</li>
        <li>Indemnities (Section 7) will govern who is ultimately responsible</li>
        <li>Local Cooks may be subpoenaed for information but is not a liable party</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 11 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">11. INTELLECTUAL PROPERTY &amp; DATA</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.1 Platform Intellectual Property</h3>
      <p className="mb-2">Local Cooks retains all rights to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The Platform website, mobile app, technology, and software</li>
        <li>All branding, logos, trademarks, and marketing materials</li>
        <li>All databases, algorithms, and business processes</li>
        <li>All user feedback and improvement suggestions</li>
      </ul>
      <p className="mb-4">Users grant Local Cooks a non-exclusive, royalty-free, perpetual right to use any feedback or suggestions for Platform improvement.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.2 User-Generated Content</h3>
      <p className="mb-2">Kitchen Owners and Chefs retain ownership of:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Kitchen photos and descriptions</li>
        <li>Food product descriptions and images</li>
        <li>Business names and branding</li>
      </ul>
      <p className="mb-2">By posting content on the Platform, users grant Local Cooks a non-exclusive, perpetual, royalty-free right to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Display content on the Platform and marketing materials</li>
        <li>Use content in promotional materials (with or without attribution)</li>
        <li>License content to partners or third-party services</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.3 Personal Information &amp; Privacy (Summary &mdash; see full Privacy Policy)</h3>
      <p className="mb-2">Local Cooks collects Personal Information (name, email, phone, address, payment info, food product details) to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Facilitate Bookings and communicate with users</li>
        <li>Process payments and prevent fraud</li>
        <li>Comply with legal obligations (e.g., tax reporting, food safety investigations)</li>
        <li>Improve Platform features</li>
      </ul>
      <p className="mb-2">Local Cooks will NOT:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Sell or rent Personal Information to third parties</li>
        <li>Share Personal Information except as required by law or to facilitate Bookings</li>
        <li>Use Personal Information for marketing without consent</li>
      </ul>
      <p className="mb-4">Users may access, correct, or delete their Personal Information by contacting Local Cooks (contact info in Section 15). See Local Cooks&apos; Privacy Policy for full details (linked on the Platform website).</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">11.4 Data Security (Summary)</h3>
      <p className="mb-4">Local Cooks uses industry-standard encryption (SSL/TLS) and security practices to protect Personal Information. However, no online system is 100% secure.</p>
      <p className="mb-2">Users are responsible for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Protecting their account login credentials</li>
        <li>Using secure passwords (at least 12 characters, mix of upper/lowercase, numbers, symbols)</li>
        <li>Not sharing login credentials with others</li>
        <li>Reporting unauthorized access immediately</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 12 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">12. DISPUTE RESOLUTION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">12.1 Communication &amp; Informal Resolution</h3>
      <p className="mb-2">If a dispute arises between Kitchen Owner and Chef (e.g., damage claim, booking cancellation, food quality):</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Both parties should communicate directly and attempt to resolve the dispute within 7 days</li>
        <li>Document the issue with photos, messages, or written records</li>
        <li>
          Contact Local Cooks if informal resolution fails, providing:
          <ul className="list-disc pl-6 mt-2">
            <li>Booking confirmation number</li>
            <li>Description of the dispute</li>
            <li>Supporting evidence (photos, messages, inspection reports, etc.)</li>
            <li>Requested resolution (refund, rescheduling, damage payment, etc.)</li>
          </ul>
        </li>
      </ul>
      <p className="mb-4">Local Cooks will review the dispute and attempt to mediate but is not obligated to intervene. Disputes are ultimately between the parties.</p>
      <p className="mb-4"><strong>Use of Platform Tools.</strong> For disputes related to damage, overstay penalties, or other Booking-specific charges, Kitchen Owners and Chefs agree to first use the Platform&apos;s tools and flows (including damage claims, overstay penalties, and messaging) and follow the applicable timelines before escalating to arbitration or court, except where immediate legal action is required to prevent expiry of a statutory limitation period.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">12.2 Binding Arbitration</h3>
      <p className="mb-4">Any dispute arising from these Terms or the use of the Platform will be resolved by binding arbitration, not by court litigation.</p>
      <p className="mb-2 font-semibold">Scope:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Arbitration applies to disputes between: (a) Chef and Kitchen Owner, (b) User and Local Cooks, (c) Kitchen Owner and Local Cooks</li>
        <li>Arbitration does NOT apply to disputes involving food safety or regulatory violations (these may be reported to authorities)</li>
      </ul>
      <p className="mb-2 font-semibold">Arbitration Process:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>
          <strong>Demand for Arbitration:</strong> Claimant submits written demand to respondent and Local Cooks, specifying:
          <ul className="list-disc pl-6 mt-2">
            <li>Names and contact info of parties</li>
            <li>Detailed description of the claim</li>
            <li>Requested relief (money amount, specific performance, etc.)</li>
            <li>Choice of arbitrator or arbitration organization</li>
          </ul>
        </li>
        <li><strong>Arbitrator Selection:</strong> Parties mutually select an arbitrator (e.g., retired judge, mediator) within 14 days. If no agreement, a neutral arbitrator is appointed per arbitration rules.</li>
        <li><strong>Arbitration Hearing:</strong> Hearing occurs within 30&ndash;60 days (may be in person, by phone, or by written submission). Each party presents evidence and arguments.</li>
        <li><strong>Arbitrator&apos;s Award:</strong> Arbitrator issues a written decision and award (typically within 14 days of hearing). Award is final and binding and may be enforced in any court of competent jurisdiction.</li>
        <li><strong>Costs:</strong> Each party pays its own attorneys&apos; fees and costs. Arbitrator&apos;s fees are split 50/50 unless the arbitrator orders otherwise.</li>
      </ul>
      <p className="mb-4"><strong>Alternative (Class Action Waiver).</strong> All parties agree that arbitration will be conducted on an individual basis only. Class action lawsuits or representative actions are not permitted. Each claim must be arbitrated separately.</p>

      <hr className="my-8" />

      {/* SECTION 13 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">13. TERMINATION &amp; ACCOUNT SUSPENSION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">13.1 Voluntary Termination by User</h3>
      <p className="mb-2">Kitchen Owners or Chefs may close their Local Cooks account at any time by:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Logging into their account and selecting &quot;Delete Account&quot; or &quot;Deactivate&quot;</li>
        <li>Confirming the decision via email</li>
        <li>Remaining outstanding obligations (refunds to Chefs, payments to Kitchen Owners, taxes) will be settled within 7&ndash;14 days</li>
      </ul>
      <p className="mb-2 font-semibold">Effect of Termination:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>User&apos;s listing/profile is removed from the Platform immediately</li>
        <li>Pending Bookings are cancelled and refunded per the Kitchen Owner&apos;s cancellation policy</li>
        <li>Outstanding disputes are referred to arbitration if unresolved</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">13.2 Suspension for Violation</h3>
      <p className="mb-2">Local Cooks may immediately suspend or terminate a user&apos;s account without prior notice if:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Food Safety Violation:</strong> The user&apos;s Food Premises Licence is suspended/revoked, or a food safety violation is confirmed by a regulatory authority</li>
        <li><strong>Insurance Lapse:</strong> User fails to maintain required insurance or provide current certificates</li>
        <li><strong>Fraud or Misrepresentation:</strong> User provides false information, misrepresents credentials, or engages in deceptive conduct</li>
        <li><strong>Payment Default:</strong> User fails to pay Local Cooks fees or owed refunds after 7 days&apos; notice</li>
        <li><strong>Illegal Activity:</strong> User engages in illegal conduct or violates Applicable Law</li>
        <li><strong>Harassment or Abuse:</strong> User harasses, threatens, or abuses another user or Local Cooks staff</li>
        <li><strong>Platform Abuse:</strong> User disrupts Platform operations, uses automated tools without permission, or attempts to hack/circumvent the system</li>
        <li><strong>Breach of Terms:</strong> User materially breaches these Terms and fails to cure within 3 days of written notice</li>
      </ul>
      <p className="mb-2 font-semibold">Effect of Suspension/Termination:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>User&apos;s listing/profile is removed immediately</li>
        <li>Pending Bookings are cancelled and refunded per the Kitchen Owner&apos;s cancellation policy</li>
        <li>User forfeits access to the Platform and cannot create a new account</li>
        <li>Outstanding disputes are referred to arbitration if unresolved</li>
        <li>User remains liable for any damages or claims arising from their conduct</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">13.3 Appeal Process</h3>
      <p className="mb-2">If a user believes their account was suspended in error, they may:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>
          Contact Local Cooks within 7 days of suspension with:
          <ul className="list-disc pl-6 mt-2">
            <li>Explanation of why the suspension was improper</li>
            <li>Documentation supporting their position (updated license, certificate, etc.)</li>
          </ul>
        </li>
        <li>Local Cooks will review and respond within 7 days</li>
        <li>If unresolved, the dispute goes to arbitration (Section 12)</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 14 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">14. LIMITATION OF LIABILITY</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.1 Disclaimer of Warranties</h3>
      <p className="mb-4 uppercase font-semibold">The Platform, Kitchen listings, and all services are provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without any warranties of any kind, express or implied.</p>
      <p className="mb-2">Local Cooks expressly disclaims:</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Implied Warranties:</strong> Merchantability, fitness for a particular purpose, non-infringement, title, and quiet enjoyment</li>
        <li><strong>Quality Warranty:</strong> That the Platform will be error-free, uninterrupted, or secure</li>
        <li><strong>Kitchen Warranty:</strong> That any Kitchen is safe, clean, compliant, or suitable for intended use</li>
        <li><strong>Food Safety Warranty:</strong> That any food prepared is safe or fit for human consumption</li>
        <li><strong>User Warranty:</strong> That Kitchen Owners or Chefs are competent, licensed, or trustworthy</li>
      </ul>
      <p className="mb-4">If any part of these disclaimers is found invalid, the remaining disclaimers remain in full force.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.2 Cap on Liability</h3>
      <p className="mb-4 uppercase font-semibold">To the fullest extent permitted by Applicable Law, Local Cooks&apos; total liability to any user for any claim, demand, or action (whether in contract, tort, negligence, or otherwise) shall not exceed the Platform fees paid by the user in the 12 months preceding the claim.</p>
      <p className="mb-4">If a user has paid no fees, Local Cooks&apos; liability is capped at zero.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.3 No Liability for Consequential Damages</h3>
      <p className="mb-2 uppercase font-semibold">Local Cooks shall not be liable for any:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Indirect, incidental, consequential, special, or punitive damages</li>
        <li>Lost profits, lost revenue, lost savings, lost business opportunity, or lost goodwill</li>
        <li>Cost of substitute services or products</li>
        <li>Reputational harm or damage to business relationships</li>
        <li>Loss of data or corruption of data (unless caused by Local Cooks&apos; gross negligence)</li>
      </ul>
      <p className="mb-4">Even if Local Cooks has been advised of the possibility of such damages.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.4 No Liability for User Conduct</h3>
      <p className="mb-2 uppercase font-semibold">Local Cooks is not liable for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Any conduct, statements, or actions of Kitchen Owners, Chefs, or other users</li>
        <li>Any food safety violations, foodborne illness, or allergic reactions</li>
        <li>Any equipment failure, property damage, or personal injury in any Kitchen</li>
        <li>Any breach of Applicable Law by users</li>
        <li>Any damage caused by third parties (customers, invitees, etc.)</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.5 No Liability for Platform Downtime</h3>
      <p className="mb-2 uppercase font-semibold">Local Cooks is not liable for:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Any interruption, delay, or unavailability of the Platform (e.g., maintenance, cyber-attacks, natural disasters)</li>
        <li>Any loss of access to Bookings, messages, or user data due to downtime</li>
        <li>Any business losses resulting from inability to book or access the Platform</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">14.6 Exception: Gross Negligence</h3>
      <p className="mb-2">The above limitations do NOT apply to:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Gross negligence or willful misconduct by Local Cooks</li>
        <li>Breach of Local Cooks&apos; duty to indemnify (Section 7.4)</li>
        <li>Data breaches caused by Local Cooks&apos; failure to implement industry-standard security measures</li>
        <li>Violations of privacy law by Local Cooks</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 15 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">15. MISCELLANEOUS</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.1 Governing Law &amp; Jurisdiction</h3>
      <p className="mb-4">These Terms shall be governed by and construed in accordance with the laws of Newfoundland &amp; Labrador, Canada, without regard to conflicts of law principles.</p>
      <p className="mb-4">Disputes arising under these Terms shall be resolved by binding arbitration (Section 12), not by court litigation. Arbitration shall be conducted in St. John&apos;s, Newfoundland &amp; Labrador (or by written submission if parties agree).</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.2 Entire Agreement</h3>
      <p className="mb-2">These Terms and Conditions, together with:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The Platform&apos;s Privacy Policy</li>
        <li>Kitchen Owner&ndash;Chef Rental Agreements (individual Bookings)</li>
        <li>Any supplementary rules posted on the Platform</li>
      </ul>
      <p className="mb-4">constitute the entire agreement between users and Local Cooks regarding the use of the Platform and booking of Kitchens.</p>
      <p className="mb-4"><strong>If a Kitchen Rental Agreement conflicts with these Platform Terms, the Rental Agreement controls for that specific Booking.</strong></p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.3 Amendment &amp; Updates</h3>
      <p className="mb-2">Local Cooks may update these Terms at any time by:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Posting the updated Terms on the Platform website</li>
        <li>Notifying users via email (at the email address on file)</li>
        <li>Requiring users to accept updated Terms before subsequent Bookings or Platform use</li>
      </ul>
      <p className="mb-4">Continued use of the Platform after notification constitutes acceptance of updated Terms.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.4 Severability</h3>
      <p className="mb-2">If any provision of these Terms is found invalid, illegal, or unenforceable:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>The invalid provision is severed from the Terms</li>
        <li>The remaining provisions remain in full force and effect</li>
        <li>Local Cooks and users will negotiate a valid replacement provision as close as possible to the original intent</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.5 No Waiver</h3>
      <p className="mb-4">Failure by Local Cooks to enforce any right or provision of these Terms does not constitute a waiver of that right. Local Cooks may enforce rights selectively, in any order, and multiple times.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.6 Assignment</h3>
      <p className="mb-4">Users cannot assign or transfer their rights under these Terms without Local Cooks&apos; written consent. Any attempted assignment is void.</p>
      <p className="mb-4">Local Cooks may assign its rights and obligations to a successor company or buyer (e.g., in a merger, acquisition, or bankruptcy) upon notice to users. Users&apos; rights and obligations survive the assignment.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.7 Notices</h3>
      <p className="mb-2">All notices must be in writing and delivered via:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Email to the email address on file (effective upon sending)</li>
        <li>Postal mail to the mailing address on file (effective 5 business days after mailing)</li>
        <li>In person at Local Cooks&apos; office address (effective upon receipt)</li>
      </ul>
      <p className="mb-2 font-semibold">Local Cooks&apos; Contact Information:</p>
      <p className="mb-4">
        Jawrophi Delivery Inc. operating as &ldquo;Local Cooks&rdquo;<br />
        4 Priscilla Place, Paradise, Newfoundland and Labrador, A1L 1E6, Canada<br />
        Email: support@localcook.shop<br />
        Phone: +1 (709)-631-8480<br />
        Website: www.localcooks.ca
      </p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.8 Force Majeure</h3>
      <p className="mb-2">Neither party is liable for failure to perform obligations under these Terms due to circumstances beyond reasonable control, including:</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Natural disasters (earthquake, flood, hurricane, etc.)</li>
        <li>Epidemic or pandemic (e.g., COVID-19)</li>
        <li>War, terrorism, or civil unrest</li>
        <li>Government actions or regulatory changes</li>
        <li>Utility failures or supply chain disruptions</li>
        <li>Acts of God</li>
      </ul>
      <p className="mb-4"><strong>Exception:</strong> Obligations to pay fees are NOT excused by force majeure. If a Kitchen is unavailable due to force majeure, the Kitchen Owner must refund fees and reschedule the Booking.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">15.9 Relationship of Parties</h3>
      <p className="mb-4">Local Cooks is an independent contractor and NOT the employee, agent, partner, or joint venturer of any user. No user is an employee or contractor of Local Cooks.</p>

      <hr className="my-8" />

      {/* SECTION 16 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">16. ACKNOWLEDGMENT &amp; ACCEPTANCE</h2>
      <p className="mb-4">By registering an account on Local Cooks and/or making a Booking, each user (Kitchen Owner or Chef) acknowledges that they:</p>
      <ul className="list-none pl-0 mb-4 space-y-2">
        <li>&#10003; Have read and understood these Terms and Conditions in their entirety</li>
        <li>&#10003; Agree to be bound by all terms, conditions, and provisions herein</li>
        <li>&#10003; Understand that they are assuming all risks associated with using the Platform and the Kitchen</li>
        <li>&#10003; Understand that they are waiving certain legal rights (including the right to sue in court)</li>
        <li>&#10003; Represent that they possess all necessary licenses, permits, certifications, and insurance required by Applicable Law</li>
        <li>&#10003; Accept personal responsibility for food safety, regulatory compliance, and any injuries or property damage caused by their conduct</li>
        <li>&#10003; Release Local Cooks, Kitchen Owners, and/or Chefs from liability to the fullest extent permitted by law</li>
        <li>&#10003; Indemnify and defend the other party from all third-party claims arising from their conduct</li>
        <li>&#10003; Understand that failure to comply may result in account suspension, termination, and legal liability</li>
        <li>&#10003; Agree to submit disputes to binding arbitration rather than court litigation</li>
      </ul>

      <p className="text-center font-bold mt-12 mb-4">END OF TERMS &amp; CONDITIONS</p>

      <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 mt-8">
        <h3 className="text-lg font-bold mb-2">Questions? Contact Local Cooks:</h3>
        <p className="text-sm mb-1"><strong>Jawrophi Delivery Inc.</strong> operating as &ldquo;Local Cooks&rdquo;</p>
        <p className="text-sm mb-1"><strong>Email:</strong> support@localcook.shop</p>
        <p className="text-sm mb-1"><strong>Phone:</strong> +1 (709)-631-8480</p>
        <p className="text-sm mb-1"><strong>Website:</strong> www.localcooks.ca</p>
        <p className="text-sm"><strong>Mailing Address:</strong> 4 Priscilla Place, Paradise, Newfoundland and Labrador, A1L 1E6, Canada</p>

        <p className="text-xs text-gray-500 mt-4 italic">
          Document Version: 1.0 &nbsp;|&nbsp; Effective Date: 01-02-2026 &nbsp;|&nbsp; Last Updated: 01-05-2026 &nbsp;|&nbsp; Jurisdiction: Newfoundland &amp; Labrador, Canada
        </p>
      </div>

      <div className="mt-8 p-4 border-l-4 border-yellow-400 bg-yellow-50 text-xs text-gray-700">
        <p className="font-bold mb-2 uppercase text-yellow-800">Important Disclaimer</p>
        <p className="mb-2">These Terms &amp; Conditions are provided as a template for Local Cooks and should be reviewed by a lawyer licensed in Newfoundland &amp; Labrador before use. This document is not legal advice. Specific food safety, tax, insurance, and liability laws vary by jurisdiction and may change. Local Cooks must ensure full compliance with current legislation, including but not limited to:</p>
        <ul className="list-disc pl-6 mb-2">
          <li>Food Premises Act and Regulations (Service NL)</li>
          <li>Health and Community Services Act (NL)</li>
          <li>Consumer Protection Act (NL)</li>
          <li>Personal Information Protection Act (NL)</li>
          <li>Building Code (National, as adopted in NL)</li>
          <li>Human Rights Act (NL)</li>
          <li>GST/HST legislation (Canada Revenue Agency)</li>
          <li>PIPEDA (Personal Information Protection and Electronic Documents Act)</li>
        </ul>
        <p>Consult with legal counsel, insurance brokers, food safety experts, and tax professionals before launching the platform.</p>
      </div>
    </div>
  );
}
