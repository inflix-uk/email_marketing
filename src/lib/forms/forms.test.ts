import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FormField } from "@/db/schema";
import type { LinkContext } from "@/lib/tokens";
import { buildConfirmationEmail } from "./confirmation-email";
import { htmlEmbedSnippet, iframeSnippet } from "./snippets";
import { buildConfirmToken, buildConfirmUrl, verifyConfirmToken } from "./tokens";
import { formInputSchema, HONEYPOT_FIELD, parseFormTags, parseSubmission } from "./validation";

const ctx: LinkContext = { appUrl: "https://mail.example.com", secret: "test-secret-0123456789abcdef0123456789abcdef" };
const CONTACT = "3f0c9a8e-8a8e-4c3e-9d5e-1b2c3d4e5f60";
const FORM = "0b1f6f1c-58a5-4e0b-9f3e-7a4de1a2b3c4";

describe("confirmation tokens", () => {
  const issuedAt = new Date("2026-06-15T12:00:00Z");

  test("round trip", () => {
    const token = buildConfirmToken(ctx, CONTACT, FORM, issuedAt);
    assert.equal(token.split(".").length, 4);
    assert.deepEqual(verifyConfirmToken(ctx, token), { contactId: CONTACT, formId: FORM, issuedAt });
    assert.equal(buildConfirmUrl(ctx, CONTACT, FORM, issuedAt), `https://mail.example.com/c/${token}`);
  });

  test("tampering with any part invalidates it", () => {
    const [c, f, t, s] = buildConfirmToken(ctx, CONTACT, FORM, issuedAt).split(".");
    const other = "11111111-2222-4333-8444-555555555555";
    assert.equal(verifyConfirmToken(ctx, [other, f, t, s].join(".")), null);
    assert.equal(verifyConfirmToken(ctx, [c, other, t, s].join(".")), null);
    assert.equal(verifyConfirmToken(ctx, [c, f, "zzzzzz", s].join(".")), null);
    assert.equal(verifyConfirmToken(ctx, [c, f, t, "x".repeat(22)].join(".")), null);
    assert.equal(verifyConfirmToken(ctx, [c, f, s].join(".")), null);
    assert.equal(verifyConfirmToken(ctx, ""), null);
    assert.equal(verifyConfirmToken(ctx, "a".repeat(500)), null);
  });

  test("a different secret rejects the token", () => {
    const token = buildConfirmToken(ctx, CONTACT, FORM, issuedAt);
    assert.equal(verifyConfirmToken({ ...ctx, secret: "another-secret-another-secret-123456" }, token), null);
  });
});

describe("parseSubmission", () => {
  const fields: FormField[] = [
    { key: "first_name", label: "First name", required: true },
    { key: "last_name", label: "Last name", required: false },
    { key: "company", label: "Company", required: false },
  ];

  test("valid submission: email normalised, only the form's fields kept", () => {
    const result = parseSubmission(fields, {
      email: "  Jane@Example.COM ",
      first_name: " Jane ",
      company: "Acme",
      role: "ignored",
      [HONEYPOT_FIELD]: "",
    });
    assert.deepEqual(result, {
      ok: true,
      submission: { email: "jane@example.com", firstName: "Jane", lastName: null, fields: { company: "Acme" } },
    });
  });

  test("honeypot filled in -> bot", () => {
    assert.deepEqual(parseSubmission(fields, { email: "jane@example.com", [HONEYPOT_FIELD]: "http://spam.example" }), {
      ok: false,
      bot: true,
    });
  });

  test("invalid / missing / over-long email", () => {
    for (const email of ["", "nope", "a@b", `${"a".repeat(250)}@example.com`, undefined, ["x@example.com"], { a: 1 }]) {
      const result = parseSubmission(fields, { email, first_name: "Jane" });
      assert.equal(result.ok, false);
      assert.equal(!result.ok && !result.bot && result.code, "invalid_email");
    }
  });

  test("required field missing", () => {
    const result = parseSubmission(fields, { email: "jane@example.com", first_name: "  " });
    assert.deepEqual(result, { ok: false, bot: false, code: "missing_field", message: "First name is required." });
  });

  test("length limits", () => {
    const longName = parseSubmission(fields, { email: "jane@example.com", first_name: "x".repeat(101) });
    assert.equal(!longName.ok && !longName.bot && longName.code, "too_long");
    const longValue = parseSubmission(fields, { email: "jane@example.com", first_name: "Jane", company: "x".repeat(501) });
    assert.equal(!longValue.ok && !longValue.bot && longValue.code, "too_long");
  });
});

