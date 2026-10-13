// Set a new random password for an account and print it - for when the
// "Forgot password?" email can't be used (no email provider connected yet):
//   npm run user:reset-password -- someone@example.com
// The account is signed out everywhere. Change the password afterwards on the Settings page.
import "../src/worker/load-env";
import { loginEmailKey } from "../src/app/login/throttle";
import { closeDb, collections } from "../src/db";
import { hashPassword, randomPassword } from "../src/lib/password";
import { normalizeEmail } from "../src/lib/utils";

async function main(): Promise<number> {
  const arg = process.argv[2];
  const { users, rateLimits } = await collections();

  if (!arg || arg.startsWith("-")) {
    console.error("Usage: npm run user:reset-password -- someone@example.com");
    const emails = await users.find({}, { projection: { email: 1 } }).sort({ createdAt: 1 }).limit(50).toArray();
    if (emails.length) console.error(`\nAccounts:\n${emails.map((u) => "  " + u.email).join("\n")}`);
    return 1;
  }

  const email = normalizeEmail(arg);
  const password = randomPassword(16);
  const result = await users.updateOne(
    { email },
    {
      $set: { passwordHash: await hashPassword(password), resetTokenHash: null, resetTokenExpiresAt: null, updatedAt: new Date() },
      // Signs the account out on every device.
      $inc: { sessionVersion: 1 },
    },
  );
  if (!result.matchedCount) {
    console.error(`No account with the email ${email}.`);
    return 1;
  }

  // A lockout from earlier wrong guesses ends here.
  await rateLimits.deleteOne({ _id: loginEmailKey(email) });

  console.log(`New password for ${email}:\n\n  ${password}\n`);
  console.log("Sign in with it, then choose your own password on the Settings page.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
