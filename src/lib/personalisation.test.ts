import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmail, type EmailContent } from "@/lib/sending/prepare";
import { subjectForVariant } from "@/lib/sending/ab";
import { oneLine, renderPreviewText, renderSubject, type MergeContact } from "@/lib/render";
import { fieldLabel, personalisationExample, personalisationOptions, tagInsertion } from "./personalisation";

const alex: MergeContact = { email: "alex@example.com", firstName: "Alex", lastName: "Smith", fields: { country: "Spain" } };
const nameless: MergeContact = { email: "x@example.com", firstName: null, lastName: "  ", fields: {} };
const data = (contact: MergeContact) => ({ contact, unsubscribeUrl: "https://app.example.test/u/1" });

describe("renderSubject", () => {
  it("fills in the contact's details", () => {
    assert.equal(renderSubject("Hi {{first_name | there}}, your November treat", data(alex)), "Hi Alex, your November treat");
    assert.equal(renderSubject("{{full_name}} in {{fields.country}}", data(alex)), "Alex Smith in Spain");
    assert.equal(renderSubject("News for {{country}}", data(alex)), "News for Spain");
  });

  it("uses the fallback when the value is missing or blank", () => {
    assert.equal(renderSubject("Hi {{first_name | there}}, your treat", data(nameless)), "Hi there, your treat");
    assert.equal(renderSubject("Hi {{ last_name | friend }}!", data(nameless)), "Hi friend!");
    assert.equal(renderSubject("Offers in {{fields.country | your area}}", data(nameless)), "Offers in your area");
  });

  it("leaves no double spaces when a tag without fallback is empty", () => {
    assert.equal(renderSubject("Hi {{first_name}} , news", data(nameless)), "Hi , news");
    assert.equal(renderSubject("Hello {{first_name}}", data(nameless)), "Hello");
  });

  it("is header-safe: no CR/LF or control characters from contact data", () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const evil: MergeContact = {
      ...alex,
      firstName: "Alex\r\nBcc: victim@example.com",
      fields: { country: `Spain\u0000${lineSeparator}x` },
    };
    const subject = renderSubject("Hi {{first_name}} from {{fields.country}}", data(evil));
    assert.equal(subject, "Hi Alex Bcc: victim@example.com from Spain x");
    assert.doesNotMatch(subject, /[\u0000-\u001f]/);
    assert.ok(!subject.includes(lineSeparator));
  });

  it("does not HTML-escape the subject (it is a header)", () => {
    const amp: MergeContact = { ...alex, firstName: "Ann & <Bo>" };
    assert.equal(renderSubject("Hi {{first_name}}", data(amp)), "Hi Ann & <Bo>");
  });

  it("does not run merge tags found inside contact data", () => {
    const sneaky: MergeContact = { ...alex, firstName: "{{email}}" };
    assert.equal(renderSubject("Hi {{first_name}}", data(sneaky)), "Hi {{email}}");
  });
});

describe("renderPreviewText", () => {
  it("escapes merged values for the HTML body and keeps it on one line", () => {
    const amp: MergeContact = { ...alex, firstName: "Ann\n<b>&" };
    assert.equal(renderPreviewText("For {{first_name | you}}", data(amp)), "For Ann &lt;b&gt;&amp;");
    assert.equal(renderPreviewText("For {{first_name | you}}", data(nameless)), "For you");
  });
});

describe("oneLine", () => {
  it("collapses whitespace and strips control characters", () => {
    assert.equal(oneLine("  a\tb\r\n\r\nc\u0007 "), "a b c");
  });
});

describe("buildEmail subject and preview text", () => {
  const content: EmailContent = {
    subject: "Hi {{first_name | there}}, your November treat",
    previewText: "Picked for {{fields.country | you}}",
    html: "<html><body><p>Hello</p>{{unsubscribe_url}}</body></html>",
    fromName: "Shop",
    fromEmail: "shop@example.com",
  };
  const opts = { sendId: null, unsubscribeUrl: "https://app.example.test/u/1" } as const;

  it("renders per recipient, with fallbacks", () => {
    const a = buildEmail(content, alex, opts);
    const b = buildEmail(content, nameless, opts);
    assert.equal(a.subject, "Hi Alex, your November treat");
    assert.equal(b.subject, "Hi there, your November treat");
    assert.match(a.html, /Picked for Spain/);
    assert.match(b.html, /Picked for you/);
  });

  it("renders A/B variant subjects too", () => {
    const abTest = { subjectB: "{{first_name | Friend}}, last chance", testPercent: 20, waitHours: 4, winner: null };
    const subject = subjectForVariant(content.subject, abTest, "B");
    assert.equal(buildEmail({ ...content, subject }, nameless, opts).subject, "Friend, last chance");
  });
});

describe("personalisationOptions", () => {
  it("lists the built-in tags with sensible fallbacks", () => {
    const options = personalisationOptions();
    assert.deepEqual(
      options.map((o) => [o.label, o.tag]),
      [
        ["First name", "{{first_name | there}}"],
        ["Last name", "{{last_name}}"],
        ["Full name", "{{full_name | there}}"],
        ["Email", "{{email}}"],
      ],
    );
  });

  it("adds custom fields, sorted, skipping duplicates and unusable keys", () => {
    const fields = personalisationOptions(["country", "home_city", "bad key", "country", ""]).filter((o) => o.group === "field");
    assert.deepEqual(
      fields.map((o) => [o.label, o.tag]),
      [
        ["Country", "{{fields.country}}"],
        ["Home city", "{{fields.home_city}}"],
      ],
    );
    assert.equal(fieldLabel("first.name-x"), "First name x");
  });
});

describe("tagInsertion", () => {
  const apply = (value: string, e: ReturnType<typeof tagInsertion>) => value.slice(0, e.from) + e.text + value.slice(e.to);

  it("appends at the end with a space", () => {
    const e = tagInsertion("Your November treat,", "{{first_name | there}}");
    assert.equal(apply("Your November treat,", e), "Your November treat, {{first_name | there}}");
    assert.equal(e.selectionStart, apply("Your November treat,", e).length);
  });

  it("inserts at the caret without gluing words together", () => {
    const value = "Hi, your treat";
    const e = tagInsertion(value, "{{first_name | there}}", 2);
    assert.equal(apply(value, e), "Hi {{first_name | there}}, your treat");
    const mid = tagInsertion("Hiyou", "{{x}}", 2);
    assert.equal(apply("Hiyou", mid), "Hi {{x}} you");
  });

  it("replaces a selection and clamps out-of-range positions", () => {
    assert.equal(apply("Hi NAME!", tagInsertion("Hi NAME!", "{{first_name}}", 3, 7)), "Hi {{first_name}}!");
    assert.equal(apply("", tagInsertion("", "{{email}}", 10, 20)), "{{email}}");
  });
});

describe("personalisationExample", () => {
  it("is null without merge tags", () => {
    assert.equal(personalisationExample("Plain subject"), null);
  });

  it("shows an example contact and the fallback version", () => {
    assert.deepEqual(personalisationExample("Hi {{first_name | there}}, your November treat"), {
      filled: "Hi Jane, your November treat",
      empty: "Hi there, your November treat",
    });
  });

  it("gives custom fields an example value", () => {
    assert.equal(personalisationExample("Deals in {{fields.country}}")?.filled, "Deals in United Kingdom");
    assert.equal(personalisationExample("For {{fields.shoe_size}}")?.filled, "For [shoe size]");
  });
});
