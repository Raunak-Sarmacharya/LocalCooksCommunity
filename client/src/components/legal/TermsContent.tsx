import { LegalDocument, type LegalSection } from "./LegalDocument";

/**
 * Local Cooks Terms of Service (rewritten Oct 24, 2026 from the policy register, docs/architecture/phase0/
 * policy-facts-booking.md, and research on The Food Corridor, Peerspace, Airbnb and Turo). One document for kitchens
 * and customers, with parts for each side, because each side's promises bind the other. Counsel reviews the binding
 * wording before production (owner, Oct 15). When a booking rule changes in the product, change it here too.
 */
export const TERMS_UPDATED = "October 24, 2026";
export const TERMS_EFFECTIVE = "November 23, 2026";

const SUPPORT = <a href="mailto:support@localcooks.ca">support@localcooks.ca</a>;
const PRIVACY = <a href="/privacy">Privacy Policy</a>;

const sections: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: <>
      <p>These terms are an agreement between you and Jawrophi Delivery Inc., which operates Local Cooks (“Local Cooks”, “we”, “us”). They apply when you use localcooks.ca, its kitchen and customer sites, and anything else we offer under the Local Cooks name (together, the “platform”).</p>
      <p>Two kinds of people use Local Cooks. <strong>Kitchens</strong> are businesses that list a commercial kitchen, storage or equipment. <strong>Customers</strong> are cooks and food businesses who rent them (parts of the app call them chefs). Sections 4 and 5 apply to everyone. Some sections apply to one side only, and they say so in their first line.</p>
      <p>Our {PRIVACY} explains how we handle personal information. The booking details you see before you pay, such as the price, the kitchen's cancellation policy and its booking requirements, also form part of your agreement for that booking.</p>
      <p>By creating an account or ticking “I agree”, you accept these terms. If you accept on behalf of a business, you confirm you are allowed to bind it.</p>
    </>,
  },
  {
    id: "what-we-do",
    title: "What Local Cooks does",
    body: <>
      <p>Local Cooks is a marketplace. We help kitchens list space and help customers find, request, book and pay for it. When a kitchen accepts a booking, the agreement to use the space is between the kitchen and the customer. We are not a party to it.</p>
      <p>We don't own, run, inspect or manage kitchens, and we don't prepare, inspect or sell food. We check a kitchen's food premises licence before its first listing goes live, but that check doesn't guarantee the kitchen's condition, equipment or safety. Kitchens and customers are independent of us and of each other. Nobody on the platform is our employee, agent or partner.</p>
      <p>To run bookings we collect payments, hold card authorizations, issue refunds, pay kitchens and review some disagreements. Section 12 explains our role in payments, and section 10 explains how we review damage claims.</p>
    </>,
  },
  {
    id: "accounts",
    title: "Your account",
    body: <>
      <ul>
        <li>You must be at least the age of majority where you live (19 in Newfoundland and Labrador) and able to enter a binding contract.</li>
        <li>Local Cooks is for business use: running a kitchen, or cooking and producing food as a business or for a business.</li>
        <li>Give accurate information and keep it current, including your contact details, your business details and any document you upload.</li>
        <li>Keep your sign-in private. You are responsible for what happens under your account. Tell us at {SUPPORT} if you think someone else has used it.</li>
        <li>We may ask you to verify your email, your phone number or your identity, and we may limit your account until you do.</li>
      </ul>
    </>,
  },
  {
    id: "using-the-platform",
    title: "Using the platform",
    body: <>
      <p>We give you a limited right to use the platform for its intended purpose while these terms apply. You may not:</p>
      <ul>
        <li>give false information, impersonate anyone or upload a document that isn't genuine;</li>
        <li>discriminate against anyone, or harass, threaten or abuse anyone on or off the platform;</li>
        <li>use the platform for anything illegal, including producing or selling food you aren't permitted to make;</li>
        <li>arrange payment for a Local Cooks booking outside the platform (section 13);</li>
        <li>copy, scrape or resell the platform or its listings, or interfere with how it works or how it is secured;</li>
        <li>post content you don't have the right to share, or content that is misleading, hateful or explicit.</li>
      </ul>
      <p>We may remove content or listings that break these rules. Section 18 covers suspension.</p>
    </>,
  },
  {
    id: "kitchens",
    title: "For kitchens: your listing and your space",
    body: <>
      <p><em>This section applies to kitchens.</em></p>
      <ul>
        <li><strong>Accurate listings.</strong> Describe the space, equipment, storage, rates, opening hours and rules as they really are, and keep them current. Photos must show your own space.</li>
        <li><strong>Licences.</strong> Hold the food premises licence and any other permit your space needs under Newfoundland and Labrador law, keep it valid and upload renewals. We may pause a listing when a licence is missing or expired.</li>
        <li><strong>Your policies.</strong> You choose your booking rules, your cancellation policy (section 8) and the documents you require from customers (section 6). The policy in force when a customer books applies to that booking, even if you change it later.</li>
        <li><strong>Arrival and departure.</strong> Give clear arrival and departure instructions and make the space available, clean, safe and in working order for every booking you accept.</li>
        <li><strong>Insurance.</strong> Keep the property and liability insurance a commercial kitchen in your situation needs (section 16).</li>
        <li><strong>Honest answers.</strong> Record arrivals, no-shows and inspections truthfully. Local Cooks relies on these records when it moves money.</li>
      </ul>
      <p>If you can't host a booking you accepted, cancel it in the app as early as you can. The customer then gets a full refund (section 8), and repeated cancellations may affect your listing.</p>
    </>,
  },
  {
    id: "requirements",
    title: "Access requests and booking requirements",
    body: <>
      <p>A customer books a kitchen only after the kitchen gives them access. To ask for access, the customer sends an access request with the documents and answers the kitchen asks for, such as a food handler certificate, a food establishment licence or proof of insurance. The kitchen reviews the request and decides.</p>
      <ul>
        <li><strong>Customers</strong> must send genuine, current documents and replace them when they expire. When a kitchen marks a document as required, a missing or expired one pauses new bookings at that kitchen until it is replaced. Existing bookings are not affected.</li>
        <li><strong>Kitchens</strong> decide who they accept, but they must do so without discrimination, and use the documents they receive only to decide and to manage bookings.</li>
        <li>A kitchen can add a customer it already works with by invitation. The customer still accepts these terms and the kitchen's requirements in the app.</li>
      </ul>
      <p>Local Cooks may review any request, document or account to keep the platform safe, but we don't verify every document, and a kitchen remains responsible for its own decision.</p>
    </>,
  },
  {
    id: "tours",
    title: "Kitchen tours",
    body: <>
      <p>Customers can ask to visit a kitchen before booking. Tours are free on Local Cooks. A kitchen may limit how many tours it offers and confirms a time in the app. Both sides should arrive as agreed or cancel in the app. After the visit, the kitchen records whether the customer came.</p>
      <p>A tour gives no right to use the kitchen for cooking or storage. Kitchens and customers are responsible for their own conduct and safety during a tour.</p>
    </>,
  },
  {
    id: "refund-policy",
    title: "Bookings, cancellations and refunds",
    body: <>
      <h3>Requesting a booking</h3>
      <p>Before you request, you see the full price: kitchen time, add-ons, HST at the kitchen's rate and any Local Cooks service fee. Requesting places a hold on your card. You are charged only if the kitchen accepts. If it declines, or doesn't answer in time, the hold is released. Kitchens answer within 24 hours, and sooner when the booking starts soon. You can withdraw a pending request at no cost.</p>
      <p>A kitchen can accept your request, decline it, suggest other times, or accept it without an add-on or a day it can't provide. In the last case nothing is charged until you approve the new total. If you don't answer by the deadline shown, the request closes and the hold is released.</p>
      <h3>Changing a booking</h3>
      <p>You can ask to change a confirmed booking until its refund deadline. The kitchen approves or declines the change. If the new price is higher, the difference is charged when the kitchen approves. If it is lower, the difference is refunded, minus the card processing fee on that amount.</p>
      <h3>When you cancel</h3>
      <p>Each kitchen sets a notice period (24, 48 or 72 hours before the start) and a late charge (50% or 100% of the booking total). The booking page and checkout show both before you pay.</p>
      <ul>
        <li><strong>Before the deadline:</strong> you get back everything you paid, minus the card processing fee, which we show in dollars before you confirm.</li>
        <li><strong>After the deadline:</strong> the late charge applies. A 50% kitchen refunds half of what you paid, minus that half's share of the card processing fee. A 100% kitchen refunds nothing.</li>
        <li><strong>Multi-day bookings</strong> have one deadline, set by the first booked day. Before it you can drop any day. After it, dropped days follow the late charge. Days that have started are not refundable.</li>
        <li><strong>No-shows</strong> are not refunded at any kitchen, whatever its late charge.</li>
        <li>Leaving early doesn't refund unused time, and extra time is not refundable once added.</li>
      </ul>
      <h3>When the kitchen cancels</h3>
      <p>You get a full refund, including the card processing fee. On a multi-day booking, if the kitchen cancels one day, you may also drop the remaining days without the late charge.</p>
      <h3>Refund timing</h3>
      <p>We issue refunds right away to the card you paid with. Banks usually show them within 5 to 10 business days. A kitchen may refund more than its policy requires; that extra comes from its own payout.</p>
      <p>If something outside anyone's control stops a booking, contact us. We look at each case, but the kitchen's policy is what applies unless the kitchen agrees otherwise.</p>
    </>,
  },
  {
    id: "at-the-kitchen",
    title: "At the kitchen: arrival, extra time and problems",
    body: <>
      <ul>
        <li><strong>Check-in</strong> opens shortly before your start time. Use the check-in step in the app, with the code from the kitchen's staff or the kitchen's self check-in. Arriving late doesn't move your end time.</li>
        <li><strong>Extra time.</strong> While checked in you can ask for more time, and the kitchen can offer it. The kitchen approves every request. Your card is held and charged only when the kitchen approves, or when you accept its offer, at the extra-time rate shown when you booked.</li>
        <li><strong>Leaving late.</strong> If you stay past your booked end, the kitchen may record when you left and send a charge for the extra time in 30-minute blocks, within 24 hours. You can pay it or dispute it. It is never charged automatically. Local Cooks decides disputed or unanswered charges, and an upheld charge must be paid within 7 days or new bookings pause until it is.</li>
        <li><strong>Leave the space as you found it,</strong> following the kitchen's departure instructions.</li>
        <li><strong>Problems.</strong> If you can't get in or something is unsafe, report it in the app. The kitchen and Local Cooks are told at once. In an emergency, call 911 first.</li>
      </ul>
    </>,
  },
  {
    id: "damage-and-cleaning",
    title: "Damage and cleaning claims",
    body: <>
      <p>After each visit the kitchen has 24 hours to inspect the space. If it finds damage or cleaning beyond normal use, it can file one claim per visit in the app within 72 hours of the customer leaving:</p>
      <ul>
        <li>The claim lists each cost with a receipt, invoice or quote, up to $250 in total. Claims cover repair, replacement and cleaning only, not fines or lost income.</li>
        <li>Local Cooks reviews every claim before the customer sees it. We may ask the kitchen for more information, reduce the claim, close it, or pay the kitchen ourselves at no cost to the customer.</li>
        <li>The customer has 72 hours to pay or dispute a claim we send. We decide disputed and unanswered claims, and that decision ends the in-app process.</li>
        <li>Cards are never charged automatically for a claim. If an upheld claim is unpaid 7 days after our decision, the customer can't make new bookings until it is paid. Existing bookings continue.</li>
      </ul>
      <p>For larger losses, Local Cooks can help both sides talk, but the claim is between the kitchen and the customer and may need their insurers or the courts (section 21).</p>
    </>,
  },
  {
    id: "storage-and-equipment",
    title: "Storage and equipment",
    body: <>
      <p>Kitchens may rent equipment with a booking and rent storage on its own.</p>
      <ul>
        <li><strong>Storage</strong> is priced per day and rented for 1 to 30 days, starting within 14 days. It never renews automatically. To keep your space, extend it in the app and pay; you can extend once 14 days or fewer remain.</li>
        <li>Cancelling storage before it starts follows the kitchen's cancellation policy. Ending a rental early is not refunded, though the kitchen may refund unused days.</li>
        <li>After a rental ends you have 5 days to extend at the same price or move out. After that the kitchen may charge a holdover fee at the daily price, which you can pay or dispute within 72 hours.</li>
        <li>If items stay 20 days or more past the end (15 days after those 5), Local Cooks reviews the rental and contacts you. After our final notice, the kitchen may dispose of perishable items after 48 hours and other items after 7 days, with photos and a list, and never sell them.</li>
        <li>A kitchen may ask you to move out early with 7 days' notice for rentals longer than 7 days, and refunds the unused days.</li>
        <li>If you don't move in within 7 days of the start, the kitchen may release the unit. That isn't refunded.</li>
        <li>After you move out, the kitchen can report damage or extra cleaning the same way as after a visit (section 10): within 72 hours, up to $250, reviewed by Local Cooks first.</li>
        <li>Your items are stored at your own risk. Neither Local Cooks nor the kitchen insures them, so use your own business insurance. If the kitchen's storage fails or can't be used, you get the unused days back.</li>
        <li>Store only food and kitchen supplies the kitchen allows, sealed and labelled with your name and date. Keep anything that must stay cold in cold or freezer storage. Nothing illegal, hazardous or alive.</li>
      </ul>
    </>,
  },
  {
    id: "payments",
    title: "Payments, fees and payouts",
    body: <>
      <h3>How payments work</h3>
      <p>Payments go through Stripe. Customers pay Local Cooks, and we collect that money as the kitchen's limited payment collection agent: once you pay us, you have paid the kitchen. Card details go to Stripe, not to us.</p>
      <h3>Fees</h3>
      <ul>
        <li>Local Cooks may add a service fee to a booking. It is always shown before you pay.</li>
        <li>Card processing fees are what Stripe charges for each payment. They are deducted from the kitchen's payout and from refunds as described in section 8.</li>
        <li>Kitchens set their HST rate. We collect HST with each booking and pass it to the kitchen in its payout. Kitchens are responsible for registering for, reporting and remitting their own taxes.</li>
      </ul>
      <h3>Payouts to kitchens</h3>
      <ul>
        <li>Kitchens need a Stripe account in good standing to be paid. Stripe's terms apply to it.</li>
        <li>A kitchen is paid what the customer paid, minus the Local Cooks service fee and the card processing fee. We send it when the kitchen finishes its inspection, or 24 hours after the visit ends. Storage is paid at the end of each paid term.</li>
        <li>We hold a payout while a problem report or a claim on that visit is open, or while we need to check a payment.</li>
        <li>If a kitchen owes money back, for example a refund after its payout was sent, we may take it from its future payouts or ask the kitchen to pay it.</li>
      </ul>
      <h3>Card disputes</h3>
      <p>Contact the kitchen or us before you dispute a charge with your bank. We answer card disputes using the booking's records. Filing a dispute you know is unfounded may lead us to close your account.</p>
    </>,
  },
  {
    id: "off-platform",
    title: "Keep payments on Local Cooks",
    body: <>
      <p>Kitchens and customers who meet on Local Cooks must book and pay for those bookings through Local Cooks. Don't ask for, offer or accept payment outside the platform for a booking, a tour, storage, equipment or extra time arranged here.</p>
      <p>If you do, Local Cooks is not responsible for that arrangement. Our cancellation and refund rules, damage claims, payouts, problem reports and support don't apply to it. We may also warn you, and suspend or close the account of anyone who arranges or accepts it. Tell us at {SUPPORT} if someone asks you to pay outside the platform.</p>
    </>,
  },
  {
    id: "plans",
    title: "For kitchens: plans and subscriptions",
    body: <>
      <p><em>This section applies to kitchens.</em></p>
      <p>Listing on Local Cooks is free during early access. We plan to offer paid kitchen plans. Before any plan applies to you, we will email you and tell you in the app at least 30 days ahead, with the price and what it includes. Nothing is charged unless you choose a paid plan, and you can close your listing or account before a plan would apply.</p>
    </>,
  },
  {
    id: "food-safety",
    title: "Food safety and the law",
    body: <>
      <p>Everyone is responsible for following the laws that apply to them, including Newfoundland and Labrador's Food and Drug Act and Food Premises Regulations, federal food rules, municipal rules, and labelling, allergen and tax rules.</p>
      <ul>
        <li><strong>Customers</strong> are responsible for the food they make, its ingredients, handling, labelling and sale, and for holding the certificates and permits their business needs.</li>
        <li><strong>Kitchens</strong> are responsible for their premises, equipment and licences, and for cooperating with health inspectors.</li>
      </ul>
      <p>Local Cooks doesn't inspect food or premises and is not responsible for any illness or loss caused by food made in a kitchen booked through the platform.</p>
    </>,
  },
  {
    id: "insurance",
    title: "Insurance",
    body: <>
      <p>Local Cooks is not an insurer, and using the platform doesn't give anyone insurance coverage.</p>
      <ul>
        <li>Kitchens keep the property and commercial general liability insurance their space needs.</li>
        <li>Customers keep the liability insurance their business needs, and any coverage a kitchen requires as a booking requirement.</li>
      </ul>
      <p>Where a loss is covered by insurance, the person who suffered it should claim from their insurer.</p>
    </>,
  },
  {
    id: "content",
    title: "Your content and our platform",
    body: <>
      <p>You keep ownership of the photos, text and documents you add. You let Local Cooks host, display, adapt and share them as needed to run and promote the platform, for example showing your listing photos in search results and on social media. That permission ends when you remove the content, except where we need records for a booking, a dispute or the law.</p>
      <p>Documents you send to a kitchen are shared only with that kitchen and with Local Cooks staff who need them. Private feedback you give after a visit is seen only by Local Cooks.</p>
      <p>The platform, its design, software and the Local Cooks name belong to us. If you send us ideas or suggestions, we may use them without owing you anything.</p>
    </>,
  },
  {
    id: "suspension",
    title: "Suspension and closing an account",
    body: <>
      <p>You can close your account at any time by contacting {SUPPORT}. Open bookings, storage rentals, claims and payouts must be finished or cancelled first.</p>
      <p>We may limit, suspend or close an account, or remove a listing, if someone breaks these terms, puts people or property at risk, acts fraudulently, leaves amounts unpaid, or if the law requires it. We tell you why unless the law or someone's safety prevents it. You can ask us to reconsider by writing to {SUPPORT}.</p>
      <p>When an account closes, bookings that can't continue are cancelled under section 8, and the parts of these terms that by their nature continue (payments owed, liability and disputes) still apply.</p>
    </>,
  },
  {
    id: "liability",
    title: "Liability",
    body: <>
      <p>We work to keep the platform available and accurate, but we provide it as it is and as available. We don't promise it will always work without interruption or error, or that a kitchen, customer or listing will meet your expectations.</p>
      <p>As far as the law allows:</p>
      <ul>
        <li>Local Cooks is not responsible for what kitchens and customers do or fail to do, for the condition of any kitchen, or for any food.</li>
        <li>We are not responsible for indirect or consequential losses, such as lost profits, lost business or lost data.</li>
        <li>Our total responsibility to you for all claims relating to the platform is limited to the greater of the fees you paid Local Cooks in the 12 months before the claim, or $100 CAD.</li>
      </ul>
      <p>Nothing in these terms limits our responsibility for fraud, for harm we cause deliberately or through gross negligence, or for anything else the law doesn't allow us to limit.</p>
    </>,
  },
  {
    id: "indemnity",
    title: "Your responsibility for claims",
    body: <>
      <p>If someone makes a claim against Local Cooks because of your breach of these terms, your use of a kitchen, your premises, your food or your conduct, you agree to cover our reasonable losses and costs, including legal fees. We will tell you about the claim and let you take part in responding to it.</p>
    </>,
  },
  {
    id: "disputes",
    title: "Resolving disputes",
    body: <>
      <ul>
        <li><strong>Between kitchens and customers.</strong> Try the app first: message each other, and use the tools for cancellations, extra-time charges, problem reports and damage claims. Local Cooks decides the in-app processes described in sections 9 and 10. Either side can still go to court over a disagreement.</li>
        <li><strong>With Local Cooks.</strong> Write to {SUPPORT} and tell us what happened and what you'd like. We reply within 10 business days and will try to resolve it within 30 days.</li>
        <li><strong>Courts.</strong> If we can't resolve it, you or we may go to the courts of Newfoundland and Labrador, including Small Claims Court for smaller amounts. Nothing here stops you from contacting a regulator or using rights the law gives you that can't be waived.</li>
      </ul>
    </>,
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: <>
      <p>We may update these terms as the platform changes or the law requires. For changes that affect your rights or what you pay, we email you and tell you in the app at least 30 days before they apply, and we ask you to accept the new version. If you don't agree, you can close your account before then. Smaller changes, such as clearer wording or fixed errors, apply when we publish them, with the date at the top updated.</p>
    </>,
  },
  {
    id: "general",
    title: "General",
    body: <>
      <ul>
        <li>These terms, the {PRIVACY} and the details shown at checkout are the whole agreement between you and Local Cooks about the platform.</li>
        <li>The laws of Newfoundland and Labrador and the federal laws of Canada that apply there govern these terms.</li>
        <li>If a court finds part of these terms invalid, the rest still applies. If we don't enforce a term right away, we can still enforce it later.</li>
        <li>You may not transfer your account or these terms to someone else without our written consent. We may transfer them as part of selling or reorganizing our business, and we will tell you if we do.</li>
        <li>We are not responsible for delays or failures caused by events outside our reasonable control, such as outages at our service providers, storms or power cuts.</li>
        <li>We send notices by email or in the app. You can reach us at {SUPPORT}.</li>
        <li>These terms are written in English. If a translation differs, the English version applies.</li>
      </ul>
    </>,
  },
  {
    id: "contact",
    title: "Contact",
    body: <>
      <p>Jawrophi Delivery Inc., operating as Local Cooks<br />St. John's, Newfoundland and Labrador, Canada<br />{SUPPORT}</p>
    </>,
  },
];

