// Demo data for local development: `npm run db:seed`.
//
//   npm run db:seed              - seeds an empty database, does nothing otherwise
//   npm run db:seed -- --reset   - DELETES all contacts, lists, templates, campaigns
//                                  and their sends/clicks first, then seeds
//                                  (your admin account and settings are kept)
//
// Uses the database from /setup (data/config.json) or MONGODB_URI. Every
// contact uses an @example.com / @example.org address (reserved domains that
// can never receive mail), so seeded campaigns can't reach real inboxes.

import "../worker/load-env"; // optional .env overrides (MONGODB_URI) for servers
import { getMongoUri } from "../lib/config";
import { getSettings } from "../lib/settings";
import { STARTER_TEMPLATES } from "../lib/starter-templates";
import { closeDb, collections, databaseNameFromUri, type Collections } from "./index";
import { newId, type CampaignDoc, type ContactDoc, type ListDoc, type TemplateDoc } from "./schema";

const DAY = 24 * 60 * 60 * 1000;

interface SeedContact {
  first: string;
  last: string;
  domain: "example.com" | "example.org";
  company: string;
  city: string;
  /** Days since the contact was added. */
  age: number;
  unsubscribed?: boolean;
  newsletter: boolean;
  customer: boolean;
}

// Realistic UK names, companies and cities - all on reserved example domains.
const SEED_CONTACTS: SeedContact[] = [
  { first: "Oliver", last: "Bennett", domain: "example.com", company: "Bennett & Co Joinery", city: "Leeds", age: 88, newsletter: true, customer: true },
  { first: "Amelia", last: "Hughes", domain: "example.org", company: "Hughes Architecture", city: "Cardiff", age: 85, newsletter: true, customer: false },
  { first: "Harry", last: "Patel", domain: "example.com", company: "Patel Pharmacy", city: "Leicester", age: 81, newsletter: true, customer: true },
  { first: "Isla", last: "MacDonald", domain: "example.com", company: "Highland Outdoor Gear", city: "Inverness", age: 77, newsletter: true, customer: true },
  { first: "George", last: "Thompson", domain: "example.org", company: "Thompson Accountants", city: "Manchester", age: 74, newsletter: true, customer: false },
  { first: "Ava", last: "Clarke", domain: "example.com", company: "Clarke Studio", city: "Bristol", age: 70, newsletter: true, customer: true },
  { first: "Noah", last: "Walsh", domain: "example.com", company: "Walsh Logistics", city: "Belfast", age: 66, newsletter: true, customer: false, unsubscribed: true },
  { first: "Mia", last: "Robinson", domain: "example.org", company: "Robinson Bakery", city: "York", age: 63, newsletter: true, customer: true },
  { first: "Jack", last: "Evans", domain: "example.com", company: "Evans Electrical", city: "Swansea", age: 60, newsletter: true, customer: false },
  { first: "Sophia", last: "Khan", domain: "example.com", company: "Khan Legal", city: "Birmingham", age: 57, newsletter: true, customer: true },
  { first: "Charlie", last: "Wright", domain: "example.org", company: "Wright Garden Centre", city: "Norwich", age: 54, newsletter: false, customer: true },
  { first: "Grace", last: "Murphy", domain: "example.com", company: "Murphy Physio", city: "Liverpool", age: 51, newsletter: true, customer: false },
  { first: "Freddie", last: "Campbell", domain: "example.com", company: "Campbell Engineering", city: "Glasgow", age: 48, newsletter: true, customer: true },
  { first: "Lily", last: "Shah", domain: "example.org", company: "Shah Dental Practice", city: "London", age: 45, newsletter: true, customer: false },
  { first: "Alfie", last: "Roberts", domain: "example.com", company: "Roberts Plumbing", city: "Newcastle upon Tyne", age: 42, newsletter: true, customer: true },
  { first: "Emily", last: "Davies", domain: "example.com", company: "Davies Florist", city: "Aberystwyth", age: 39, newsletter: true, customer: false },
  { first: "Arthur", last: "Mitchell", domain: "example.org", company: "Mitchell Property", city: "Edinburgh", age: 36, newsletter: true, customer: true, unsubscribed: true },
  { first: "Freya", last: "Ali", domain: "example.com", company: "Ali Catering", city: "Bradford", age: 33, newsletter: true, customer: false },
  { first: "Oscar", last: "Turner", domain: "example.com", company: "Turner Cycles", city: "Cambridge", age: 30, newsletter: true, customer: true },
  { first: "Poppy", last: "Morgan", domain: "example.org", company: "Morgan Interiors", city: "Brighton", age: 27, newsletter: true, customer: false },
  { first: "Leo", last: "Ahmed", domain: "example.com", company: "Ahmed Motors", city: "Sheffield", age: 24, newsletter: false, customer: true },
  { first: "Evie", last: "Kelly", domain: "example.com", company: "Kelly Coffee Roasters", city: "Nottingham", age: 21, newsletter: true, customer: true },
  { first: "Thomas", last: "Scott", domain: "example.org", company: "Scott Surveyors", city: "Aberdeen", age: 18, newsletter: true, customer: false },
  { first: "Ella", last: "Green", domain: "example.com", company: "Green Yoga Studio", city: "Bath", age: 15, newsletter: true, customer: false },
  { first: "Henry", last: "Baker", domain: "example.com", company: "Baker Print Shop", city: "Oxford", age: 12, newsletter: true, customer: true },
  { first: "Chloe", last: "Singh", domain: "example.org", company: "Singh Opticians", city: "Coventry", age: 10, newsletter: true, customer: false },
  { first: "William", last: "Price", domain: "example.com", company: "Price Builders", city: "Plymouth", age: 7, newsletter: true, customer: true },
  { first: "Ruby", last: "O'Neill", domain: "example.com", company: "O'Neill Events", city: "Derry", age: 5, newsletter: true, customer: false },
  { first: "Jacob", last: "Hall", domain: "example.org", company: "Hall Farm Shop", city: "Exeter", age: 3, newsletter: false, customer: true },
  { first: "Sienna", last: "Ward", domain: "example.com", company: "Ward Hair Salon", city: "Southampton", age: 1, newsletter: true, customer: false },
];

