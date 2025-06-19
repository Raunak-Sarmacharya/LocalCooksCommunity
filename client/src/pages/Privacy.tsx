import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { motion } from "framer-motion";
import { useEffect } from "react";

export default function Privacy() {
  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
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
              Privacy Policy
            </h1>
            
            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-8">
                <strong>Last Updated: [Date]</strong>
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">1. THIS PRIVACY POLICY</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">1.1 Our Commitment to Privacy</h3>
              <p className="mb-4">
                Local Cooks Inc. and its representatives, subsidiaries and affiliates (collectively, "Local Cooks", "we", "us" or "our") are committed to protecting your privacy. This Privacy Policy has been designed to comply with Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and other applicable federal, provincial and territorial privacy laws (collectively, "Privacy Laws"). This Privacy Policy forms part of and is hereby expressly incorporated into our Terms of Service.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">1.2 Scope</h3>
              <p className="mb-4">
                In this Privacy Policy, we explain how we collect, use, disclose and protect the personal information of our Users.
              </p>
              <p className="mb-4">
                You are a "User" if you are an individual who accesses our website located at [https://www.localcooks.ca] (the "Site"), uses our chef application and verification portal (the "Portal"), or accesses any information, function, feature, application, product or service made available by us (collectively, the "Service").
              </p>
              <p className="mb-4">
                Your "personal information" means any information about you as an identifiable individual and includes information such as your name, email address, phone number, professional credentials, and certifications. It does not include business contact information used solely for business communications or certain publicly available information.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">1.3 Updates</h3>
              <p className="mb-4">
                We may modify this Privacy Policy at any time, effective upon posting an updated version through the Service. Material modifications will be communicated with reasonable advance notice via email. Your continued use of the Service after the effective date constitutes acceptance of the updated Privacy Policy.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">2. INFORMATION WE COLLECT</h2>
              <p className="mb-4">
                We collect personal information when you provide it to us through your interactions with our Service. We minimize collection to what is reasonable and necessary for platform operations and verification purposes.
              </p>
              <p className="mb-4">
                We may collect the following categories of personal information:
              </p>

              <p className="mb-2"><strong>Account Information:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Full name and preferred name</li>
                <li>Email address and phone number</li>
                <li>Profile photo (optional)</li>
                <li>Login credentials (passwords are securely hashed)</li>
              </ul>

              <p className="mb-2"><strong>Professional Credentials:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Food establishment licenses and permit numbers</li>
                <li>Food safety certificates and expiration dates</li>
                <li>Professional certifications and training records</li>
                <li>Cooking preferences and specializations</li>
              </ul>

              <p className="mb-2"><strong>Technical Information:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>IP addresses and device information</li>
                <li>Firebase Authentication data including user agent strings</li>
                <li>Authentication tokens and session data</li>
                <li>Application usage data and system interactions</li>
              </ul>

              <p className="mb-2"><strong>Communication Data:</strong></p>
              <ul className="list-disc pl-6 mb-4">
                <li>Email correspondence history</li>
                <li>Application status notifications</li>
                <li>Support ticket information</li>
                <li>Platform messaging between users</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">3. HOW WE USE YOUR INFORMATION</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.1 Primary Purposes</h3>
              <p className="mb-4">
                We use your personal information for the following purposes:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Identity Verification:</strong> To verify your identity and professional credentials</li>
                <li><strong>Platform Operations:</strong> To create and manage your account, process applications, and facilitate connections between chefs and establishments</li>
                <li><strong>Credential Validation:</strong> To verify food safety certifications and establishment licenses with issuing authorities</li>
                <li><strong>Communication:</strong> To send application updates, system notifications, and essential service communications</li>
                <li><strong>Safety and Security:</strong> To prevent fraud, maintain platform security, and ensure compliance with food safety regulations</li>
                <li><strong>Legal Compliance:</strong> To meet requirements under PIPEDA, provincial regulations, and food safety laws</li>
                <li><strong>Platform Improvement:</strong> To analyze usage patterns and improve our services</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.2 Secondary Purposes</h3>
              <p className="mb-4">
                With your separate consent, we may use your information for:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Marketing communications about new platform features</li>
                <li>Industry research and analysis</li>
                <li>Integration with third-party services</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">4. INFORMATION SHARING AND DISCLOSURE</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Service Providers</h3>
              <p className="mb-4">
                We may share your information with trusted service providers who assist us in operating our platform:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Firebase/Google Cloud Services</strong> (US-based) for authentication and infrastructure</li>
                <li><strong>Email service providers</strong> for transactional communications</li>
                <li><strong>Verification services</strong> for credential authentication</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Professional Verification</h3>
              <p className="mb-4">
                In connection with our verification services:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Food safety certification status may be shared with requesting establishments (with your consent)</li>
                <li>License validation is conducted directly with provincial health authorities</li>
                <li>Professional credentials are displayed to verified establishments upon mutual agreement</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Legal Requirements</h3>
              <p className="mb-4">
                We may disclose your information when required by law, including:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Court orders and legal proceedings</li>
                <li>Regulatory authority requests</li>
                <li>Public health emergencies requiring chef contact information</li>
                <li>Law enforcement investigations</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.4 Business Transitions</h3>
              <p className="mb-4">
                In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of the transaction. We will notify you of any such change in ownership or control.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.5 Cross-Border Data Transfers</h3>
              <p className="mb-4">
                Your personal information may be transferred to and processed in the United States through our use of Firebase/Google Cloud services. When we transfer information internationally, we ensure appropriate safeguards are in place to protect your information. However, information stored in foreign jurisdictions may be subject to access by courts, law enforcement, and national security authorities under their applicable laws.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">5. DATA RETENTION</h2>
              <p className="mb-4">
                We retain your personal information for as long as necessary to fulfill the purposes outlined in this Privacy Policy:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Active Account Information:</strong> Retained while your account is active</li>
                <li><strong>Professional Verification Records:</strong> 7 years after account closure for liability and regulatory requirements</li>
                <li><strong>Communication Records:</strong> 2 years after last communication</li>
                <li><strong>Security Logs:</strong> Minimum 2 years for breach investigation purposes</li>
                <li><strong>Certificate Data:</strong> Until expiration plus 1 year for audit purposes</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">6. YOUR PRIVACY RIGHTS</h2>
              <p className="mb-4">
                Under PIPEDA, you have the following rights regarding your personal information:
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Access Rights</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Request information about what personal data we hold about you</li>
                <li>Receive an explanation of how your information is used and shared</li>
                <li>Obtain a copy of your personal information (subject to identity verification)</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Correction Rights</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Request correction of inaccurate or incomplete information</li>
                <li>Add clarifying notes if we disagree with requested corrections</li>
                <li>Ensure corrections are communicated to relevant third parties</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.3 Consent Management</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Withdraw consent for non-essential uses at any time</li>
                <li>Opt out of marketing communications</li>
                <li>Request deletion when information is no longer required</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.4 Response Timeline</h3>
              <p className="mb-4">
                We respond to privacy requests within 30 days (extendable to 60 days with notice).
              </p>
              <p className="mb-4">
                To exercise these rights, contact us at privacy@localcooks.ca.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">7. SECURITY MEASURES</h2>
              <p className="mb-4">
                We implement comprehensive security safeguards to protect your personal information:
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">7.1 Technical Measures</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Industry-standard encryption for data transmission (HTTPS) and storage</li>
                <li>Secure password hashing using modern cryptographic algorithms</li>
                <li>Multi-factor authentication for administrative access</li>
                <li>Regular security audits and penetration testing</li>
                <li>Automated threat monitoring and incident response</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">7.2 Organizational Measures</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Employee background checks and confidentiality agreements</li>
                <li>Role-based access controls limiting data access</li>
                <li>Regular privacy and security training</li>
                <li>Documented data handling procedures</li>
                <li>Incident response plans</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">7.3 Your Role in Security</h3>
              <p className="mb-4">
                You can help protect your information by:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Using strong, unique passwords</li>
                <li>Keeping login credentials confidential</li>
                <li>Logging out after each session</li>
                <li>Promptly reporting suspicious activity</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">8. EMAIL COMMUNICATIONS</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Transactional Messages (No Consent Required)</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Account verification and password resets</li>
                <li>Application status updates</li>
                <li>System maintenance notifications</li>
                <li>Legal notices and policy updates</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Marketing Communications (Express Consent Required)</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Platform feature announcements</li>
                <li>Industry news and opportunities</li>
                <li>Promotional offers</li>
              </ul>
              <p className="mb-4">
                All marketing emails include clear unsubscribe options. Requests are processed within 10 business days.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">9. DATA BREACH NOTIFICATION</h2>
              <p className="mb-4">
                If a breach creates real risk of significant harm, we will:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Notify the Privacy Commissioner of Canada as soon as feasible</li>
                <li>Notify affected individuals directly</li>
                <li>Provide information about the breach and mitigation steps</li>
                <li>Maintain breach records for minimum 2 years</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">10. COOKIES AND TRACKING</h2>
              <p className="mb-4">
                We use essential cookies for authentication and security purposes. These cookies are necessary for platform functionality and cannot be disabled. We do not use tracking cookies for advertising purposes.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">11. CHILDREN'S PRIVACY</h2>
              <p className="mb-4">
                Our Service is not intended for individuals under 18 years of age. We do not knowingly collect information from minors. If we learn that we have collected information from someone under 18, we will promptly delete it.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">12. THIRD-PARTY LINKS</h2>
              <p className="mb-4">
                Our Service may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to review their privacy policies.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">13. CONTACT US</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.1 Privacy Officer</h3>
              <p className="mb-4">
                For questions about this Privacy Policy or to exercise your privacy rights:
              </p>
              <p className="mb-4">
                <strong>Local Cooks Inc.</strong><br/>
                [Address]<br/>
                St. John's, NL [Postal Code]<br/>
                Email: privacy@localcooks.ca<br/>
                Phone: [Phone Number]
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">13.2 Privacy Complaints</h3>
              <p className="mb-4">
                We take privacy concerns seriously. If you believe your privacy rights have been violated:
              </p>
              <ol className="list-decimal pl-6 mb-4">
                <li>Contact us first at privacy@localcooks.ca</li>
                <li>We will acknowledge your complaint within 2 business days</li>
                <li>We will investigate and respond within 30 days</li>
                <li>If you're unsatisfied with our response, you may contact:</li>
              </ol>

              <p className="mb-4">
                <strong>Office of the Privacy Commissioner of Canada</strong><br/>
                30 Victoria Street<br/>
                Gatineau, Quebec K1A 1H3<br/>
                Toll-free: 1-800-282-1376<br/>
                Website: www.priv.gc.ca
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">14. PRIVACY POLICY UPDATES</h2>
              <p className="mb-4">
                This Privacy Policy may be updated to reflect changes in our practices or legal requirements. We will notify you of material changes via:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Email notification to registered users</li>
                <li>Prominent notice on our platform</li>
                <li>30 days advance notice before changes take effect</li>
              </ul>
              <p className="mb-4">
                By continuing to use Local Cooks after updates take effect, you accept the revised Privacy Policy.
              </p>

              <hr className="my-8" />

              <p className="text-center text-gray-600">
                © 2025 Local Cooks Inc. All rights reserved.
              </p>
            </div>
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 