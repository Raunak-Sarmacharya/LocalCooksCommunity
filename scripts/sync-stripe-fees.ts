import 'dotenv/config';
import { db } from '../server/db';
import { syncStripeFees } from '../server/services/payment-transactions-service';

async function main() {
  console.log("Starting Stripe fee sync...");
  const result = await syncStripeFees(db, undefined, 10);
  console.log("Result:", result);
  process.exit(0);
}

main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
});
