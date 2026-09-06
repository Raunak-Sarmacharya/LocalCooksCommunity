import { pickDocumentVerificationApp } from "./pick-document-verification-app";
import type { Application } from "@shared/schema";

function app(partial: Partial<Application> & Pick<Application, "id" | "status" | "createdAt">): Application {
  return partial as Application;
}

const older = app({ id: 1, status: "cancelled", createdAt: new Date("2024-01-01") });
const newerActive = app({
  id: 2,
  status: "inReview",
  createdAt: new Date("2024-06-01"),
  foodSafetyLicenseUrl: "https://files.localcooks.ca/doc.pdf",
});
const newestRejected = app({ id: 3, status: "rejected", createdAt: new Date("2024-12-01") });

const picked = pickDocumentVerificationApp([older, newerActive, newestRejected]);
if (picked?.id !== 2) {
  throw new Error(`expected active app #2, got #${picked?.id}`);
}

const onlyCancelled = pickDocumentVerificationApp([older]);
if (onlyCancelled?.id !== 1) {
  throw new Error(`expected fallback to cancelled #1, got #${onlyCancelled?.id}`);
}

if (pickDocumentVerificationApp([]) !== null) {
  throw new Error("expected null for empty list");
}

console.log("pick-document-verification-app: ok");
