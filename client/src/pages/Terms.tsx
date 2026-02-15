import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import { motion } from "framer-motion";
import { useEffect } from "react";

export default function Terms() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <SEOHead
        title="Terms of Service"
        description="LocalCooks platform terms of service. Review the terms and conditions for using LocalCooks commercial kitchen booking, chef services, and payment processing."
        canonicalUrl="/terms"
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: "Terms of Service", url: "https://chef.localcooks.ca/terms" },
        ]}
      />
      <Header />
      <main className="flex-grow pt-28 pb-16">
        <motion.div
          className="container mx-auto px-4 max-w-4xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="bg-white rounded-lg shadow-lg p-8 md:p-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-8 text-center text-gray-900">
              LOCAL COOKS PLATFORM TERMS OF SERVICE
            </h1>

            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-2">
                <strong>Effective Date:</strong> 05/02/2026
              </p>
              <p className="text-sm text-gray-600 mb-2">
                <strong>Last Updated:</strong> 05/02/2026
              </p>
              <p className="text-sm text-gray-600 mb-2">
                <strong>Operator:</strong> Jawrophi Deliveries Inc. (doing business as &quot;Local Cooks&quot;)
              </p>
              <p className="text-sm text-gray-600 mb-8">
                <strong>Jurisdiction:</strong> Newfoundland &amp; Labrador, Canada
              </p>

              <hr className="my-8" />

              {/* TABLE OF CONTENTS */}
              <h2 className="text-2xl font-bold mt-8 mb-4">TABLE OF CONTENTS</h2>
              <ol className="list-decimal pl-6 mb-8">
                <li><strong>Definitions</strong></li>
                <li><strong>Acceptance and Scope</strong></li>
                <li><strong>Platform Role and Disclaimer</strong></li>
                <li><strong>Eligibility and Account Registration</strong></li>
                <li><strong>Kitchen Owner (Manager) Terms</strong></li>
                <li><strong>Chef Terms</strong></li>
                <li><strong>Portal User Terms</strong></li>
                <li><strong>Booking Process and Payments</strong></li>
                <li><strong>Cancellation and Refunds</strong></li>
                <li><strong>Damage Claims and Security</strong></li>
                <li><strong>Overstay and Storage Policies</strong></li>
                <li><strong>Insurance and Liability</strong></li>
                <li><strong>Food Safety and Legal Compliance</strong></li>
                <li><strong>Acceptable Use and Conduct</strong></li>
                <li><strong>Intellectual Property and Data</strong></li>
                <li><strong>Dispute Resolution</strong></li>
                <li><strong>Limitation of Liability</strong></li>
                <li><strong>Termination and Suspension</strong></li>
                <li><strong>Miscellaneous Provisions</strong></li>
                <li><strong>Contact Information</strong></li>
              </ol>

              <hr className="my-8" />

              {/* SECTION 1 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">1. DEFINITIONS</h2>
              <p className="mb-4"><strong>&quot;Local Cooks&quot;</strong>, <strong>&quot;Platform&quot;</strong>, <strong>&quot;we&quot;</strong>, <strong>&quot;us&quot;</strong>, or <strong>&quot;our&quot;</strong> means the web and mobile application marketplace service owned and operated by Jawrophi Deliveries Inc., headquartered at 4 Priscilla Place, Paradise, Newfoundland and Labrador, A1L 1E6, Canada.</p>
              <p className="mb-4"><strong>&quot;Kitchen Owner&quot;</strong>, <strong>&quot;Manager&quot;</strong>, or <strong>&quot;Host&quot;</strong> means any person or business entity that owns, leases, or operates a licensed commercial kitchen and lists it on the Platform for rental.</p>
              <p className="mb-4"><strong>&quot;Chef&quot;</strong> or <strong>&quot;Renter&quot;</strong> means any person or business entity who books and uses a Kitchen through the Platform to prepare, cook, package, or process food products for commercial purposes.</p>
              <p className="mb-4"><strong>&quot;Portal User&quot;</strong> means a third-party individual authorized to book kitchens at specific assigned locations without full Chef account privileges.</p>
              <p className="mb-4"><strong>&quot;User&quot;</strong> or <strong>&quot;you&quot;</strong> means any Kitchen Owner, Chef, Portal User, or other person accessing or using the Platform.</p>
              <p className="mb-4"><strong>&quot;Kitchen&quot;</strong> or <strong>&quot;Space&quot;</strong> means a commercial food preparation facility listed on the Platform, including fixed equipment, amenities, and related facilities.</p>
              <p className="mb-4"><strong>&quot;Booking&quot;</strong> means a confirmed rental agreement between a Kitchen Owner and Chef (or Portal User), specifying date, time, rate, and terms of access, facilitated through the Platform.</p>
              <p className="mb-4"><strong>&quot;Stripe&quot;</strong> means Stripe, Inc. and its affiliates, our third-party payment processor that handles all payment processing, including stored payment credentials.</p>
              <p className="mb-4"><strong>&quot;Food Premises Licence&quot;</strong> means the regulatory licence issued by Service NL permitting operation of a commercial food preparation facility in compliance with Newfoundland &amp; Labrador&apos;s Food Premises Regulations.</p>
              <p className="mb-4"><strong>&quot;Applicable Law&quot;</strong> means all federal, provincial, territorial, and municipal laws, regulations, bylaws, ordinances, and codes applicable in Newfoundland &amp; Labrador, including but not limited to the Food and Drug Act, Food Premises Regulations, Health and Community Services Act, Consumer Protection and Business Practices Act, and all applicable food safety regulations.</p>
              <p className="mb-4"><strong>&quot;Damage Claim&quot;</strong> means a documented claim by a Kitchen Owner for physical damage to the Kitchen, fixtures, equipment, or excessive cleaning costs caused during a Chef&apos;s rental period.</p>
              <p className="mb-4"><strong>&quot;Platform Fee&quot;</strong> means the service fee charged by Local Cooks for facilitating bookings, calculated as 2.9% + $0.30 of the booking amount (representing the pass-through of payment processing costs).</p>

              <hr className="my-8" />

              {/* SECTION 2 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">2. ACCEPTANCE AND SCOPE</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">2.1 Agreement to Terms</h3>
              <p className="mb-4">By registering an account, accessing the Platform, or making or accepting a Booking, you agree to be legally bound by these Terms of Service and all policies incorporated by reference. If you do not agree to these Terms, you may not use the Platform.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.2 Business-to-Business Platform</h3>
              <p className="mb-4"><strong>Local Cooks operates primarily as a business-to-business (B2B) platform.</strong> Kitchen Owners operate commercial food premises for business purposes. Chefs use Kitchens for commercial food preparation and sale. Portal Users typically book for business purposes.</p>
              <p className="mb-4"><strong>Consumer Protection Notice:</strong> If you are acting for business or commercial purposes, you acknowledge that you are NOT a &quot;consumer&quot; as defined in the Newfoundland and Labrador Consumer Protection and Business Practices Act, SNL 2009 c.C-31.1, and that the consumer protection provisions of that Act do not apply to your commercial use of the Platform. If you are acting for personal, family, or household purposes, certain provisions of the Act may apply, and in the event of any conflict, the Act will prevail.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.3 Modifications to Terms</h3>
              <p className="mb-4">We may modify these Terms at any time by posting updated Terms on the Platform and notifying you via email at least 30 days before changes take effect. Your continued use of the Platform after changes take effect constitutes acceptance. If you do not agree to changes, you may terminate your account before the effective date.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.4 Additional Policies</h3>
              <p className="mb-4">These Terms incorporate by reference our Privacy Policy, Cancellation Policy, Food Safety Guidelines, and Kitchen-specific terms posted by Kitchen Owners. All such policies form part of the binding agreement between you and Local Cooks.</p>

              <hr className="my-8" />

              {/* SECTION 3 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">3. PLATFORM ROLE AND DISCLAIMER</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">3.1 Intermediary Role and What We Actually Do</h3>
              <p className="mb-4">Local Cooks is a technology platform and marketplace intermediary for commercial kitchen bookings and related services. We design and operate onboarding, verification, booking, and payment flows that allow Kitchen Owners to list licensed kitchens and Chefs to request and complete rental bookings through the Platform.</p>
              <p className="mb-4">Local Cooks does not itself own, operate, or manage any Kitchen, and does not provide food preparation, catering, or delivery services. Day&#8209;to&#8209;day operation, staffing, maintenance, and regulatory compliance of each Kitchen remain the responsibility of the Kitchen Owner.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.2 Direct Contracts Between Users</h3>
              <p className="mb-4">When a Booking is confirmed, a direct contract is formed between the Kitchen Owner and the Chef (or Portal User, where applicable) for use of the Kitchen and any related services described in the listing and Booking confirmation. Local Cooks facilitates this contract and acts as a limited payment collection and disbursement agent as described in Section 8, but is not itself a party to the Kitchen rental agreement.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.3 Our Safety and Compliance Role</h3>
              <p className="mb-4">Local Cooks requires Kitchen Owners and Chefs to upload specified licences, certifications, and insurance documents, and reviews those documents for completeness, apparent validity, and expiry dates before activating or renewing accounts or listings. Local Cooks also reserves the right to automatically suspend or inactivate a Kitchen listing, or a User&apos;s ability to make new Bookings, when a required licence or insurance document expires, is not renewed, or we are notified that it has been suspended or revoked.</p>
              <p className="mb-4">This document&#8209;based gatekeeping is intended to support regulatory compliance, but it does not replace the independent legal obligations of Kitchen Owners and Chefs to meet all requirements applicable to their operations, nor does it constitute a food safety inspection or legal advice.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.4 No Operational Warranties</h3>
              <p className="mb-4">The Platform, all Kitchen listings, and all services are provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; to the extent permitted by law. Without limiting statutory rights that cannot be waived, Local Cooks does not warrant that: any Kitchen will be free from defects or hazards at the time of your Booking, any equipment will be suitable for a specific use, or any User will perform their obligations under a Booking.</p>
              <p className="mb-4">You are expected to exercise reasonable care and due diligence, including reviewing listings and Kitchen&#8209;specific rules, confirming that the Kitchen setup is suitable for your intended activities on arrival, and complying with all Applicable Law.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.5 Verification Scope and Limitations</h3>
              <p className="mb-4">Local Cooks&apos; verification activities are limited to reviewing documents that Users choose or are required to upload (such as Food Premises Licences, Food Handler Certifications, and insurance certificates) for completeness, apparent validity, and expiry dates at the time of review. We do not perform in&#8209;person inspections of Kitchens, do not continuously monitor Users&apos; regulatory status in real time, and cannot guarantee that licences, certifications, or insurance remain accurate, in force, or free of undisclosed conditions after they have been reviewed. Ongoing safety, maintenance, and legal compliance remain the responsibility of the Kitchen Owner and Chef, as applicable.</p>

              <hr className="my-8" />

              {/* SECTION 4 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">4. ELIGIBILITY AND ACCOUNT REGISTRATION</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Age and Capacity</h3>
              <p className="mb-4">You must be at least 18 years of age (or the age of majority in your jurisdiction) and have the legal capacity to enter into binding contracts to use the Platform. By using the Platform, you represent and warrant that you meet these requirements.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Account Registration</h3>
              <p className="mb-4">To use the Platform, you must create an account and provide accurate, complete, and current information, including:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Full legal name and contact information</li>
                <li>Business name and registration details (if applicable)</li>
                <li>Valid email address and phone number</li>
                <li>Payment information</li>
                <li>Required licenses, permits, and certifications (as applicable to your role)</li>
              </ul>
              <p className="mb-4">You agree to keep your account information accurate and up-to-date at all times.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Account Security</h3>
              <p className="mb-4">You are responsible for maintaining the confidentiality of your account credentials (email and password). You are fully responsible for all activities that occur under your account, whether authorized by you or not. You must immediately notify us of any unauthorized access or security breach.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.4 One Account Per User</h3>
              <p className="mb-4">You may maintain only one active account. You may not create multiple accounts or allow others to use your account. If your account is terminated or suspended, you may not create a new account or use another person&apos;s account.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.5 Business Representation</h3>
              <p className="mb-4">If you register an account on behalf of a business, company, or other legal entity, you represent and warrant that:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>You have the authority to bind that entity to these Terms</li>
                <li>The entity is duly organized, validly existing, and in good standing</li>
                <li>You are authorized to accept these Terms and enter into Bookings on behalf of the entity</li>
              </ul>

              <hr className="my-8" />

              {/* SECTION 5 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">5. KITCHEN OWNER (MANAGER) TERMS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">5.1 Eligibility Requirements</h3>
              <p className="mb-4">To list a Kitchen on Local Cooks, you must:</p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Hold a valid, unexpired <strong>Food Premises Licence</strong> issued by Service NL for the Kitchen you intend to list, OR have an approved application pending. You must provide proof of license before your Kitchen is activated.</li>
                <li>Own, lease, or have documented authority to list and rent the Kitchen. We may request proof of ownership or authorization.</li>
                <li>Maintain <strong>comprehensive insurance</strong> meeting the minimums specified in Section 12 of these Terms, with Local Cooks named as additional insured.</li>
                <li>Certify compliance with Applicable Law, including building codes, fire codes, zoning, occupancy permits, and food safety regulations.</li>
                <li>Have no outstanding violations, suspensions, or regulatory actions against the Kitchen or your food license.</li>
              </ol>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.2 Listing Creation and Accuracy</h3>
              <p className="mb-4">You grant Local Cooks a non-exclusive right to display your Kitchen listing on the Platform and in marketing materials.</p>
              <p className="mb-4"><strong>You warrant that all listing information is accurate, complete, and not misleading,</strong> including:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Description, location, and photos of the Kitchen</li>
                <li>Available equipment, amenities, and utilities</li>
                <li>Hours of availability</li>
                <li>Pricing (hourly or monthly rates)</li>
                <li>Rules, restrictions, and policies (cancellation, cleaning, equipment use)</li>
                <li>Access instructions and parking information</li>
              </ul>
              <p className="mb-4">You must keep your listing information and availability calendar accurate and up-to-date at all times. Failure to do so may result in listing suspension or removal.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.3 Kitchen Condition and Access</h3>
              <p className="mb-4">You agree to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Provide Chefs access</strong> to the full Kitchen as described in your listing at the scheduled date and time</li>
                <li>Ensure the Kitchen is <strong>clean, sanitary, pest-free, and in safe working condition</strong> before each Chef arrival</li>
                <li>Provide <strong>functioning, food-safe equipment</strong> as represented in your listing; if equipment fails during a rental, you must offer a refund or rescheduling option</li>
                <li>Maintain all equipment to manufacturer specifications and Applicable Law</li>
                <li>Ensure adequate hot and cold running water, refrigeration, and cooking appliances</li>
                <li>Maintain functional fire safety systems (extinguishers, alarms, ventilation)</li>
                <li>Clearly disclose any equipment restrictions or prohibited uses</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.4 Food Premises Licence Maintenance</h3>
              <p className="mb-4">You must:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Maintain a valid, non-suspended Food Premises Licence at all times</li>
                <li><strong>Immediately notify Local Cooks</strong> (within 24 hours) if your license is suspended, revoked, or subjected to conditions or violations</li>
                <li>Cooperate fully with food safety inspectors and provide Local Cooks with copies of inspection reports or violation notices within 5 business days</li>
                <li>Not allow any Chef to operate in your Kitchen without proof of valid Food Handler Certification</li>
              </ul>
              <p className="mb-4"><strong>If your Food Premises Licence is suspended or revoked, your Kitchen listing will be immediately suspended and all affected Chefs notified.</strong> You may not re-list until the license is fully reinstated.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.5 Pricing and Payment Terms</h3>
              <p className="mb-4">You set your own rental rates (hourly, daily, or monthly). You may also set:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Cleaning fees</li>
                <li>Damage deposit amounts (typically $100-$500)</li>
                <li>Overstay penalty rates</li>
                <li>Equipment add-on fees</li>
                <li>Storage fees (if applicable)</li>
              </ul>
              <p className="mb-4"><strong>All pricing and fees must be clearly stated in your listing.</strong> You may not charge Chefs fees not disclosed in the listing or Booking confirmation.</p>
              <p className="mb-4"><strong>Payment Flow:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Chef pays through Platform at time of booking (Stripe processes payment with 24-hour authorization hold)</li>
                <li>You approve or reject the booking within 24 hours</li>
                <li>Upon approval and completion of rental, Local Cooks deducts Platform Fee (2.9% + $0.30) and remits your share to your Stripe Connect account</li>
                <li>Stripe automatically processes weekly payouts to your designated bank account</li>
              </ol>
              <p className="mb-4">You may not require Chefs to pay you directly outside the Platform.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.6 Cancellation Policy</h3>
              <p className="mb-4">You must set and clearly disclose your cancellation policy in your listing. Options include:</p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Flexible:</strong> Full refund if cancelled ≥7 days before rental; 50% refund if 3-7 days; no refund if &lt;3 days</li>
                <li><strong>Moderate:</strong> Full refund if cancelled ≥14 days before rental; 50% refund if 7-14 days; no refund if &lt;7 days</li>
                <li><strong>Strict:</strong> Full refund if cancelled ≥30 days before rental; 50% refund if 14-30 days; no refund if &lt;14 days</li>
                <li><strong>Non-refundable:</strong> No refunds under any circumstances (not recommended)</li>
              </ul>
              <p className="mb-4"><strong>You may not cancel a confirmed Booking except for:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Emergency Kitchen closure (equipment failure, utility outage, regulatory closure)</li>
                <li>Chef violation of Platform rules or misrepresentation</li>
                <li>Force majeure events</li>
              </ul>
              <p className="mb-4">Frequent cancellations by you may result in listing suspension, reduced search visibility, or account termination.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.7 Damage Claims Process</h3>
              <p className="mb-4">If a Chef causes damage to your Kitchen, you may file a Damage Claim. See Section 10 for full details.</p>
              <p className="mb-4"><strong>Time Limit:</strong> You must document and report damage to Local Cooks within <strong>72 hours</strong> after the Chef&apos;s scheduled departure.</p>
              <p className="mb-4"><strong>Amount Range:</strong> Damage Claims may be between $10 (minimum) and $5,000 (maximum) CAD per incident.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.8 Inspection and Entry Rights</h3>
              <p className="mb-4">You reserve the right to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Inspect the Kitchen before and after each Chef rental</li>
                <li>Enter the Kitchen during a rental with reasonable advance notice (except in emergencies)</li>
                <li>Terminate a rental immediately if you observe unsafe practices, violations of Kitchen rules, or prohibited activities</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.9 Kitchen-Specific Terms</h3>
              <p className="mb-4">You may create and upload Kitchen-specific terms and policies (e.g., detailed equipment rules, additional restrictions, local regulations). Such terms:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Must be consistent with these Platform Terms</li>
                <li>Must be clearly disclosed in your listing and provided to Chef before booking</li>
                <li>Must not waive Chef&apos;s rights under Applicable Law or these Terms</li>
                <li>Must not be unconscionable, illegal, or discriminatory</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">5.10 Indemnification by Kitchen Owner</h3>
              <p className="mb-4">You agree to indemnify, defend, and hold harmless Local Cooks, its officers, directors, employees, and agents from all claims, losses, damages, liabilities, costs, and expenses (including reasonable legal fees) arising from:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Your operation or maintenance of the Kitchen</li>
                <li>Your breach of these Terms or Applicable Law</li>
                <li>Injuries or property damage caused by defective equipment, unsafe conditions, or your negligence</li>
                <li>Your failure to maintain valid licenses, permits, or insurance</li>
                <li>Misrepresentations in your listing</li>
              </ul>
              <p className="mb-4">This indemnification survives termination of your account and any Booking.</p>
              <p className="mb-4">This indemnity does not apply to the extent a claim is finally determined by a court or arbitrator to have been caused primarily by the gross negligence or wilful misconduct of the Chef or Local Cooks.</p>

              <hr className="my-8" />

              {/* SECTION 6 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">6. CHEF TERMS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Eligibility Requirements</h3>
              <p className="mb-4">To book a Kitchen on Local Cooks, you must:</p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Hold a valid <strong>Food Handler Certification</strong> (or equivalent food safety training) issued by an approved provider. Proof must be provided before your first booking.</li>
                <li>Hold all required <strong>food business permits and licenses</strong> for the food product(s) you intend to prepare, which may include:
                  <ul className="list-disc pl-6 mt-2">
                    <li>Health Permit or Food Business Licence from Provincial Health Authority (for retail sale)</li>
                    <li>Municipal business registration (if operating in a municipality)</li>
                    <li>Proof that your food products are legally permissible</li>
                  </ul>
                </li>
                <li>Maintain <strong>General Liability Insurance</strong> (minimum $1,000,000 per occurrence) covering your food products and operations. You must name the Kitchen Owner as additional insured.</li>
                <li>Certify that you will operate legally and comply with all Applicable Law.</li>
              </ol>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Booking and Kitchen Use</h3>
              <p className="mb-4">By submitting a Booking request, you agree to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Use the Kitchen only for the stated purpose, date, time, and duration</li>
                <li>Provide accurate information about the food product(s) you will prepare</li>
                <li>Disclose all major allergens and ingredients</li>
                <li>Arrive no earlier than 15 minutes before scheduled start time</li>
                <li>Depart no later than scheduled end time (overstay fees apply—see Section 11)</li>
                <li>Use ONLY the Kitchen areas and equipment specified in the Booking</li>
                <li>Not sublicense, share, or allow unauthorized persons to access the Kitchen</li>
                <li>Supervise all employees or staff you bring; you are solely responsible for their conduct</li>
                <li>Follow all Kitchen rules and instructions provided by the Kitchen Owner</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.3 Food Safety and Legal Compliance</h3>
              <p className="mb-4">You must:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Operate only within the scope permitted by your food business license</li>
                <li>Comply with Newfoundland &amp; Labrador Food Premises Regulations and all food safety laws</li>
                <li>Follow proper food handling, storage, temperature control, and hygiene standards:
                  <ul className="list-disc pl-6 mt-2">
                    <li>Hot foods ≥63°C (145°F)</li>
                    <li>Cold foods ≤4°C (40°F)</li>
                    <li>Proper handwashing, hair restraints, clean clothing</li>
                  </ul>
                </li>
                <li>Prevent cross-contamination and foodborne illness</li>
                <li>Not allow anyone who is ill or has open wounds to handle food</li>
                <li>Obtain Kitchen Owner approval before preparing any high-risk or regulated food products (meat, fish, acidified foods, etc.)</li>
                <li>Maintain temperature logs and food safety records as required by law</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.4 Cleaning and Sanitation</h3>
              <p className="mb-4"><strong>You must leave the Kitchen in clean, sanitary, and orderly condition equivalent to its condition upon your arrival.</strong> This includes:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Cleaning and sanitizing all food contact surfaces, equipment, and utensils used</li>
                <li>Mopping floors and wiping down counters, sinks, stoves</li>
                <li>Cleaning inside refrigerators/freezers if used</li>
                <li>Emptying all trash, compost, and recycling</li>
                <li>Removing all personal items, ingredients, and food products</li>
                <li>Cleaning spills immediately</li>
              </ul>
              <p className="mb-4"><strong>Failure to clean adequately may result in:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Loss of damage deposit</li>
                <li>Cleaning fee (typically $100-$300) charged to your stored payment method</li>
                <li>Suspension of your ability to book future Kitchens</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.5 Incident Reporting</h3>
              <p className="mb-4">You must immediately report to the Kitchen Owner (and Local Cooks within 24 hours) any:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Injuries to you or your staff</li>
                <li>Equipment damage, malfunction, or safety hazards</li>
                <li>Spills, contamination, or sanitation issues</li>
                <li>Allergic reactions or foodborne illness complaints from your customers</li>
                <li>Any incident that could give rise to a claim</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.6 Prohibited Uses</h3>
              <p className="mb-4">You may NOT use the Kitchen for:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Preparing food products you are not licensed to prepare</li>
                <li>Activities prohibited by the Kitchen Owner&apos;s rules</li>
                <li>Illegal activities or products</li>
                <li>Preparing food for unpermitted sale channels</li>
                <li>Overnight stays or residential purposes</li>
                <li>Subleasing or sharing access with unauthorized parties</li>
                <li>Any use that violates Applicable Law or these Terms</li>
              </ul>
              <p className="mb-4">Violations may result in immediate termination of your Booking, loss of deposits, account suspension, and liability for all resulting damages and claims.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.7 Payment Responsibility</h3>
              <p className="mb-4">You are responsible for paying:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>All Booking fees (rental rate, cleaning fees, add-on fees)</li>
                <li>Platform Fees (included in your total at checkout)</li>
                <li>Applicable taxes (HST/GST)</li>
                <li>Damage Claims for any damage caused by you or your staff</li>
                <li>Overstay penalties if you exceed your scheduled time</li>
                <li>Any other fees disclosed in the Booking confirmation or Kitchen Owner&apos;s terms</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.8 Non-Circumvention</h3>
              <p className="mb-4">You agree NOT to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Contact the Kitchen Owner directly to arrange future bookings outside the Platform to avoid Platform Fees</li>
                <li>Use information obtained through the Platform (contact details, pricing) to conduct transactions outside the Platform</li>
                <li>Encourage other Chefs to bypass the Platform</li>
              </ul>
              <p className="mb-4"><strong>Violation may result in:</strong> Account suspension or termination, and you may be liable for Platform Fees that would have been payable on circumvented transactions (up to 30% of booking subtotal as liquidated damages).</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.9 Indemnification by Chef</h3>
              <p className="mb-4">You agree to indemnify, defend, and hold harmless both <strong>Local Cooks</strong> and the <strong>Kitchen Owner</strong> (and their respective officers, employees, and agents) from all claims, losses, damages, liabilities, costs, and expenses (including reasonable legal fees) arising from:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Your use of the Kitchen</li>
                <li>Your food products or food safety practices</li>
                <li>Foodborne illness, allergic reactions, contamination, or injury caused by your food</li>
                <li>Injuries to your employees, staff, or third parties (including your customers)</li>
                <li>Your breach of these Terms or Applicable Law</li>
                <li>Damage to the Kitchen or equipment caused by you or your staff</li>
              </ul>
              <p className="mb-4">This indemnification survives termination of your account and any Booking.</p>
              <p className="mb-4">This indemnity does not apply to the extent a claim is finally determined by a court or arbitrator to have been caused primarily by the gross negligence or wilful misconduct of the Kitchen Owner or Local Cooks.</p>

              <hr className="my-8" />

              {/* SECTION 7 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">7. PORTAL USER TERMS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">7.1 Definition and Scope</h3>
              <p className="mb-4"><strong>Portal Users</strong> are individuals authorized by a Kitchen Owner to book specific Kitchen(s) without full Chef account privileges. Portal Users typically represent businesses, organizations, or third parties with pre-established relationships with Kitchen Owners.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">7.2 Limited Access</h3>
              <p className="mb-4">Portal Users:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>May only book Kitchen(s) to which they have been explicitly granted access</li>
                <li>Are subject to the same Chef Terms (Section 6) regarding kitchen use, food safety, cleaning, and liability</li>
                <li>Must provide required certifications and insurance as determined by the Kitchen Owner</li>
                <li>May have customized booking requirements set by the Kitchen Owner</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">7.3 Authorization and Responsibility</h3>
              <p className="mb-4">The entity or individual who authorized a Portal User remains fully responsible for:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>The Portal User&apos;s conduct and compliance with these Terms</li>
                <li>All fees, damage claims, and liabilities arising from Portal User&apos;s bookings</li>
                <li>Ensuring Portal User has required licenses, certifications, and insurance</li>
              </ul>

              <hr className="my-8" />

              {/* SECTION 8 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">8. BOOKING PROCESS AND PAYMENTS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Booking Requests</h3>
              <p className="mb-4">Chefs submit Booking requests by selecting available dates and times on a Kitchen&apos;s calendar and completing the checkout process. Kitchen Owners may:</p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Auto-approve:</strong> Bookings are confirmed immediately without Kitchen Owner review</li>
                <li><strong>Require approval:</strong> Kitchen Owner must approve within 24 hours or the Booking is automatically cancelled</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Booking Confirmation</h3>
              <p className="mb-4">A Booking is confirmed when:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>The Chef receives a Booking confirmation email, AND</li>
                <li>The Kitchen Owner approves the Booking (if approval is required)</li>
              </ul>
              <p className="mb-4"><strong>Upon confirmation, a direct contract is formed between the Chef and Kitchen Owner</strong> containing all terms set forth in the listing, Booking confirmation, these Platform Terms, and any Kitchen-specific terms.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.3 Payment Processing</h3>
              <p className="mb-4"><strong>All payments are processed by Stripe, Inc.</strong> pursuant to the Stripe Connected Account Agreement and Stripe Services Agreement. By using the Platform, you agree to be bound by Stripe&apos;s terms.</p>
              <p className="mb-4"><strong>Payment Flow:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>Chef Payment:</strong> When Chef completes a Booking, Stripe charges Chef&apos;s payment method and places a 24-hour authorization hold on funds.</li>
                <li><strong>Manager Approval:</strong> Kitchen Owner has 24 hours to approve or reject the Booking. If not acted upon, the Booking is automatically cancelled and the authorization is voided (no charge).</li>
                <li><strong>Payment Capture:</strong> Upon Kitchen Owner approval, the authorization is converted to a captured charge.</li>
                <li><strong>Payout to Kitchen Owner:</strong> After the rental is completed (and no disputes raised within 24 hours), Local Cooks deducts the Platform Fee and instructs Stripe to transfer the Kitchen Owner&apos;s share to their Stripe Connect account. Stripe processes automatic weekly payouts to Kitchen Owner&apos;s bank account.</li>
              </ol>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.4 Platform Fees</h3>
              <p className="mb-4"><strong>Local Cooks charges a Platform Fee of 2.9% + $0.30 per transaction.</strong> This represents the pass-through of payment processing costs. There is no additional platform commission.</p>
              <p className="mb-4"><strong>Chefs pay the full Booking amount (inclusive of Platform Fee) at checkout.</strong> Kitchen Owners receive the Booking amount minus the Platform Fee.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.5 Authorization for Stored Payment Methods</h3>
              <p className="mb-4">We only use stored payment methods for amounts that are permitted under these Terms and that are tied to a specific Booking or related incident (such as damage, overstay, or cleaning), and we will always give you notice and a brief opportunity to respond before we attempt to charge for a claim.</p>
              <p className="mb-4"><strong>By providing payment information and completing a Booking, you explicitly authorize Local Cooks and Stripe to:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>Securely store your payment method details</strong> (credit/debit card information) for the duration of your Booking and any related claims or dispute periods.</li>
                <li><strong>Charge your stored payment method</strong> after your rental period concludes, without further authorization, solely for:
                  <ul className="list-disc pl-6 mt-2">
                    <li><strong>Damage Claims:</strong> Physical damage to Kitchen premises, fixtures, or equipment caused by you or your staff, as documented and substantiated per Section 10 (Damage Claims range: $10-$5,000 CAD)</li>
                    <li><strong>Excessive Cleaning Costs:</strong> Cleaning required beyond standard wear and tear</li>
                    <li><strong>Overstay Penalties:</strong> Penalties incurred by exceeding your scheduled rental time, calculated per Section 11</li>
                    <li><strong>Unpaid Booking Fees:</strong> Any booking fees not successfully captured due to payment failures or cancellations after the cancellation deadline</li>
                  </ul>
                </li>
                <li><strong>Process these charges ONLY after:</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li>Receiving documented evidence from Kitchen Owner (dated photos, invoices, receipts)</li>
                    <li>Notifying you of the specific claim with detailed description and amount</li>
                    <li>Providing you a reasonable opportunity to respond or dispute (typically 48-72 hours)</li>
                  </ul>
                </li>
              </ol>
              <p className="mb-4"><strong>You acknowledge and agree that:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Charges under this authorization will be processed without your per-transaction approval</li>
                <li>You will receive email notification before each charge is processed</li>
                <li>You may dispute charges through the process described in Section 10 (Damage Claims) or Section 16 (Dispute Resolution)</li>
                <li>Stripe and card networks may automatically update your stored credentials when you receive replacement cards (expired, lost, stolen) to ensure continuity of authorized payments</li>
              </ul>
              <p className="mb-4"><strong>Failed Charges:</strong> If automatic charging of your stored payment method fails, you will receive a self-serve payment link and must remit payment within 7 days. Failure to pay may result in collections activity, credit bureau reporting, account suspension, and legal action.</p>
              <p className="mb-4"><strong>Withdrawal of Authorization:</strong> You may request removal of your stored payment credentials only after all Bookings are complete and no claims or disputes are pending. We cannot remove credentials while amounts are owed or during dispute periods (up to 60 days after Booking completion).</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.6 Taxes</h3>
              <p className="mb-4"><strong>HST/GST:</strong> Applicable sales taxes (HST or GST as required in Newfoundland &amp; Labrador) are added to all Booking fees and collected by Local Cooks. We remit collected taxes to the Canada Revenue Agency (CRA).</p>
              <p className="mb-4"><strong>Kitchen Owner Tax Obligations:</strong> Kitchen Owners are solely responsible for:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Determining if their rental income requires HST/GST registration (typically if annual revenue exceeds $30,000 CAD)</li>
                <li>Registering with CRA if required</li>
                <li>Reporting rental income on tax returns</li>
                <li>Maintaining accurate records</li>
              </ul>
              <p className="mb-4"><strong>Chef Tax Obligations:</strong> Chefs are solely responsible for:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Determining if their food business revenue requires HST/GST registration</li>
                <li>Registering with CRA if required</li>
                <li>Collecting and remitting HST/GST on food sales</li>
                <li>Reporting all business income and expenses on tax returns</li>
              </ul>
              <p className="mb-4"><strong>No Tax Advice:</strong> Local Cooks does not provide tax, accounting, or legal advice. Consult a qualified tax professional regarding your obligations.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.7 Refunds</h3>
              <p className="mb-4">Refunds are governed by the Kitchen Owner&apos;s cancellation policy (see Section 9). Refunds are processed by Stripe to the Chef&apos;s original payment method.</p>
              <p className="mb-4"><strong>Refund Limitations:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Stripe processing fees (2.9% + $0.30) are not refundable and are deducted from refund amounts</li>
                <li>Refunds are subject to the Kitchen Owner&apos;s available balance in their Stripe account</li>
                <li>Refunds typically appear within 5-10 business days</li>
              </ul>
              <hr className="my-8" />

              {/* SECTION 9 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">9. CANCELLATION AND REFUNDS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">9.1 Chef-Initiated Cancellation</h3>
              <p className="mb-4"><strong>Chefs may cancel Bookings subject to the Kitchen Owner&apos;s cancellation policy</strong> selected in the listing.</p>
              <p className="mb-4"><strong>Cancellation Timing:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Pending/Authorized (not yet approved by Kitchen Owner):</strong> Chef may cancel immediately with full refund (authorization is voided, no charge occurs)</li>
                <li><strong>Confirmed/Approved (rental not yet started):</strong> Chef may submit a cancellation request. Refund amount is determined by Kitchen Owner&apos;s cancellation policy:
                  <ul className="list-disc pl-6 mt-2">
                    <li><strong>Flexible:</strong> Full refund if ≥7 days before rental; 50% if 3-7 days; no refund if &lt;3 days</li>
                    <li><strong>Moderate:</strong> Full refund if ≥14 days; 50% if 7-14 days; no refund if &lt;7 days</li>
                    <li><strong>Strict:</strong> Full refund if ≥30 days; 50% if 14-30 days; no refund if &lt;14 days</li>
                  </ul>
                </li>
              </ul>
              <p className="mb-4"><strong>How to Cancel:</strong> Log into your account, navigate to &quot;My Bookings,&quot; and click &quot;Cancel Booking.&quot; Cancellations submitted via email are not guaranteed to be processed in time.</p>
              <p className="mb-4"><strong>Refund Processing:</strong> Approved refunds are processed by Stripe within 5-7 business days to your original payment method. Platform Fees are not refundable.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.2 Kitchen Owner-Initiated Cancellation</h3>
              <p className="mb-4"><strong>Kitchen Owners may cancel Bookings only for valid reasons:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Emergency Kitchen closure (equipment failure, utility outage, health/safety issue)</li>
                <li>Chef violation of Platform Terms or Kitchen rules</li>
                <li>Chef misrepresented their business, certifications, or intended use</li>
                <li>Regulatory closure or suspension of Food Premises Licence</li>
                <li>Force majeure events (see Section 19.7)</li>
              </ul>
              <p className="mb-4"><strong>Kitchen Owners who cancel without valid reason may:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Be required to refund the Chef in full</li>
                <li>Face cancellation fees or penalties</li>
                <li>Receive negative impact on search ranking and listing visibility</li>
                <li>Have their listing suspended or account terminated for repeated cancellations</li>
              </ul>
              <p className="mb-4"><strong>Chef Refund:</strong> If Kitchen Owner cancels, Chef receives a full refund within 5-7 business days, regardless of the cancellation policy.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.3 Automatic Cancellation</h3>
              <p className="mb-4">Bookings are automatically cancelled if:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Kitchen Owner does not approve within 24 hours (for approval-required listings)</li>
                <li>Payment authorization expires (after 24 hours) before Kitchen Owner approval</li>
                <li>Kitchen Owner&apos;s Food Premises Licence is suspended or revoked</li>
                <li>Either party&apos;s account is terminated or suspended by Local Cooks</li>
              </ul>
              <p className="mb-4">Chefs receive full refunds for automatic cancellations.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.4 No-Show Policy</h3>
              <p className="mb-4"><strong>Chef No-Show:</strong> If Chef fails to arrive within 1 hour of scheduled start time and does not notify Kitchen Owner, Kitchen Owner may:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Treat the Booking as completed (no refund)</li>
                <li>Charge a no-show fee (if disclosed in listing)</li>
              </ul>
              <p className="mb-4"><strong>Kitchen Owner No-Show:</strong> If Kitchen Owner fails to provide access at the scheduled time or the Kitchen is not as represented, Chef may:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Cancel the Booking with full refund</li>
                <li>Report the issue to Local Cooks for investigation</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.5 Modification of Bookings</h3>
              <p className="mb-4">Either party may propose modifications (change dates, extend time, etc.) through the Platform messaging system. Modifications require mutual agreement. Any additional fees or refunds resulting from modifications will be processed automatically.</p>

              <hr className="my-8" />

              {/* SECTION 10 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">10. DAMAGE CLAIMS AND SECURITY</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">10.1 Damage Deposits</h3>
              <p className="mb-4">Kitchen Owners may require a <strong>refundable damage deposit</strong> (typically $100-$500) to be held by Local Cooks (via Stripe) or by the Kitchen Owner directly.</p>
              <p className="mb-4"><strong>If held by Local Cooks:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Deposit is authorized (but not charged) at time of booking</li>
                <li>Released automatically within 7 days after rental completion if no Damage Claim is filed</li>
                <li>Applied toward approved Damage Claims if filed</li>
              </ul>
              <p className="mb-4"><strong>If held by Kitchen Owner:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Chef pays deposit directly to Kitchen Owner (outside Platform)</li>
                <li>Kitchen Owner returns deposit within 7 days if no damage</li>
                <li>Kitchen Owner retains deposit (or portion) if damage occurs</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.2 Damage Claim Process</h3>
              <p className="mb-4"><strong>If a Chef causes damage to your Kitchen, Kitchen Owners may file a Damage Claim through the Platform.</strong></p>
              <p className="mb-4"><strong>Eligibility:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Physical damage to Kitchen premises, fixtures, or equipment</li>
                <li>Excessive cleaning required beyond normal use</li>
                <li>Missing items or equipment</li>
                <li>Damage caused during the rental period by Chef or Chef&apos;s employees/staff</li>
              </ul>
              <p className="mb-4"><strong>Amount Limits:</strong> Minimum $10 CAD; Maximum $5,000 CAD per incident.</p>
              <p className="mb-4"><strong>Timeframe:</strong> Kitchen Owner must document and file Damage Claim within <strong>72 hours</strong> after Chef&apos;s scheduled departure time.</p>
              <p className="mb-4"><strong>Required Evidence:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Minimum 2 pieces of evidence:</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li>Dated, time-stamped photos showing damage</li>
                    <li>Videos of damage (if applicable)</li>
                    <li>Repair invoices, cleaning invoices, or replacement quotes</li>
                    <li>Photos of the Kitchen in undamaged condition (before rental)</li>
                  </ul>
                </li>
                <li><strong>Detailed description</strong> of damage, location, and cause</li>
                <li><strong>Estimated or actual repair/replacement cost</strong> with supporting documentation</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.3 Chef Response</h3>
              <p className="mb-4"><strong>Once a Damage Claim is submitted, Chef receives notification and has 48 hours to:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Accept the claim:</strong> Amount is charged to Chef&apos;s stored payment method immediately</li>
                <li><strong>Dispute the claim:</strong> Provide counter-evidence, explanation, or propose alternative resolution</li>
                <li><strong>No response:</strong> After 48 hours, claim is automatically escalated to Admin review</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.4 Admin Review and Resolution</h3>
              <p className="mb-4"><strong>If Chef disputes the claim:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>Admin Review:</strong> Local Cooks Admin reviews all evidence from both parties within 5-7 business days.</li>
                <li><strong>Decision:</strong> Admin determines:
                  <ul className="list-disc pl-6 mt-2">
                    <li>Whether damage occurred and was caused by Chef</li>
                    <li>Reasonable cost of repair/cleaning/replacement</li>
                    <li>Appropriate amount to charge (may be less than claimed amount)</li>
                  </ul>
                </li>
                <li><strong>Possible Outcomes:</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li><strong>Approved (Full or Partial):</strong> Chef&apos;s stored payment method is charged for approved amount</li>
                    <li><strong>Rejected:</strong> No charge to Chef; Kitchen Owner may pursue Chef directly outside Platform</li>
                    <li><strong>Requires More Information:</strong> Parties given additional time to provide evidence</li>
                  </ul>
                </li>
              </ol>
              <p className="mb-4"><strong>Admin decisions are final and binding</strong>, except that either party may pursue independent legal remedies outside the Platform (see Section 16).</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.5 Payment of Damage Claims</h3>
              <p className="mb-4"><strong>Approved Damage Claims are charged to Chef&apos;s stored payment method automatically.</strong> Funds are transferred to Kitchen Owner&apos;s Stripe account within 5-7 business days.</p>
              <p className="mb-4"><strong>If Automatic Charge Fails:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Chef receives a self-serve payment link via email</li>
                <li>Chef must pay within 7 days</li>
                <li>Failure to pay may result in:
                  <ul className="list-disc pl-6 mt-2">
                    <li>Account suspension</li>
                    <li>Collections activity</li>
                    <li>Credit bureau reporting</li>
                    <li>Legal action by Kitchen Owner or Local Cooks</li>
                  </ul>
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.6 Claims Exceeding Platform Limits</h3>
              <p className="mb-4"><strong>If damage exceeds $5,000 CAD,</strong> Kitchen Owner may:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>File a claim under their own insurance policy</li>
                <li>Pursue Chef directly through small claims court or legal action</li>
                <li>File a claim under Chef&apos;s liability insurance</li>
              </ul>
              <p className="mb-4">Kitchen Owner retains all legal remedies outside the Platform regardless of Platform claim limits.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.7 Chef&apos;s Direct Liability</h3>
              <p className="mb-4"><strong>Chefs remain fully liable for all damage caused by them or their staff,</strong> regardless of whether a Damage Claim is filed through the Platform. This includes liability for:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Property damage to Kitchen, fixtures, equipment</li>
                <li>Injury to Kitchen Owner, Kitchen staff, or third parties</li>
                <li>Loss of business income or rental income due to damage</li>
                <li>All costs of repair, replacement, cleaning, and remediation</li>
              </ul>

              <hr className="my-8" />

              {/* SECTION 11 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">11. OVERSTAY AND STORAGE POLICIES</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">11.1 Overstay Defined</h3>
              <p className="mb-4"><strong>&quot;Overstay&quot;</strong> occurs when a Chef remains in the Kitchen beyond their scheduled end time without prior approval from the Kitchen Owner.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">11.2 Overstay Penalties</h3>
              <p className="mb-4"><strong>Kitchen Owners may set overstay penalty terms</strong> in their listing, including:</p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Grace Period:</strong> Typically 15-30 minutes (no penalty)</li>
                <li><strong>Penalty Rate:</strong> Percentage of hourly booking rate (e.g., 150% of hourly rate)</li>
                <li><strong>Maximum Penalty Days:</strong> Maximum number of days for which penalties accrue</li>
              </ul>
              <p className="mb-4"><strong>Example:</strong> If hourly rate is $40/hour, overstay penalty rate is 150%, and Chef overstays by 2 hours, penalty = 2 hours × $40 × 150% = $120.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">11.3 Overstay Penalty Process</h3>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>Kitchen Owner Notifies Chef:</strong> Kitchen Owner contacts Chef (via phone/Platform messaging) requesting immediate departure.</li>
                <li><strong>Kitchen Owner Reports Overstay:</strong> Kitchen Owner documents overstay (time, duration, communications) and submits report to Local Cooks within 24 hours after Chef departs.</li>
                <li><strong>Local Cooks Calculates Penalty:</strong> Local Cooks calculates penalty based on Kitchen Owner&apos;s disclosed policy and actual overstay duration.</li>
                <li><strong>Chef Notification:</strong> Chef receives email notification of penalty amount and calculation.</li>
                <li><strong>Automatic Charge:</strong> Overstay penalty is charged to Chef&apos;s stored payment method within 48 hours (no dispute period for overstay—time records are objective).</li>
                <li><strong>Chef Dispute:</strong> If Chef believes overstay charge is inaccurate, Chef may dispute through the Dispute Resolution process (Section 16) within 7 days.</li>
              </ol>

              <h3 className="text-xl font-semibold mt-6 mb-3">11.4 Storage Bookings</h3>
              <p className="mb-4">Some Kitchen Owners offer <strong>storage space</strong> (refrigerator, freezer, dry storage) for Chefs to store ingredients or finished products.</p>
              <p className="mb-4"><strong>Storage Bookings operate separately from Kitchen rental Bookings</strong> and have distinct terms:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Storage fee (daily, weekly, or monthly rate)</li>
                <li>Storage period and access hours</li>
                <li>Checkout/claim process (Kitchen Owner verifies items removed)</li>
                <li>Storage-specific damage deposits</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">11.5 Storage Extensions</h3>
              <p className="mb-4">Chefs may request storage extensions. Kitchen Owner must approve or reject within 24 hours. Additional fees apply for approved extensions.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">11.6 Unclaimed Storage</h3>
              <p className="mb-4">If Chef fails to retrieve stored items by the end of the storage period, Kitchen Owner may:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Charge additional storage fees (daily rate)</li>
                <li>After 7 days overdue, dispose of unclaimed items (perishable goods may be disposed immediately)</li>
                <li>Retain storage deposit</li>
              </ul>

              <hr className="my-8" />

              {/* SECTION 12 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">12. INSURANCE AND LIABILITY</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">12.1 Kitchen Owner Insurance Requirements</h3>
              <p className="mb-4"><strong>Kitchen Owners must maintain and provide proof of:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>Commercial General Liability Insurance:</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li>Minimum $1,000,000 per occurrence</li>
                    <li>Minimum $2,000,000 aggregate</li>
                    <li>Covering Kitchen premises and food service operations</li>
                    <li><strong>Local Cooks Inc., its officers, directors, employees, and agents must be named as additional insured</strong> on a primary, non-contributory basis (ISO CG 20 01 or equivalent)</li>
                  </ul>
                </li>
                <li><strong>Property Insurance:</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li>Covering Kitchen building, fixtures, and equipment</li>
                    <li>Replacement cost coverage</li>
                  </ul>
                </li>
              </ol>
              <p className="mb-4"><strong>Certificate of Insurance:</strong> Kitchen Owners must provide a Certificate of Insurance at time of listing and annually thereafter, showing:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Coverage amounts and policy numbers</li>
                <li>Additional insured endorsement</li>
                <li>Policy effective and expiration dates</li>
                <li>At least 10 days&apos; notice to Local Cooks if policy is cancelled or non-renewed</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">12.2 Chef Insurance Requirements</h3>
              <p className="mb-4"><strong>Chefs must maintain and provide proof of:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>General Liability or Product Liability Insurance:</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li>Minimum $1,000,000 per occurrence</li>
                    <li>Covering Chef&apos;s food products and operations</li>
                    <li><strong>The Kitchen Owner for each Booking must be named as additional insured</strong> on a primary basis</li>
                    <li>Coverage for foodborne illness, allergic reactions, contamination, and third-party injury</li>
                  </ul>
                </li>
                <li><strong>Workers&apos; Compensation Insurance (if applicable):</strong>
                  <ul className="list-disc pl-6 mt-2">
                    <li>If Chef has employees in any province, statutory limits per provincial requirements</li>
                  </ul>
                </li>
              </ol>
              <p className="mb-4"><strong>Certificate of Insurance:</strong> Chefs must provide a Certificate of Insurance before their first Booking and annually thereafter.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">12.3 Insurance Verification</h3>
              <p className="mb-4">Local Cooks will verify:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Certificate is issued by a licensed insurer or broker</li>
                <li>Coverage limits meet minimums</li>
                <li>Additional insured endorsement is present</li>
                <li>Certificate is not expired</li>
              </ul>
              <p className="mb-4"><strong>Local Cooks does NOT:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Verify that policies are active or premiums paid</li>
                <li>Assess adequacy of coverage for specific risks</li>
                <li>Contact insurers independently</li>
                <li>Provide insurance advice or recommendations</li>
              </ul>
              <p className="mb-4"><strong>You are solely responsible for ensuring your insurance is active, adequate, and compliant.</strong></p>

              <h3 className="text-xl font-semibold mt-6 mb-3">12.4 Waiver of Subrogation</h3>
              <p className="mb-4"><strong>Kitchen Owners and Chefs grant each other and Local Cooks a waiver of subrogation.</strong> This means:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>If Chef is injured in Kitchen and Chef&apos;s insurance pays claim, Chef&apos;s insurer waives the right to sue Kitchen Owner for reimbursement</li>
                <li>If Kitchen Owner&apos;s property is damaged and Owner&apos;s insurance pays claim, Owner&apos;s insurer waives the right to sue Chef (except in cases of intentional damage or gross negligence)</li>
              </ul>
              <p className="mb-4">This mutual waiver reduces disputes and claim complications.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">12.5 Kitchen Owner Liability</h3>
              <p className="mb-4"><strong>Kitchen Owner is fully liable for:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Injuries, death, or property damage caused by Kitchen Owner&apos;s negligence or willful misconduct</li>
                <li>Injuries or damage caused by defective equipment, poor maintenance, unsafe conditions, or failure to maintain the Kitchen</li>
                <li>Claims arising from Kitchen Owner&apos;s failure to comply with Applicable Law (building codes, food safety regulations, etc.)</li>
                <li>Claims arising from Kitchen Owner&apos;s breach of these Terms</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">12.6 Chef Liability</h3>
              <p className="mb-4"><strong>Chef is fully liable for:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Injuries, death, or property damage caused by Chef&apos;s negligence or willful misconduct</li>
                <li>Injuries, illness, or damage caused by Chef&apos;s food products (foodborne illness, allergic reactions, contamination, etc.)</li>
                <li>Injuries or damage caused by Chef&apos;s employees or staff</li>
                <li>Property damage to Kitchen, fixtures, or equipment caused by Chef&apos;s use</li>
                <li>Claims arising from Chef&apos;s failure to comply with Applicable Law or food safety regulations</li>
                <li>Claims arising from Chef&apos;s breach of these Terms</li>
              </ul>
              <p className="mb-4"><strong>Chefs specifically acknowledge that Kitchen Owner and Local Cooks are NOT liable for:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Any injury or illness caused by food prepared by Chef</li>
                <li>Any third-party claims from Chef&apos;s customers, employees, or invitees</li>
                <li>Any property damage caused by Chef&apos;s use of equipment</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">12.7 Local Cooks Limited Liability</h3>
              <p className="mb-4"><strong>Local Cooks is NOT liable for:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>The condition, safety, or regulatory compliance of any Kitchen</li>
                <li>The quality, safety, or legality of food prepared by Chefs</li>
                <li>Injuries, illnesses, or property damage occurring in Kitchens</li>
                <li>Breach of contract or negligence by Kitchen Owners or Chefs</li>
                <li>Foodborne illness, allergic reactions, or contamination</li>
                <li>Equipment failure or malfunction</li>
                <li>Third-party claims</li>
                <li>Business losses, lost profits, or interruption</li>
                <li>Cyber-attacks, data breaches, or Platform downtime (except as required by privacy laws)</li>
                <li>Acts or omissions of Users</li>
              </ul>
              <p className="mb-4"><strong>See Section 17 for full Limitation of Liability.</strong></p>
              <p className="mb-4">These limitations reflect that Local Cooks does not own or operate the Kitchens and does not prepare or sell food, and that our role is limited to providing the Platform and payment infrastructure described in these Terms.</p>

              <hr className="my-8" />

              {/* SECTION 13 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">13. FOOD SAFETY AND LEGAL COMPLIANCE</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">13.1 Governing Regulations</h3>
              <p className="mb-4"><strong>All Users must comply with:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Newfoundland &amp; Labrador Food Premises Regulations (Consolidated NL Regulation 1022/96)</li>
                <li>Food and Drug Act (Canada)</li>
                <li>Health and Community Services Act (NL)</li>
                <li>Occupational Health &amp; Safety Act (NL)</li>
                <li>Building and Fire Codes (National Building Code as adopted in NL)</li>
                <li>Municipal bylaws</li>
              </ul>
              <p className="mb-4">Copies of regulations are available from Service NL (www.gov.nl.ca).</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.2 Food Handler Certification</h3>
              <p className="mb-4"><strong>At least one person present during food preparation must hold valid Food Handler Certification</strong> issued by an approved provider, such as:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Health Canada-approved online courses</li>
                <li>Canadian Food Safety Certification Board</li>
                <li>Alberta Health Services FoodSafe</li>
                <li>Other accredited providers recognized in Newfoundland &amp; Labrador</li>
              </ul>
              <p className="mb-4"><strong>Both Kitchen Owners and Chefs must provide proof of certification</strong> (certificate name, number, certificant name, issue and expiry dates, provider name).</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.3 Food Product Approval</h3>
              <p className="mb-4"><strong>Kitchen Owners may restrict types of food products prepared in their Kitchens.</strong> Common restrictions:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>High-risk foods (meat, fish, dairy, eggs)</li>
                <li>Allergen-prone foods (nuts, shellfish)</li>
                <li>Foods requiring scheduled processes (acidified foods, canned goods, jams)</li>
                <li>Foods requiring specialized licensing</li>
              </ul>
              <p className="mb-4"><strong>Chefs must:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Disclose specific food product(s) planned for preparation</li>
                <li>Obtain Kitchen Owner approval before Booking (if product type is not pre-approved in listing)</li>
                <li>Follow all food safety protocols specific to the product (temperature logs, allergen separation, HACCP)</li>
                <li>Obtain any required regulatory approvals before preparation</li>
              </ol>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.4 Temperature Control</h3>
              <p className="mb-4"><strong>Chefs must maintain proper food temperatures:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Hot foods:</strong> ≥63°C (145°F) until service</li>
                <li><strong>Cold foods:</strong> ≤4°C (40°F) during storage and service</li>
                <li><strong>Freezer:</strong> ≤-18°C (0°F)</li>
              </ul>
              <p className="mb-4"><strong>Chefs preparing potentially hazardous foods should implement HACCP principles:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Identify critical control points (cooking temp, cooling time)</li>
                <li>Monitor and log temperatures</li>
                <li>Take corrective actions if temperatures are out of range</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.5 Allergen Management</h3>
              <p className="mb-4"><strong>Chefs must:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Disclose all major allergens in food products (peanuts, tree nuts, milk, eggs, soy, wheat, fish, shellfish, sesame, sulphites, mustard, celery)</li>
                <li>Label finished products with complete ingredient lists and allergen statements</li>
                <li>Prevent cross-contamination using separate utensils, cutting boards, surfaces</li>
                <li>Inform customers of all allergens before sale</li>
              </ul>
              <p className="mb-4">Local Cooks does not create, label, or sell food products and is not in a position to verify allergen declarations. Kitchen Owners do not supervise individual recipes or labels created by Chefs. For this reason, Chefs are solely responsible for the accuracy and completeness of allergen disclosures on their products and for preventing cross&#8209;contamination in their use of the Kitchen.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.6 Inspection Cooperation</h3>
              <p className="mb-4"><strong>If food safety inspectors visit during a Chef&apos;s rental:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Chef must cooperate fully and answer all questions truthfully</li>
                <li>Chef must not obstruct or impede inspection</li>
                <li>Chef must remain on premises until inspection is complete</li>
                <li>Chef must provide documentation (Food Handler Cert, product labels, process records) upon request</li>
              </ul>
              <p className="mb-4"><strong>Failure to cooperate may result in:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Inspection violations noted against Kitchen&apos;s Food Premises Licence</li>
                <li>Health code citations or fines to Chef</li>
                <li>License suspension or revocation (affecting Kitchen Owner)</li>
                <li>Chef suspension or termination from Platform</li>
              </ul>
              <p className="mb-4"><strong>Kitchen Owner is responsible for Kitchen maintenance and compliance; Chef is responsible for food product safety.</strong></p>

              <hr className="my-8" />

              {/* SECTION 14 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">14. ACCEPTABLE USE AND CONDUCT</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">14.1 Prohibited Conduct</h3>
              <p className="mb-4"><strong>Users may NOT:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Use the Platform for any illegal purpose or violate Applicable Law</li>
                <li>Prepare or distribute food that is unsafe, contaminated, mislabeled, or misrepresented</li>
                <li>Discriminate against, harass, threaten, or abuse other Users based on protected characteristics (race, gender, religion, age, disability, etc.)</li>
                <li>Engage in fraud, misrepresentation, deception, or identity theft</li>
                <li>Access the Platform using automated tools (bots, scrapers) without permission</li>
                <li>Reverse-engineer, hack, or compromise Platform security</li>
                <li>Disrupt Platform operations or interfere with other Users&apos; access</li>
                <li>Engage in food tampering, contamination, or adulteration</li>
                <li>Operate without required licenses, permits, or certifications</li>
                <li>Sublicense, resell, or transfer Platform access to unauthorized parties</li>
                <li>Post false, defamatory, malicious, or offensive content</li>
                <li>Attempt to circumvent payment processing or avoid Platform Fees</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">14.2 Community Standards</h3>
              <p className="mb-4"><strong>Users must:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Treat all Users with respect and professionalism</li>
                <li>Communicate honestly and accurately</li>
                <li>Respond promptly to messages and booking requests</li>
                <li>Honor commitments and agreements</li>
                <li>Report violations of these Terms to Local Cooks</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">14.3 Monitoring and Enforcement</h3>
              <p className="mb-4"><strong>Local Cooks may:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Monitor User conduct and respond to complaints</li>
                <li>Request documentation (licenses, insurance, certifications) at any time</li>
                <li>Suspend or terminate accounts for violations</li>
                <li>Cooperate with law enforcement and regulatory authorities</li>
                <li>Remove content (messages, reviews, listings) that violates these Terms</li>
              </ul>
              <p className="mb-4"><strong>Local Cooks is NOT responsible for monitoring every interaction or ensuring 100% compliance.</strong> Users are responsible for their own conduct and due diligence.</p>

              <hr className="my-8" />

              {/* SECTION 15 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">15. REVIEWS AND RATINGS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">15.1 Review System</h3>
              <p className="mb-4"><strong>After each completed Booking, both parties may leave reviews:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Kitchen Owner reviews Chef:</strong> Cleanliness, professionalism, timeliness, adherence to rules</li>
                <li><strong>Chef reviews Kitchen:</strong> Accuracy of listing, equipment condition, cleanliness, communication</li>
              </ul>
              <p className="mb-4"><strong>Reviews are visible to other Users</strong> and influence search rankings and trust scores.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">15.2 Review Guidelines</h3>
              <p className="mb-4"><strong>Reviews must be:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Honest, accurate, and based on actual experience</li>
                <li>Respectful and constructive</li>
                <li>Submitted within 14 days after Booking completion</li>
              </ul>
              <p className="mb-4"><strong>Reviews must NOT:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Contain false, misleading, defamatory, or malicious statements</li>
                <li>Include personal information (phone numbers, addresses, emails)</li>
                <li>Contain discriminatory, harassing, or threatening language</li>
                <li>Be offered or exchanged for compensation, discounts, or favourable treatment</li>
                <li>Reference disputes, legal proceedings, or claims</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">15.3 Review Moderation</h3>
              <p className="mb-4"><strong>Local Cooks may remove reviews that violate these guidelines.</strong> If a review is flagged:</p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Reviewer notified of concern and given opportunity to edit</li>
                <li>If not corrected within 48 hours, review may be removed or hidden</li>
                <li>Repeated violations may result in loss of review privileges</li>
              </ol>
              <p className="mb-4"><strong>Local Cooks does NOT edit reviews—reviews are either kept as-is or removed entirely.</strong></p>

              <hr className="my-8" />

              {/* SECTION 16 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">16. DISPUTE RESOLUTION</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">16.1 Informal Resolution</h3>
              <p className="mb-4"><strong>Users should first attempt to resolve disputes directly with each other</strong> through Platform messaging or direct communication.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">16.2 Platform-Assisted Resolution</h3>
              <p className="mb-4"><strong>If direct resolution fails, Users may request Platform assistance</strong> by contacting Local Cooks Support (support@localcook.shop).</p>
              <p className="mb-4"><strong>Platform-Assisted Resolution process:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li><strong>Submission:</strong> User submits dispute with description, supporting evidence, and desired resolution</li>
                <li><strong>Notification:</strong> Other party notified and given 48 hours to respond</li>
                <li><strong>Review:</strong> Local Cooks Admin reviews all evidence within 5-7 business days</li>
                <li><strong>Decision:</strong> Admin issues non-binding recommendation for resolution</li>
                <li><strong>Follow-up:</strong> If parties accept, resolution is implemented. If not, parties may escalate</li>
              </ol>

              <h3 className="text-xl font-semibold mt-6 mb-3">16.3 Mediation</h3>
              <p className="mb-4"><strong>If Platform-Assisted Resolution fails, either party may request mediation:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Mediation conducted by a qualified mediator in St. John&apos;s, Newfoundland</li>
                <li>Costs split equally between parties unless agreed otherwise</li>
                <li>Mediation is non-binding unless parties reach a written settlement</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">16.4 Arbitration</h3>
              <p className="mb-4"><strong>If mediation fails or is declined by either party, disputes shall be resolved by binding arbitration:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Conducted under the Arbitration Act (NL) or equivalent provincial legislation</li>
                <li>Single arbitrator, mutually agreed or appointed by the court</li>
                <li>Location: St. John&apos;s, Newfoundland and Labrador</li>
                <li>Language: English</li>
                <li>Costs: Shared equally unless arbitrator determines otherwise</li>
              </ul>
              <p className="mb-4"><strong>Class Action Waiver:</strong> Users agree to resolve disputes individually and waive the right to participate in class action lawsuits or class arbitration against Local Cooks.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">16.5 Small Claims Exception</h3>
              <p className="mb-4"><strong>Either party may bring an individual action in Small Claims Court</strong> (Provincial Court of Newfoundland and Labrador) for claims within the court&apos;s jurisdictional limits, without first pursuing mediation or arbitration.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">16.6 Governing Law</h3>
              <p className="mb-4"><strong>These Terms are governed by the laws of the Province of Newfoundland and Labrador</strong> and the federal laws of Canada applicable therein, without regard to conflict of law principles.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">16.7 Limitation Period</h3>
              <p className="mb-4"><strong>All claims must be brought within one (1) year of the event giving rise to the claim,</strong> except where Applicable Law provides a longer limitation period. Claims not brought within this period are permanently barred.</p>

              <hr className="my-8" />

              {/* SECTION 17 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">17. LIMITATION OF LIABILITY</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">17.1 Disclaimer of Warranties</h3>
              <p className="mb-4"><strong>THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,</strong> including but not limited to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Merchantability or fitness for a particular purpose</li>
                <li>Accuracy, completeness, or reliability of Platform content</li>
                <li>Uninterrupted or error-free operation</li>
                <li>Security or virus-free operation</li>
                <li>Suitability of any Kitchen or Chef for a particular use</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">17.2 Limitation of Damages</h3>
              <p className="mb-4"><strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW, LOCAL COOKS&apos; TOTAL LIABILITY ARISING FROM OR RELATED TO THESE TERMS OR YOUR USE OF THE PLATFORM SHALL NOT EXCEED:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>The total Platform Fees paid by you in the 12 months preceding the claim; OR</li>
                <li>$500 CAD, whichever is greater</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">17.3 Exclusion of Consequential Damages</h3>
              <p className="mb-4"><strong>IN NO EVENT SHALL LOCAL COOKS BE LIABLE FOR:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Indirect, incidental, special, consequential, or punitive damages</li>
                <li>Loss of profits, revenue, business, data, goodwill, or anticipated savings</li>
                <li>Cost of substitute products or services</li>
                <li>Damages arising from reliance on information obtained through the Platform</li>
              </ul>
              <p className="mb-4"><strong>This limitation applies regardless of the theory of liability</strong> (contract, tort, strict liability, or otherwise), even if Local Cooks has been advised of the possibility of such damages.</p>
              <p className="mb-4">To the extent you are entitled to non&#8209;waivable statutory remedies under Applicable Law (including consumer protection legislation where you qualify as a consumer), nothing in this Section limits those statutory remedies.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">17.4 Essential Purpose</h3>
              <p className="mb-4"><strong>These limitations reflect a reasonable allocation of risk</strong> and are an essential element of the basis of the bargain between you and Local Cooks. The Platform would not be provided without these limitations.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">17.5 Indemnification</h3>
              <p className="mb-4"><strong>You agree to indemnify, defend, and hold harmless Local Cooks, its officers, directors, employees, agents, and affiliates</strong> from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising from or related to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Your use of the Platform or any breach of these Terms</li>
                <li>Your violation of any Applicable Law</li>
                <li>Your negligence or willful misconduct</li>
                <li>Any content you submit, post, or transmit through the Platform</li>
                <li>Any claim by a third party related to your use of the Platform, your food products, your Kitchen, or your services</li>
                <li>Any Damage Claim, overstay penalty, or dispute involving you</li>
                <li>Any foodborne illness, injury, or property damage caused by your actions or omissions</li>
              </ul>

              <hr className="my-8" />

              {/* SECTION 18 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">18. TERMINATION</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">18.1 User Termination</h3>
              <p className="mb-4"><strong>You may terminate your account at any time</strong> by contacting Local Cooks Support (support@localcook.shop) or through your account settings.</p>
              <p className="mb-4"><strong>Before termination:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Complete or cancel all active Bookings</li>
                <li>Resolve all outstanding Damage Claims and disputes</li>
                <li>Pay all outstanding fees, penalties, and charges</li>
                <li>Retrieve all stored items from Kitchens</li>
              </ul>
              <p className="mb-4"><strong>After termination:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Your listings, reviews, and profile data will be deactivated (not permanently deleted for legal/tax record-keeping)</li>
                <li>Your payment information will be securely deleted from Stripe</li>
                <li>Any pending payouts will be processed within 30 days</li>
                <li>You will no longer have access to the Platform</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">18.2 Local Cooks Termination</h3>
              <p className="mb-4"><strong>Local Cooks may suspend or terminate your account:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Immediately (without notice):</strong> For safety violations, fraud, illegal activity, regulatory non-compliance, or conduct that poses risk to Users or public safety</li>
                <li><strong>With 7 days&apos; notice:</strong> For repeated violations, chronic non-compliance, excessive cancellations, or failure to maintain required documentation</li>
                <li><strong>With 30 days&apos; notice:</strong> For business reasons (e.g., Platform discontinuation, service area changes)</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">18.3 Effect of Termination</h3>
              <p className="mb-4">Upon termination:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>All licenses granted to you under these Terms are immediately revoked</li>
                <li>All pending Bookings are cancelled (refunds per applicable cancellation policy)</li>
                <li>Outstanding obligations (payment, indemnification, liability) survive termination</li>
                <li>Sections that by their nature should survive (Limitation of Liability, Indemnification, Dispute Resolution, Governing Law) will survive indefinitely</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">18.4 Reactivation</h3>
              <p className="mb-4"><strong>Terminated accounts may be reactivated</strong> at Local Cooks&apos; sole discretion, subject to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Resolution of the issue(s) that led to termination</li>
                <li>Updated documentation (licenses, insurance, certifications)</li>
                <li>Payment of any outstanding fees</li>
                <li>Agreement to enhanced monitoring or conditions</li>
              </ul>

              <hr className="my-8" />

              {/* SECTION 19 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">19. MISCELLANEOUS PROVISIONS</h2>
              <h3 className="text-xl font-semibold mt-6 mb-3">19.1 Entire Agreement</h3>
              <p className="mb-4">These Terms, together with the Privacy Policy, constitute the entire agreement between you and Local Cooks regarding your use of the Platform. These Terms supersede all prior agreements, representations, and understandings.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.2 Amendments</h3>
              <p className="mb-4"><strong>Local Cooks may modify these Terms at any time</strong> by posting the updated version on the Platform. Material changes will be communicated via email or Platform notification at least 30 days before taking effect.</p>
              <p className="mb-4"><strong>Your continued use of the Platform after the effective date constitutes acceptance of the modified Terms.</strong> If you do not agree with the changes, you must stop using the Platform and terminate your account before the effective date.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.3 Severability</h3>
              <p className="mb-4">If any provision of these Terms is found invalid, illegal, or unenforceable, the remaining provisions will continue in full force and effect. The invalid provision will be modified to the minimum extent necessary to make it valid and enforceable.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.4 Waiver</h3>
              <p className="mb-4">Failure to enforce any right or provision of these Terms does not constitute a waiver of that right or provision. A waiver of any right is only effective if in writing and signed by the waiving party.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.5 Assignment</h3>
              <p className="mb-4"><strong>You may not assign or transfer your rights under these Terms</strong> without Local Cooks&apos; prior written consent. Local Cooks may assign its rights and obligations under these Terms to an affiliate, successor, or acquirer without your consent.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.6 Notices</h3>
              <p className="mb-4"><strong>Notices from Local Cooks to you:</strong> Via email to your registered email address, or through the Platform&apos;s notification system. Notices are effective when sent.</p>
              <p className="mb-4"><strong>Notices from you to Local Cooks:</strong> Via email to legal@localcooks.ca. Notices are effective when received.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.7 Force Majeure</h3>
              <p className="mb-4"><strong>Neither party shall be liable for failure to perform</strong> due to circumstances beyond reasonable control, including but not limited to:</p>
              <ul className="list-disc pl-6 mb-4">
                <li>Natural disasters (hurricanes, earthquakes, floods, severe winter storms)</li>
                <li>Pandemic, epidemic, or public health emergency</li>
                <li>Government orders, regulations, or restrictions</li>
                <li>War, terrorism, civil unrest</li>
                <li>Utility failures (power, water, internet)</li>
                <li>Strikes or labour disputes</li>
                <li>Cyber-attacks or infrastructure failures</li>
              </ul>
              <p className="mb-4"><strong>Affected party must:</strong></p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Notify the other party promptly</li>
                <li>Use reasonable efforts to mitigate the impact</li>
                <li>Resume performance when the force majeure event ends</li>
              </ol>
              <p className="mb-4">If force majeure continues for more than 30 days, either party may terminate affected Bookings with full refund to Chef.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.8 Independent Contractors</h3>
              <p className="mb-4"><strong>Kitchen Owners and Chefs are independent contractors, NOT employees, agents, joint venturers, or partners of Local Cooks.</strong> Nothing in these Terms creates an employment, agency, or partnership relationship.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.9 Third-Party Rights</h3>
              <p className="mb-4">These Terms do not create rights for any third parties. No third party may enforce any provision of these Terms.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.10 Headings</h3>
              <p className="mb-4">Section headings are for convenience only and do not affect interpretation of these Terms.</p>

              <h3 className="text-xl font-semibold mt-6 mb-3">19.11 Language</h3>
              <p className="mb-4">These Terms are drafted in English. If any translated version conflicts with the English version, the English version prevails.</p>

              <hr className="my-8" />

              {/* SECTION 20 */}
              <h2 className="text-2xl font-bold mt-8 mb-4">20. CONTACT INFORMATION</h2>
              <p className="mb-4">If you have questions, concerns, or complaints about these Terms, please contact us:</p>
              <div className="mb-4">
                <p className="mb-2"><strong>Local Cooks Inc.</strong></p>
                <p className="mb-2">St. John&apos;s, Newfoundland and Labrador, Canada</p>
                <p className="mb-2"><strong>General Inquiries:</strong> info@localcooks.ca</p>
                <p className="mb-2"><strong>Support:</strong> support@localcook.shop</p>
                <p className="mb-2"><strong>Legal:</strong> legal@localcooks.ca</p>
                <p className="mb-2"><strong>Privacy:</strong> privacy@localcooks.ca</p>
              </div>
              <p className="mb-4"><strong>Response Times:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>General inquiries: Within 2 business days</li>
                <li>Support requests: Within 1 business day</li>
                <li>Legal matters: Within 5 business days</li>
                <li>Privacy requests: Within 30 days (as required by PIPEDA)</li>
              </ul>

              <hr className="my-8" />

              <p className="mb-4 text-center italic">By using the Local Cooks Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.</p>
              <p className="mb-4 text-center"><strong>© 2025 Local Cooks Inc. All rights reserved.</strong></p>

            </div>
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
}