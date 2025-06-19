import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { motion } from "framer-motion";
import { useEffect } from "react";

export default function Terms() {
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
              Terms and Conditions - Chef Application Portal
            </h1>
            
            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-8">
                <strong>Last Updated: [Date]</strong>
              </p>

              <p className="text-sm leading-relaxed mb-8">
                PLEASE READ THESE TERMS OF SERVICE CAREFULLY. THIS AGREEMENT CONSTITUTES A LEGAL AGREEMENT BETWEEN LOCAL COOKS INC. AND ITS REPRESENTATIVES, SUBSIDIARIES AND AFFILIATES (COLLECTIVELY, "LOCAL COOKS", "WE", "US" OR "OUR") AND YOU ("YOU" OR "YOUR") REGARDING YOUR USE OF OUR CHEF APPLICATION AND VERIFICATION PORTAL. BY USING THIS PORTAL, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTAND AND AGREE TO BE BOUND BY THIS AGREEMENT.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">1. THIS AGREEMENT</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">1.1 Acceptance of this Agreement</h3>
              <p className="mb-4">
                By accessing the website located at [https://www.localcooks.ca] (the "Site"), using our chef application and verification portal (the "Portal"), or submitting an application to join Local Cooks (the "Service"), you are an "Applicant" or "User" and you hereby represent and warrant that:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>You have read, understand and agree to be bound by this Agreement and any other policies referenced herein, including our Privacy Policy</li>
                <li>You are at least 18 years of age (or the age of majority in your province) and have the authority to enter into this Agreement</li>
                <li>You are a professional chef or food service worker applying to join the Local Cooks platform</li>
                <li>All information you provide in your application is true and accurate</li>
              </ul>
              <p className="mb-4">
                If you do not agree to be bound by this Agreement, you may not access or use the Service.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">1.2 Modifications</h3>
              <p className="mb-4">
                Local Cooks reserves the right to modify these terms at any time. Material changes will be communicated with reasonable advance notice. Continued use after modifications constitutes acceptance. If you do not accept updated terms, you must cease using the Service.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">2. THE SERVICE</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.1 Description of the Service</h3>
              <p className="mb-4">
                Local Cooks operates a chef application and verification portal for food service professionals in Canada. The Service provides:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Online application system for chefs to join the Local Cooks platform</li>
                <li>Professional credential verification and validation</li>
                <li>Food safety certification verification</li>
                <li>Secure document upload and storage</li>
                <li>Application status tracking and updates</li>
              </ul>
              <p className="mb-4">
                <strong>Important:</strong> This portal is solely for chef applications and verification. No sales, transactions, or connections with establishments occur through this portal.
              </p>
              <p className="mb-4">
                <strong>Local Cooks is a technology platform and is not:</strong>
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>An employer or employment agency</li>
                <li>A professional licensing body</li>
                <li>A party to any employment relationships</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.2 User Categories</h3>
              <p className="mb-4">
                <strong>Chef Applicants:</strong> Food service professionals applying to join the Local Cooks platform<br/>
                <strong>Administrators:</strong> Authorized Local Cooks personnel reviewing applications and managing verifications
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.3 Platform Limitations</h3>
              <p className="mb-4">
                Local Cooks provides verification services but cannot guarantee:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Accuracy of all third-party verification data</li>
                <li>Immediate updates to professional status changes</li>
                <li>Professional conduct beyond verified credentials</li>
                <li>Availability of service at all times</li>
              </ul>
              <p className="mb-4">
                <strong>Free Service:</strong> This application portal is provided free of charge. No fees are required to submit or process applications.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">2.4 Account Registration</h3>
              <p className="mb-4">
                To submit a chef application, you must register an account by providing:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Accurate, current, and complete personal information</li>
                <li>Valid professional credentials and certifications</li>
                <li>Proof of food safety certification</li>
                <li>Food establishment license (where applicable)</li>
              </ul>
              <p className="mb-4">
                You are responsible for:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Maintaining confidentiality of login credentials</li>
                <li>All activities under your account</li>
                <li>Immediately notifying us of unauthorized access</li>
                <li>Keeping application information current during review process</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">3. USER OBLIGATIONS</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.1 Application Standards</h3>
              <p className="mb-4">
                All applicants agree to:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Provide truthful and accurate information</li>
                <li>Submit only authentic documents and certifications</li>
                <li>Maintain current food safety certifications</li>
                <li>Comply with all applicable regulations</li>
                <li>Promptly respond to verification requests</li>
                <li>Update application if circumstances change</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.2 Acceptable Use</h3>
              <p className="mb-4">
                You may use the Service only for submitting legitimate chef applications. You agree NOT to:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Submit false or misleading application information</li>
                <li>Upload forged or altered documents</li>
                <li>Impersonate another person or use false credentials</li>
                <li>Submit multiple applications under different identities</li>
                <li>Circumvent verification processes</li>
                <li>Access other applicants' information</li>
                <li>Use automated tools to submit applications</li>
                <li>Violate any applicable laws or regulations</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.3 Chef Applicant Obligations</h3>
              <p className="mb-4">
                Chef applicants agree to:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Provide accurate and truthful information in their application</li>
                <li>Upload valid and current certifications</li>
                <li>Pass required food safety certifications</li>
                <li>Maintain valid food establishment licenses</li>
                <li>Promptly respond to verification requests</li>
                <li>Update application if credentials change during review process</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">3.4 Content and Communications</h3>
              <p className="mb-4">
                You are responsible for all content you submit, including:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Professional credentials and certifications</li>
                <li>Profile information and descriptions</li>
                <li>Messages and communications</li>
                <li>Reviews and feedback</li>
              </ul>
              <p className="mb-4">
                All content must be:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Accurate and truthful</li>
                <li>Professional and respectful</li>
                <li>Free from offensive or discriminatory language</li>
                <li>Compliant with all applicable laws</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">4. INTELLECTUAL PROPERTY</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Local Cooks Property</h3>
              <p className="mb-4">
                All platform content, software, designs, and trademarks are owned by Local Cooks and protected by intellectual property laws. You may not:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Copy, modify, or create derivative works</li>
                <li>Reverse engineer platform technology</li>
                <li>Use our trademarks without permission</li>
                <li>Extract data for commercial purposes</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Application Content</h3>
              <p className="mb-4">
                You retain ownership of documents you submit but grant Local Cooks a limited license to:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Review and verify your credentials</li>
                <li>Contact issuing authorities for verification</li>
                <li>Store documents for application processing</li>
                <li>Transfer approved applications to the main platform</li>
                <li>Retain records as required by law</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Feedback</h3>
              <p className="mb-4">
                Any suggestions or feedback you provide becomes property of Local Cooks and may be used without compensation or attribution.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">5. PRIVACY AND DATA PROTECTION</h2>
              <p className="mb-4">
                Your use of the Service is subject to our Privacy Policy, which is incorporated by reference. Key points:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>We collect only necessary information</li>
                <li>We comply with PIPEDA and applicable privacy laws</li>
                <li>Your data may be processed in the US through Firebase</li>
                <li>You have rights to access and correct your information</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">6. LIABILITY AND DISCLAIMERS</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Service Disclaimer</h3>
              <p className="mb-4">
                THE SERVICE IS PROVIDED "AS-IS" WITHOUT WARRANTIES OF ANY KIND. WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Limitation of Liability</h3>
              <p className="mb-4">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM YOUR USE OF THIS APPLICATION PORTAL SHALL NOT EXCEED $100 CAD.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.3 Excluded Damages</h3>
              <p className="mb-4">
                We are not liable for indirect, consequential, incidental, punitive, or special damages including:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Lost profits or opportunities</li>
                <li>Reputational harm</li>
                <li>Third-party claims</li>
                <li>Data loss not resulting from our negligence</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.4 Exceptions</h3>
              <p className="mb-4">
                These limitations do not apply to:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Fraud or willful misconduct</li>
                <li>Gross negligence</li>
                <li>Personal injury or death</li>
                <li>Violations of consumer protection laws</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">6.5 Application Portal Disclaimer</h3>
              <p className="mb-4">
                Local Cooks is not responsible for:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Employment outcomes after application approval</li>
                <li>Future conduct of approved chefs</li>
                <li>Use of verified credentials outside this portal</li>
                <li>Third-party verification delays or errors</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">7. INDEMNIFICATION</h2>
              <p className="mb-4">
                You agree to defend, indemnify, and hold harmless Local Cooks and its affiliates from any claims, damages, or expenses arising from:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Your breach of this Agreement</li>
                <li>False or misleading information in your application</li>
                <li>Your violation of any laws</li>
                <li>Your use of the Service</li>
                <li>Content you submit</li>
                <li>Misuse of verified credentials</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">8. TERMINATION</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Termination by You</h3>
              <p className="mb-4">
                You may withdraw your application at any time by:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Providing written notice via email</li>
                <li>Note that submitted documents may be retained per our Privacy Policy</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Termination by Us</h3>
              <p className="mb-4">
                We may reject or terminate applications for:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Providing false or misleading information</li>
                <li>Failure to provide required documentation</li>
                <li>Not meeting verification requirements</li>
                <li>Violation of these Terms</li>
                <li>Professional misconduct discovered during verification</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">8.3 Effect of Termination</h3>
              <p className="mb-4">
                Upon termination or rejection:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Access to the portal ceases</li>
                <li>Application status is finalized</li>
                <li>Data retention follows Privacy Policy</li>
                <li>You may reapply after addressing rejection reasons (if applicable)</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">9. DISPUTE RESOLUTION</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.1 Informal Resolution</h3>
              <p className="mb-4">
                Before formal proceedings, parties agree to attempt resolution through:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Direct negotiation (30 days)</li>
                <li>Mediation if negotiation fails</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.2 Governing Law</h3>
              <p className="mb-4">
                This Agreement is governed by the laws of Newfoundland and Labrador and applicable Canadian federal law.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.3 Jurisdiction</h3>
              <p className="mb-4">
                You consent to exclusive jurisdiction of courts in Newfoundland and Labrador for any disputes.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">9.4 Time Limitation</h3>
              <p className="mb-4">
                Any claim must be brought within one year of the event giving rise to the claim.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">10. GENERAL PROVISIONS</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.1 Entire Agreement</h3>
              <p className="mb-4">
                This Agreement and Privacy Policy constitute the complete agreement between parties.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.2 Severability</h3>
              <p className="mb-4">
                If any provision is unenforceable, remaining provisions continue in effect.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.3 Assignment</h3>
              <p className="mb-4">
                You may not assign this Agreement. We may assign our rights and obligations.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.4 Waiver</h3>
              <p className="mb-4">
                No waiver is effective unless in writing. Failure to enforce any provision does not waive future enforcement.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.5 Force Majeure</h3>
              <p className="mb-4">
                Neither party is liable for delays due to circumstances beyond reasonable control.
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">10.6 Notices</h3>
              <p className="mb-4">
                Notices may be provided via:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Email to registered address</li>
                <li>Portal notifications</li>
                <li>Postal mail to address on file</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">11. CONSUMER PROTECTION</h2>
              <p className="mb-4">
                In accordance with Newfoundland and Labrador's Consumer Protection and Business Practices Act:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>All terms are clearly disclosed</li>
                <li>No unfair or deceptive practices</li>
                <li>Complaint resolution procedures available</li>
                <li>Electronic commerce requirements met</li>
              </ul>

              <h2 className="text-2xl font-bold mt-8 mb-4">12. ACCESSIBILITY</h2>
              <p className="mb-4">
                Local Cooks is committed to accessibility. If you need assistance accessing our Service, please contact support@localcooks.ca.
              </p>

              <h2 className="text-2xl font-bold mt-8 mb-4">13. CONTACT INFORMATION</h2>

              <h3 className="text-xl font-semibold mt-6 mb-3">General Inquiries</h3>
              <p className="mb-4">
                Email: support@localcooks.ca<br/>
                Phone: [Phone Number]
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">Legal Notices</h3>
              <p className="mb-4">
                Local Cooks Inc.<br/>
                [Address]<br/>
                St. John's, NL [Postal Code]<br/>
                Email: legal@localcooks.ca
              </p>

              <h3 className="text-xl font-semibold mt-6 mb-3">Privacy Officer</h3>
              <p className="mb-4">
                Email: privacy@localcooks.ca
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