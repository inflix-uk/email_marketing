import "./load-env"; // must stay first: loads optional env overrides (MONGODB_URI, AUTH_SECRET)
import { closeDb } from "@/db";
import { closeMailer } from "@/lib/mailer";
import { runWorker } from "./loop";

// Background sender: queues scheduled campaigns when due, sends queued emails
// at the rate (and up to the daily limit) set on the Settings page, picks A/B
// test winners, pauses campaigns that bounce too much, sends due automation
// emails, and marks campaigns "sent" when done.
// Before /setup has been completed it just waits for the database.
//
//   npm run worker            run forever (Ctrl+C / SIGTERM stops gracefully)
//   npm run worker -- --once  send whatever is due now, then exit (cron-style)

async function main() {
  const controller = new AbortController();
  let stopping = false;

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) {
      console.log(`[worker] ${signal} again - exiting immediately`);
      process.exit(1);
    }
    stopping = true;
    console.log(`[worker] ${signal} received - finishing the current email, then exiting (repeat to force)`);
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // One bad promise must never take the sender down.
  process.on("unhandledRejection", (reason) => {
    console.error("[worker] unhandled rejection (continuing):", reason);
  });

  try {
    await runWorker({ signal: controller.signal, once: process.argv.includes("--once") });
  } finally {
    closeMailer();
    await closeDb();
  }
  // Exit explicitly (once logs are flushed) in case anything else holds the event loop.
  process.stdout.write("", () => process.exit(0));
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