const summary = [
  "Local Cooks is a marketplace. When a kitchen accepts a booking, the agreement to use the space is between the kitchen and the customer.",
  "Requesting a booking only holds your card. You're charged when the kitchen accepts.",
  "Each kitchen sets its cancellation policy, and you see it before you pay. Cancelling before the deadline refunds everything except the card processing fee. No-shows aren't refunded.",
  "Kitchens are paid after each visit, minus the Local Cooks fee and the card processing fee.",
  "Damage claims are capped at $250 in the app, need receipts, and Local Cooks reviews every claim first. Cards are never charged automatically for a claim.",
  "Pay only through Local Cooks. Arrangements made outside the platform aren't covered.",
  "Listing is free during early access. We give kitchens 30 days' notice before any paid plan.",
];

export default function TermsContent({ variant = "page" }: { variant?: "page" | "reader" }) {
  return (
    <LegalDocument
      variant={variant}
      title="Terms of Service"
      updated={TERMS_UPDATED}
      effective={TERMS_EFFECTIVE}
      intro={<p>These terms explain how Local Cooks works for kitchens and for the customers who book them: what each side agrees to, how bookings, payments and refunds work, and what happens when something goes wrong. If you joined before {TERMS_UPDATED}, they apply to you from {TERMS_EFFECTIVE}.</p>}
      summary={summary}
      sections={sections}
    />
  );
}
