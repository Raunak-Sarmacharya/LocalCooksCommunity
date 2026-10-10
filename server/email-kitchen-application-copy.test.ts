import { expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: {} }));
import { generateKitchenApplicationAdminEmail, generateKitchenApplicationClearedManagerEmail, generateKitchenApplicationReceivedChefEmail, generateKitchenApplicationStep2ReceivedChefEmail, generateKitchenApplicationSubmittedChefEmail, generateKitchenApplicationApprovedEmail, generateKitchenApplicationRejectedEmail } from "./email";
import { buildKitchenApplicationEmailSamples } from "../scripts/kitchen-application-email-samples";
const details = { applicationId: 57, chefEmail: "chef@example.test", chefName: "Jamie Chef", locationName: "Harbour Kitchen", locationAddress: "14 McDougall St" };
it.each([
  generateKitchenApplicationReceivedChefEmail,
  generateKitchenApplicationStep2ReceivedChefEmail,
  generateKitchenApplicationSubmittedChefEmail,
  generateKitchenApplicationApprovedEmail,
  generateKitchenApplicationRejectedEmail,
])("keeps chef kitchen application emails focused on status and actions", generate => {
  const email = generate({ ...details, feedback: "Please update your certificate." });
  for (const content of [email.text, email.html]) {
    expect(content).toContain(details.locationName);
    expect(content).not.toMatch(/(?:manager|admin|our team|local cooks)\s+(?:will |is |has )?(?:review|approv)|(?:reviewed|approved) by (?:the )?(?:manager|admin|our team|local cooks)|within\s+(?:\d|<)|business days|step\s*[12]|tier\s*[12]/i);
  }
  expect(email.to).toBe(details.chefEmail);
  expect(email.html).toContain("/dashboard?view=");
  expect(email.text).toContain("view=kitchen-requests&application=57");
});

it.each(buildKitchenApplicationEmailSamples().samples)('renders a complete, role-correct $id email using the tour layout', sample => {
  expect(sample.html).toContain('class="email-brand"');
  expect(sample.html).toContain('class="email-title"');
  expect(sample.html).toContain('APPLICATION-57');
  expect(sample.text).toContain('APPLICATION-57');
  expect(sample.text).toContain('Harbour House');
  expect(sample.to).toBe(sample.role === 'Chef' ? 'alex.chen@example.com' : sample.role === 'Manager' ? 'morgan@example.com' : 'operations@example.com');
  const rolePath = sample.role === 'Chef' ? '/dashboard?view=kitchen-requests&application=57' : sample.role === 'Manager' ? '/manager/dashboard?view=applications&application=57' : '/admin?section=kitchen-applications-step1&application=57';
  if (sample.id.startsWith('coordination-') && sample.role === 'Chef') expect(sample.text).toContain('/apply-kitchen/5');
  else expect(sample.text).toContain(rolePath);
  if (sample.id === 'coordination-unavailable') expect(sample.text).not.toContain('?view=messages');
});

it('opens the exact kitchen conversation without claiming a booking confirmation', () => {
  const email = generateKitchenApplicationSubmittedChefEmail({ ...details, locationId: 46, conversationId: 'chef/kitchen&57' });
  expect(email.text).toContain('/apply-kitchen/46');
  expect(email.text).toContain('/dashboard?view=messages&conversation=chef%2Fkitchen%2657');
  expect(email.html).toContain('class="lc-border"');
  expect(email.text).toContain('always communicate through Local Cooks');
  expect(email.text).toContain('Booking becomes available after your kitchen access is approved');
});

it('escapes chef answers and feedback in HTML while preserving their literal plain text', () => {
  const feedback = '<img src=x onerror=alert(1)> & "renew"';
  const email = generateKitchenApplicationRejectedEmail({ ...details, chefName: '<script>Chef</script>', feedback });
  expect(email.html).not.toContain('<script>Chef</script>');
  expect(email.html).not.toContain('<img src=x');
  expect(email.html).toContain('&lt;img src=x');
  expect(email.text).toContain(feedback);
});

it('keeps admin request actions on the admin application queue', () => {
  const email = generateKitchenApplicationAdminEmail({ ...details, recipientEmail: 'operations@example.test' });
  expect(email.text).toContain('/admin?section=kitchen-applications-step1&application=57');
  expect(email.text).not.toContain('/manager/dashboard');
});

it.each(['chat-57', null])('asks managers to message the chef, retains application access, and includes the tour safety reminder with chat %s', conversationId => {
  const email = generateKitchenApplicationClearedManagerEmail({ ...details, managerEmail: 'manager@example.test', managerName: 'Morgan', conversationId });
  expect(email.html).toContain('class="email-brand"');
  expect(email.text).toContain('No application review is needed from you.');
  expect(email.text).toContain('Please contact the chef through Local Cooks in-app messaging');
  expect(email.text).toContain('View application:');
  expect(email.text).toContain('/manager/dashboard?view=applications&application=57');
  expect(email.text).toContain('For your safety, always communicate through Local Cooks so you can refer back to your messages and arrangements.');
  expect(email.text).not.toContain('for your review');
  expect(email.text).not.toContain('cleared by Local Cooks');
  if (conversationId) expect(email.text.indexOf('Message chef:')).toBeLessThan(email.text.indexOf('View application:'));
  else expect(email.text).not.toContain('conversation=null');
});
