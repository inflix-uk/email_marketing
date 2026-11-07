import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultTab,
  normalizeFolder,
  parseWorkspaceParams,
  tabFilter,
  workspaceFilter,
  workspaceHref,
  workspaceSort,
} from "./workspace";

describe("campaign workspace", () => {
  it("parses URL params with safe defaults", () => {
    assert.deepEqual(parseWorkspaceParams({ tab: "nope", sort: "x", q: "  sale ", folder: "  Spring   2026 " }), {
      tab: null,
      q: "sale",
      sort: "date",
      folder: "Spring 2026",
    });
    assert.equal(parseWorkspaceParams({ tab: ["drafts", "sent"] }).tab, "drafts");
  });

  it("hides archived campaigns (and RSS/resend runs) from the normal tabs", () => {
    assert.deepEqual(tabFilter("drafts"), { status: { $in: ["draft"] }, archivedAt: null, parentId: null });
    assert.deepEqual(tabFilter("outbox"), { status: { $in: ["scheduled", "sending", "paused"] }, archivedAt: null, parentId: null });
    assert.deepEqual(tabFilter("archived"), { archivedAt: { $ne: null }, parentId: null });
  });

  it("searches name and subject with the input escaped", () => {
    const f = workspaceFilter("sent", "a.b(", "") as { $and: unknown[] };
    assert.deepEqual(f.$and[1], {
      $or: [{ name: { $regex: "a\\.b\\(", $options: "i" } }, { subject: { $regex: "a\\.b\\(", $options: "i" } }],
    });
    assert.deepEqual(workspaceFilter("sent", "", ""), tabFilter("sent"));
  });

  it("sorts per tab", () => {
    assert.deepEqual(workspaceSort("sent", "date"), { completedAt: -1, startedAt: -1, _id: 1 });
    assert.deepEqual(workspaceSort("drafts", "date"), { updatedAt: -1, _id: 1 });
    assert.deepEqual(workspaceSort("outbox", "name"), { name: 1, _id: 1 });
  });

  it("picks a default tab that has campaigns", () => {
    assert.equal(defaultTab({ sent: 0, drafts: 2, outbox: 1, archived: 0 }), "drafts");
    assert.equal(defaultTab({ sent: 0, drafts: 0, outbox: 0, archived: 3 }), "sent");
  });

  it("opens Drafts when a draft was saved after the last send", () => {
    const counts = { sent: 4, drafts: 1, outbox: 0, archived: 0 };
    const older = new Date("2026-01-01T10:00:00Z");
    const newer = new Date("2026-01-02T10:00:00Z");
    assert.equal(defaultTab(counts, { draftSavedAt: newer, lastSentAt: older }), "drafts");
    assert.equal(defaultTab(counts, { draftSavedAt: older, lastSentAt: newer }), "sent");
    assert.equal(defaultTab(counts, { draftSavedAt: newer, lastSentAt: null }), "drafts");
    assert.equal(defaultTab({ ...counts, drafts: 0 }, { draftSavedAt: newer, lastSentAt: older }), "sent");
  });

  it("builds URLs without defaults", () => {
    assert.equal(workspaceHref({ tab: "drafts", sort: "date", page: 1 }), "/campaigns?tab=drafts");
    assert.equal(workspaceHref({ q: "a b", sort: "name", page: 2 }), "/campaigns?q=a+b&sort=name&page=2");
    assert.ok(normalizeFolder(" x ".repeat(40)).length <= 60);
  });
});
