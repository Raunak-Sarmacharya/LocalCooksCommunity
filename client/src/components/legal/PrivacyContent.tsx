import { LegalDocument, type LegalSection } from "./LegalDocument";

/**
 * Local Cooks Privacy Policy (rewritten Oct 24, 2026). Written to PIPEDA's fair information principles and the OPC's
 * consent and cross-border guidance; Newfoundland and Labrador has no general private-sector privacy law, so PIPEDA
 * applies. The service providers listed are the ones the code uses (Stripe, Firebase, Supabase ca-central-1, Vercel,
 * Cloudflare R2, Twilio, Hostinger SMTP, Sentry, Inngest, Google Maps). Update this list when a provider changes.
 */
export const PRIVACY_UPDATED = "October 24, 2026";
export const PRIVACY_EFFECTIVE = "November 23, 2026";

const SUPPORT = <a href="mailto:support@localcooks.ca">support@localcooks.ca</a>;

const sections: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: <>
      <p>Local Cooks is operated by Jawrophi Delivery Inc., based in St. John's, Newfoundland and Labrador. We are responsible for the personal information we collect through localcooks.ca and its kitchen and customer sites.</p>
      <p>Our Privacy Officer is accountable for how we handle it. You can reach them at {SUPPORT}, and we will give you their name on request.</p>
      <p>We follow Canada's Personal Information Protection and Electronic Documents Act (PIPEDA).</p>
    </>,
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: <>
      <h3>When you create an account</h3>
      <p>Your name, email address, phone number, the role you sign up for, your language, and sign-in details. Passwords are handled by Google Firebase, and we never see them in plain text.</p>
      <h3>Kitchens</h3>
      <p>Your business name, address, contact details and logo; your food premises licence and its expiry date; listing details such as photos, rates, hours, policies and instructions; and records of how you answer requests, tours and bookings.</p>
      <h3>Customers</h3>
      <p>What you send a kitchen when you ask for access: documents such as a food handler certificate, a food establishment licence or proof of insurance, with their expiry dates, and your answers to the kitchen's questions. Also your bookings, tours and storage rentals.</p>
      <h3>Payments</h3>
      <p>Stripe processes all payments. We receive the amount, the last four digits and brand of the card, and Stripe's reference numbers, but never the full card number. Kitchens set up payouts directly with Stripe, which collects their identity and bank details. We receive only the account's status and payout records.</p>
      <h3>During and after a booking</h3>
      <p>Messages between kitchens and customers, check-in and check-out times, photos taken at check-in, check-out or move-out, problem reports, extra-time requests, damage claims with their receipts, and private feedback.</p>
      <h3>From your device</h3>
      <p>Your IP address, browser and device type, the pages you use, and error reports when something breaks. Section 6 covers cookies.</p>
    </>,
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    body: <>
      <ul>
        <li>to create and secure your account and confirm your email and phone number;</li>
        <li>to show listings, send access requests and documents to the kitchen you choose, and run tours, bookings and storage rentals;</li>
        <li>to take payments, issue refunds and pay kitchens;</li>
        <li>to send booking confirmations, reminders, receipts and account messages by email, text message and in the app;</li>
        <li>to review problem reports, damage claims, extra-time disputes and card disputes;</li>
        <li>to check a kitchen's licence and keep the platform safe, including preventing fraud and enforcing our <a href="/terms">Terms of Service</a>;</li>
        <li>to find and fix errors and understand which parts of the platform people use, so we can improve them;</li>
        <li>to keep the tax, accounting and legal records the law requires.</li>
      </ul>
      <p>We may also email you news and offers about Local Cooks, as Canada's anti-spam law allows. To stop them, write to {SUPPORT} and we will take you off the list within 10 business days. If we want to use your information for a purpose not listed here, we will ask you first.</p>
    </>,
  },
  {
    id: "consent",
    title: "Your consent",
    body: <>
      <p>By using Local Cooks, you agree to us collecting and using your information for the purposes in section 3. Some of it is needed to provide the service. For example, we can't take a booking without a payment, or send your access request without your documents. You can withdraw consent for anything optional, such as marketing email or optional cookies, at any time. Withdrawing consent for something we need may mean we can't provide that part of the service, and we will tell you if so.</p>
    </>,
  },
  {
    id: "who-sees-it",
    title: "Who sees it",
    body: <>
      <h3>Kitchens and customers</h3>
      <ul>
        <li>A kitchen sees what a customer sends with an access request (name, contact details, documents and answers) and the customer's bookings, tours, storage rentals, messages, check-ins and payment amounts at that kitchen.</li>
        <li>A customer sees the kitchen's listing, and its contact details and arrival instructions for their bookings and tours.</li>
        <li>Private feedback after a visit is seen only by Local Cooks. What a kitchen tells us while we review a damage claim isn't shown to the customer.</li>
      </ul>
      <h3>Service providers</h3>
      <p>We use these companies to run Local Cooks. They may use your information only to provide their service to us:</p>
      <ul>
        <li><strong>Stripe:</strong> payments, refunds, kitchen payouts and payout identity checks</li>
        <li><strong>Google Firebase:</strong> sign-in and account security</li>
        <li><strong>Supabase:</strong> our database, hosted in Canada</li>
        <li><strong>Vercel:</strong> website and application hosting</li>
        <li><strong>Cloudflare:</strong> storage for photos and uploaded documents</li>
        <li><strong>Twilio:</strong> text messages and phone verification</li>
        <li><strong>Hostinger:</strong> sending email</li>
        <li><strong>Sentry:</strong> error reports</li>
        <li><strong>Inngest:</strong> scheduled tasks such as reminders and payouts</li>
        <li><strong>Google Maps Platform:</strong> address search and maps</li>
      </ul>
      <h3>Other disclosures</h3>
      <p>We share information when the law requires it, such as a court order, or when it's needed to protect someone's safety, to investigate fraud, or to enforce our terms. If Local Cooks is sold or merged, information may pass to the new owner, who must protect it as this policy describes.</p>
      <p>We don't sell personal information.</p>
    </>,
  },
  {
    id: "cookies",
    title: "Cookies",
    body: <>
      <p>We use cookies and similar storage that the site needs to work: to keep you signed in, remember your language and remember your cookie choice. With your permission we also use optional cookies. These let our error-monitoring service record what happened on screen when an error occurs, so we can fix it. You choose in the cookie banner and can change your choice by clearing your browser's cookies for localcooks.ca.</p>
    </>,
  },
  {
    id: "where-its-stored",
    title: "Where your information is stored",
    body: <>
      <p>Our main database is in Canada. Several of our service providers, including Stripe, Google, Vercel, Cloudflare, Twilio and Sentry, process information in the United States and other countries. Information stored outside Canada is protected by our agreements with those providers, but it is subject to the laws of those countries and can be accessed by their courts, police and government authorities.</p>
    </>,
  },
  {
    id: "how-long",
    title: "How long we keep it",
    body: <>
      <ul>
        <li><strong>Your account</strong> stays while it is open. When you close it, we delete your information.</li>
        <li><strong>Bookings and payments.</strong> If your account has booking, claim or payment history, we remove your name and contact details when you close it. We keep the anonymized booking and payment records. Financial records are kept for as long as Canadian tax law requires, generally six years.</li>
        <li><strong>Documents</strong> you upload stay until you replace or remove them, or close your account, except where they belong to a booking or claim we must keep.</li>
        <li><strong>Error reports and technical logs</strong> are kept for a limited time and then deleted by the service that holds them.</li>
      </ul>
    </>,
  },
  {
    id: "security",
    title: "How we protect it",
    body: <>
      <p>We use encrypted connections and access controls that limit staff to what their job needs. Card details stay with Stripe, which is certified to the PCI DSS card-security standard. Uploaded documents aren't public: only the kitchen you send them to and Local Cooks staff who need them can open them. No system is perfectly secure, so please use a strong password and tell us at {SUPPORT} if you notice anything unusual on your account.</p>
    </>,
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: <>
      <p>You can ask us to:</p>
      <ul>
        <li>show you the personal information we hold about you and how we've used and shared it;</li>
        <li>correct information that is wrong or incomplete;</li>
        <li>close your account and delete your information, subject to section 8;</li>
        <li>stop using your information for anything optional, such as marketing.</li>
      </ul>
      <p>Write to {SUPPORT}. We may need to confirm your identity first. We reply within 30 days, and tell you if we need more time and why. If we can't give you something, for example because it includes someone else's information, we explain why.</p>
    </>,
  },
  {
    id: "breaches",
    title: "If something goes wrong",
    body: <>
      <p>If a breach of our security safeguards creates a real risk of significant harm to you, we will tell you as soon as we can, tell you what you can do to protect yourself, and report it to the Office of the Privacy Commissioner of Canada. We keep a record of every breach, as the law requires.</p>
    </>,
  },
  {
    id: "children",
    title: "Children",
    body: <>
      <p>Local Cooks is for adults running food and kitchen businesses. We don't knowingly collect information from anyone under the age of majority. If we learn we have, we delete it.</p>
    </>,
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: <>
      <p>We will update this policy when how we handle information changes. For important changes, such as a new purpose or a new kind of service provider, we email you and tell you in the app at least 30 days before they apply, and ask for your consent where the law requires it. The date at the top shows the latest version.</p>
    </>,
  },
  {
    id: "complaints",
    title: "Questions and complaints",
    body: <>
      <p>Contact our Privacy Officer at {SUPPORT}. If you're not satisfied with our answer, you can complain to the Office of the Privacy Commissioner of Canada at <a href="https://www.priv.gc.ca" target="_blank" rel="noreferrer">priv.gc.ca</a> or 1-800-282-1376.</p>
    </>,
  },
];

const summary = [
  "We collect what we need to run bookings: your account, your business or kitchen details, the documents you send a kitchen, and your bookings and payments.",
  "Kitchens see what you send them with an access request. Card numbers stay with Stripe.",
  "Our database is in Canada. Some service providers, such as Stripe and Google, process information in the United States.",
  "We don't sell personal information. You can stop marketing email at any time.",
  "You can see, correct or delete your information. Write to support@localcooks.ca and we reply within 30 days.",
];

export default function PrivacyContent({ variant = "page" }: { variant?: "page" | "reader" }) {
  return (
    <LegalDocument
      variant={variant}
      title="Privacy Policy"
      updated={PRIVACY_UPDATED}
      effective={PRIVACY_EFFECTIVE}
      intro={<p>This policy explains what personal information Local Cooks collects, why, who sees it, how long we keep it, and the choices you have. It applies to kitchens, customers and anyone who visits our sites.</p>}
      summary={summary}
      sections={sections}
    />
  );
}