function emailFor(c: SeedContact): string {
  const local = `${c.first}.${c.last}`.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${local}@${c.domain}`;
}

async function countExisting(db: Collections) {
  const [contacts, lists, templates, campaigns] = await Promise.all([
    db.contacts.countDocuments(),
    db.lists.countDocuments(),
    db.templates.countDocuments(),
    db.campaigns.countDocuments(),
  ]);
  return { contacts, lists, templates, campaigns };
}

/** Delete demo-able data. Never touches users or settings. */
async function wipe(db: Collections) {
  await Promise.all([
    db.clicks.deleteMany({}),
    db.sends.deleteMany({}),
    db.campaigns.deleteMany({}),
    db.contacts.deleteMany({}),
    db.lists.deleteMany({}),
    db.templates.deleteMany({}),
  ]);
}

async function seed(db: Collections) {
  const now = Date.now();
  const nowDate = new Date(now);
  const settings = await getSettings();

  // Templates -------------------------------------------------------------
  const templateDocs: TemplateDoc[] = STARTER_TEMPLATES.map((t) => ({
    _id: newId(),
    name: t.name,
    subject: t.subject,
    previewText: t.previewText || null,
    html: t.html,
    createdAt: nowDate,
    updatedAt: nowDate,
  }));
  await db.templates.insertMany(templateDocs);
  const starterNewsletter = STARTER_TEMPLATES.find((t) => t.key === "newsletter") ?? STARTER_TEMPLATES[0];
  const newsletterTemplate = templateDocs[STARTER_TEMPLATES.indexOf(starterNewsletter)];

  // Lists -----------------------------------------------------------------
  const listDoc = (name: string, description: string): ListDoc => ({
    _id: newId(),
    name,
    description,
    createdAt: nowDate,
    updatedAt: nowDate,
  });
  const newsletterList = listDoc("Newsletter", "Monthly newsletter subscribers (signed up on the website).");
  const customersList = listDoc("Customers", "People who have bought from us - product news and offers.");
  await db.lists.insertMany([newsletterList, customersList]);

  // Contacts (unsubscribed contacts stay list members; sending skips them) --
  const contactDocs: ContactDoc[] = SEED_CONTACTS.map((c) => {
    const createdAt = new Date(now - c.age * DAY);
    return {
      _id: newId(),
      email: emailFor(c),
      firstName: c.first,
      lastName: c.last,
      fields: { company: c.company, city: c.city },
      status: c.unsubscribed ? "unsubscribed" : "subscribed",
      source: c.age % 3 === 0 ? "manual" : "import",
      listIds: [...(c.newsletter ? [newsletterList._id] : []), ...(c.customer ? [customersList._id] : [])],
      unsubscribedAt: c.unsubscribed ? new Date(now - Math.floor(c.age / 2) * DAY) : null,
      createdAt,
      updatedAt: createdAt,
    };
  });
  await db.contacts.insertMany(contactDocs);

  // Draft campaign ----------------------------------------------------------
  const campaign: CampaignDoc = {
    _id: newId(),
    name: "Welcome to our newsletter",
    subject: starterNewsletter.subject,
    previewText: starterNewsletter.previewText || null,
    fromName: settings.fromName || "Inflix",
    fromEmail: settings.fromEmail || "hello@example.com",
    replyTo: settings.replyTo || null,
    html: starterNewsletter.html,
    templateId: newsletterTemplate._id,
    listIds: [newsletterList._id],
    status: "draft",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 0,
    createdAt: nowDate,
    updatedAt: nowDate,
  };
  await db.campaigns.insertOne(campaign);

  return {
    appUrl: settings.appUrl,
    templates: templateDocs.length,
    contacts: contactDocs.length,
    unsubscribed: contactDocs.filter((c) => c.status === "unsubscribed").length,
    newsletterMembers: contactDocs.filter((c) => c.listIds.includes(newsletterList._id)).length,
    customerMembers: contactDocs.filter((c) => c.listIds.includes(customersList._id)).length,
  };
}

async function main() {
  const uri = getMongoUri();
  if (!uri) {
    console.log(
      "No database is configured yet.\n" +
        "Run `npm run dev`, open http://localhost:3000 and connect MongoDB on the setup screen, then run this again.",
    );
    process.exitCode = 1;
    return;
  }

  const reset = process.argv.includes("--reset");
  console.log(`Seeding database "${databaseNameFromUri(uri)}"${reset ? " (--reset: existing contacts, lists, templates and campaigns will be deleted)" : ""}`);

  const db = await collections();
  const existing = await countExisting(db);
  if (Object.values(existing).some((n) => n > 0) && !reset) {
    console.log(
      `The database already has data (${existing.contacts} contacts, ${existing.lists} lists, ` +
        `${existing.templates} templates, ${existing.campaigns} campaigns) - nothing was changed.\n` +
        "To delete it and load the demo data instead, run:  npm run db:seed -- --reset",
    );
    return;
  }

  if (reset) await wipe(db);
  const summary = await seed(db);
  const hasAdmin = (await db.users.countDocuments({}, { limit: 1 })) > 0;

  console.log(
    [
      "",
      "Demo data created:",
      `  - ${summary.templates} templates (starter designs)`,
      `  - 2 lists: Newsletter (${summary.newsletterMembers} members), Customers (${summary.customerMembers} members)`,
      `  - ${summary.contacts} contacts (${summary.unsubscribed} unsubscribed), all @example.com / @example.org`,
      `  - 1 draft campaign: "Welcome to our newsletter" -> Newsletter list`,
      "",
      hasAdmin
        ? `Start the app with \`npm run dev\` and open ${summary.appUrl}.`
        : "Start the app with `npm run dev`, open http://localhost:3000 and create your admin account.",
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
