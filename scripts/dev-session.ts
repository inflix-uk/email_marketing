// Prints a valid admin session cookie for curl-testing authenticated pages:
//   curl -H "Cookie: $(npx tsx scripts/dev-session.ts)" http://localhost:3000/contacts
import "../src/worker/load-env";
import { closeDb, collections } from "../src/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/session";

async function main() {
  const { users } = await collections();
  const user = await users.findOne({}, { sort: { createdAt: 1 } });
  if (!user) throw new Error("No admin account yet - finish /setup first.");
  console.log(`${SESSION_COOKIE}=${await createSessionToken(user.email)}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