describe("form editor input", () => {
  const valid = {
    name: "Newsletter",
    title: "Join us",
    description: "",
    buttonText: "Subscribe",
    fields: [{ key: "first_name", label: "First name", required: false }],
    listIds: ["a", "a", "b"],
    tags: "VIP, webinar 2026, vip",
    doubleOptIn: true,
    successMessage: "Thanks!",
    redirectUrl: "",
    active: true,
  };

  test("normalises", () => {
    const parsed = formInputSchema.parse(valid);
    assert.deepEqual(parsed.listIds, ["a", "b"]);
    assert.deepEqual(parsed.tags, ["vip", "webinar 2026"]);
    assert.equal(parsed.description, null);
    assert.equal(parsed.redirectUrl, null);
  });

  test("rejects bad field keys, duplicates and non-http redirect URLs", () => {
    const accepts = (patch: object) => formInputSchema.safeParse({ ...valid, ...patch }).success;
    assert.equal(accepts({ fields: [{ key: "email", label: "Email", required: true }] }), false);
    assert.equal(accepts({ fields: [{ key: HONEYPOT_FIELD, label: "Site", required: false }] }), false);
    assert.equal(accepts({ fields: [{ key: "my field", label: "X", required: false }] }), false);
    assert.equal(
      accepts({
        fields: [
          { key: "city", label: "City", required: false },
          { key: "City", label: "City", required: false },
        ],
      }),
      false,
    );
    assert.equal(accepts({ fields: [{ key: "city", label: "", required: false }] }), false);
    assert.equal(accepts({ redirectUrl: "javascript:alert(1)" }), false);
    assert.equal(accepts({ redirectUrl: "/thanks" }), false);
    assert.equal(accepts({ redirectUrl: "https://example.com/thanks" }), true);
    assert.equal(accepts({ name: " " }), false);
  });

  test("tags", () => {
    assert.deepEqual(parseFormTags(" A ,b,, a"), { tags: ["a", "b"] });
    assert.ok("error" in parseFormTags("x".repeat(51)));
    assert.ok("error" in parseFormTags(Array.from({ length: 21 }, (_, i) => `t${i}`)));
  });
});

describe("snippets and confirmation email", () => {
  const form = {
    id: FORM,
    title: 'News "weekly"',
    buttonText: "Sign <up>",
    fields: [{ key: "first_name", label: "First name", required: true }],
  };

  test("HTML embed posts to the endpoint, escapes text and includes the honeypot", () => {
    const html = htmlEmbedSnippet("https://mail.example.com", form);
    assert.match(html, new RegExp(`<form action="https://mail.example.com/api/subscribe/${FORM}" method="post">`));
    assert.match(html, /name="email" required/);
    assert.match(html, /name="first_name" required/);
    assert.match(html, new RegExp(`name="${HONEYPOT_FIELD}"`));
    assert.match(html, /Sign &lt;up&gt;/);
  });

  test("iframe points at the hosted page", () => {
    const html = iframeSnippet("https://mail.example.com", form);
    assert.match(html, new RegExp(`src="https://mail.example.com/f/${FORM}\\?embed=1"`));
    assert.match(html, /title="News &quot;weekly&quot;"/);
  });

  test("confirmation email has the button, the sender and the company address", () => {
    const msg = buildConfirmationEmail({
      to: "jane@example.com",
      firstName: "Jane <b>",
      confirmUrl: "https://mail.example.com/c/abc.def.1.sig",
      fromName: "Acme News",
      fromEmail: "news@example.com",
      replyTo: "",
      companyAddress: "1 High Street\nLeeds",
    });
    assert.equal(msg.to, "jane@example.com");
    assert.deepEqual(msg.from, { name: "Acme News", address: "news@example.com" });
    assert.equal(msg.replyTo, null);
    assert.match(msg.html, /href="https:\/\/mail\.example\.com\/c\/abc\.def\.1\.sig"[^>]*>Confirm subscription</);
    assert.match(msg.html, /Hi Jane &lt;b&gt;,/);
    assert.match(msg.html, /1 High Street<br>Leeds/);
    assert.match(msg.text ?? "", /https:\/\/mail\.example\.com\/c\/abc\.def\.1\.sig/);
  });
});
