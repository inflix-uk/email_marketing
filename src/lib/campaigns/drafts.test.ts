import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  draftFromTemplate,
  draftSteps,
  newTemplateHrefForCampaign,
  parseCampaignParam,
  templateHrefForCampaign,
  templateUpdateForDraft,
  worthAutosaving,
} from "./drafts";
import { tabFilter } from "./workspace";

const template = {
  _id: "tpl-1",
  name: "Spring sale",
  subject: "  20% off this week ",
  previewText: "Ends Sunday",
  html: "<p>Hello</p>",
  design: null,
};
const sender = { fromName: "Shop", fromEmail: "hello@example.com", replyTo: "" };
const now = new Date("2026-03-01T09:00:00Z");

describe("campaign drafts", () => {
  it("makes a draft from a template that the Drafts tab lists", () => {
    const draft = draftFromTemplate(template, sender, "c-1", now);
    assert.equal(draft._id, "c-1");
    assert.equal(draft.status, "draft");
    assert.equal(draft.subject, "20% off this week");
    assert.equal(draft.name, "20% off this week");
    assert.equal(draft.previewText, "Ends Sunday");
    assert.equal(draft.templateId, "tpl-1");
    assert.equal(draft.html, "<p>Hello</p>");
    assert.equal(draft.replyTo, null);
    assert.deepEqual(draft.listIds, []);
    assert.equal(draft.createdAt, now);
    // Everything the Drafts filter checks is set explicitly.
    const filter = tabFilter("drafts") as { archivedAt: null; parentId: null };
    assert.equal(draft.archivedAt, filter.archivedAt);
    assert.equal(draft.parentId, filter.parentId);
  });

  it("names a draft after the template when it has no subject", () => {
    const draft = draftFromTemplate(
      { ...template, subject: null, previewText: null },
      { ...sender, replyTo: " r@example.com " },
      "c-2",
      now,
    );
    assert.equal(draft.subject, "");
    assert.equal(draft.name, "Spring sale");
    assert.equal(draft.previewText, null);
    assert.equal(draft.replyTo, "r@example.com");
  });

  it("updates a draft's content from its template, keeping what the user wrote", () => {
    const kept = templateUpdateForDraft(template, { subject: "My subject", previewText: "Mine" }, now);
    assert.deepEqual(kept, { html: "<p>Hello</p>", design: null, templateId: "tpl-1", updatedAt: now });
    const filled = templateUpdateForDraft(template, { subject: " ", previewText: null }, now);
    assert.equal(filled.subject, "20% off this week");
    assert.equal(filled.previewText, "Ends Sunday");
  });

  it("only accepts sensible campaign ids from the URL", () => {
    assert.equal(parseCampaignParam("0b3c-11ef_A"), "0b3c-11ef_A");
    assert.equal(parseCampaignParam(["abc", "def"]), "abc");
    assert.equal(parseCampaignParam(undefined), null);
    assert.equal(parseCampaignParam("../x"), null);
    assert.equal(parseCampaignParam("a".repeat(65)), null);
  });

  it("links to the template editor and back", () => {
    assert.equal(templateHrefForCampaign("t 1", "c-1"), "/templates/t%201?campaign=c-1");
    assert.equal(newTemplateHrefForCampaign("c-1"), "/templates/new?campaign=c-1");
  });

  it("lists the steps of a draft", () => {
    assert.deepEqual(
      draftSteps({ subject: "Hi", html: "<p>x</p>", listCount: 0 }).map((s) => [s.label, s.done]),
      [
        ["Subject", true],
        ["Email", true],
        ["Lists", false],
      ],
    );
  });

  it("autosaves once there is a subject or a template", () => {
    assert.equal(worthAutosaving({ subject: "  ", hasDesign: false }), false);
    assert.equal(worthAutosaving({ subject: "Hi", hasDesign: false }), true);
    assert.equal(worthAutosaving({ subject: "", hasDesign: true }), true);
  });
});
