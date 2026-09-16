import assert from "node:assert/strict";
import { shouldAutoSubmitSellerJourney } from "./pending-seller-journey-guard";

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "chef" }),
  true,
  "chef on chef subdomain may submit",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "kitchen", role: "manager", isManager: true }),
  false,
  "kitchen managers must not be yanked to chef",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "chef", role: "manager", isManager: true }),
  false,
  "manager role blocks even on chef host",
);

assert.equal(
  shouldAutoSubmitSellerJourney({ subdomain: "admin", role: "chef" }),
  false,
  "admin host never auto-submits seller journey",
);

console.log("pending-seller-journey-guard: ok");
