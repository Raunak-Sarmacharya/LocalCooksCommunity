import assert from "node:assert/strict";
import { shouldAutoSubmitSellerJourney } from "./pending-seller-journey-guard";

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "chef", journeyActive: true }),
  true,
  "chef on chef subdomain may submit",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "kitchen", role: "manager", isManager: true, journeyActive: true }),
  false,
  "kitchen managers must not be yanked to chef",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "manager", isManager: true, journeyActive: true }),
  false,
  "manager role blocks even on chef host",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "admin", role: "chef", journeyActive: true }),
  false,
  "admin host never auto-submits seller journey",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "chef", journeyActive: false }),
  false,
  "an unrelated later sign-in must not submit an abandoned seller draft",
);

console.log("pending-seller-journey-guard: ok");
