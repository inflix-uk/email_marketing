import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bulkChangeFilter, bulkTargetError, bulkTargetFilter, bulkUpdatePlan, MAX_BULK_IDS } from "./bulk";
import { manualChanges, suppressedContact } from "./mutations";

const now = new Date("2026-10-13T09:00:00Z");

describe("bulkTargetFilter", () => {
  test("ticked rows become an _id $in (de-duplicated)", () => {
    assert.deepEqual(bulkTargetFilter({ ids: ["a", "b", "a"] }), { _id: { $in: ["a", "b"] } });
  });

  test("'all matching' uses the same filter as the contacts table", () => {
    assert.deepEqual(bulkTargetFilter({ filters: { status: "subscribed", listId: "L1", tag: "vip" } }), {
      status: "subscribed",
      listIds: "L1",
      tags: "vip",
    });
    const contains = { $regex: "jo\\.n", $options: "i" };
    assert.deepEqual(bulkTargetFilter({ filters: { q: "jo.n" } }), {
      $or: [{ email: contains }, { firstName: contains }, { lastName: contains }],
    });
  });

  test("no filters = every contact", () => {
    assert.deepEqual(bulkTargetFilter({ filters: {} }), {});
  });
});

describe("bulkTargetError", () => {
  test("ids must be 1..MAX_BULK_IDS; a filter target is always fine", () => {
    assert.match(bulkTargetError({ ids: [] })!, /at least one/);
    assert.equal(bulkTargetError({ ids: ["a"] }), null);
    assert.equal(bulkTargetError({ ids: Array.from({ length: MAX_BULK_IDS }, (_, i) => `c${i}`) }), null);
    assert.match(bulkTargetError({ ids: Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `c${i}`) })!, /at most 500/);
    assert.equal(bulkTargetError({ filters: {} }), null);
  });
});

describe("bulkUpdatePlan", () => {
  test("add to list / remove from list use $addToSet / $pull on listIds", () => {
    assert.deepEqual(bulkUpdatePlan({ type: "add_to_list", listId: "L1" }, now), {
      only: { listIds: { $ne: "L1" } },
      update: { $addToSet: { listIds: "L1" }, $set: { updatedAt: now } },
    });
    assert.deepEqual(bulkUpdatePlan({ type: "remove_from_list", listId: "L1" }, now), {
      only: { listIds: "L1" },
      update: { $pull: { listIds: "L1" }, $set: { updatedAt: now } },
    });
  });

  test("add tag / remove tag use $addToSet / $pull on tags", () => {
    assert.deepEqual(bulkUpdatePlan({ type: "add_tag", tag: "vip" }, now), {
      only: { tags: { $ne: "vip" } },
      update: { $addToSet: { tags: "vip" }, $set: { updatedAt: now } },
    });
    assert.deepEqual(bulkUpdatePlan({ type: "remove_tag", tag: "vip" }, now), {
      only: { tags: "vip" },
      update: { $pull: { tags: "vip" }, $set: { updatedAt: now } },
    });
  });

  test("unsubscribe only touches subscribed / pending contacts", () => {
    assert.deepEqual(bulkUpdatePlan({ type: "unsubscribe" }, now), {
      only: { status: { $in: ["subscribed", "pending"] } },
      update: { $set: { status: "unsubscribed", unsubscribedAt: now, updatedAt: now } },
    });
  });

  test("only the explicit subscribe action sets a contact to subscribed", () => {
    const actions = [
      { type: "add_to_list", listId: "L1" },
      { type: "remove_from_list", listId: "L1" },
      { type: "add_tag", tag: "vip" },
      { type: "remove_tag", tag: "vip" },
      { type: "unsubscribe" },
    ] as const;
    for (const action of actions) {
      const { update } = bulkUpdatePlan(action, now);
      const status = ((update as { $set?: { status?: string } }).$set)?.status;
      assert.notEqual(status, "subscribed", action.type);
      if (action.type !== "unsubscribe") assert.equal(status, undefined, action.type);
    }
  });
});

describe("bulk subscribe", () => {
  test("re-subscribes only unsubscribed or pending contacts, never bounced or complained", () => {
    const { only, update } = bulkUpdatePlan({ type: "subscribe" }, now);
    assert.deepEqual(only, { status: { $in: ["unsubscribed", "pending"] } });
    const set = (update as { $set: Record<string, unknown> }[])[0].$set;
    assert.equal(set.status, "subscribed");
    assert.equal(set.unsubscribedAt, null);
  });
});

describe("bulkChangeFilter", () => {
  test("keeps the selection and the 'would change' condition as separate clauses", () => {
    // Filtering by list L1 and removing from list L1 both use the listIds key.
    const { only } = bulkUpdatePlan({ type: "add_to_list", listId: "L2" }, now);
    assert.deepEqual(bulkChangeFilter({ filters: { listId: "L1", status: "subscribed" } }, only), {
      $and: [{ status: "subscribed", listIds: "L1" }, { listIds: { $ne: "L2" } }],
    });
    assert.deepEqual(bulkChangeFilter({ ids: ["a"] }, { tags: "vip" }), {
      $and: [{ _id: { $in: ["a"] } }, { tags: "vip" }],
    });
  });
});

describe("manualChanges", () => {
  test("a new contact joins every list and gains every tag", () => {
    assert.deepEqual(manualChanges(null, { listIds: ["L1", "L2"], tags: ["vip"] }), {
      joinedListIds: ["L1", "L2"],
      addedTags: ["vip"],
    });
  });

  test("an edit only reports lists and tags the contact didn't have before", () => {
    assert.deepEqual(manualChanges({ listIds: ["L1"], tags: ["vip", "news"] }, { listIds: ["L1", "L3"], tags: ["news", "customer"] }), {
      joinedListIds: ["L3"],
      addedTags: ["customer"],
    });
  });

  test("removing lists / tags or changing nothing reports nothing", () => {
    assert.deepEqual(manualChanges({ listIds: ["L1", "L2"], tags: ["vip"] }, { listIds: ["L1"], tags: [] }), {
      joinedListIds: [],
      addedTags: [],
    });
  });

  test("older documents without a tags field count as having no tags", () => {
    assert.deepEqual(manualChanges({ listIds: ["L1"] }, { listIds: ["L1"], tags: ["vip"] }).addedTags, ["vip"]);
  });
});

describe("suppressedContact", () => {
  test("is unsubscribed from the start, on no list, with no consent", () => {
    const doc = suppressedContact("blocked@example.com", now);
    assert.deepEqual(
      { ...doc, _id: "x" },
      {
        _id: "x",
        email: "blocked@example.com",
        firstName: null,
        lastName: null,
        fields: {},
        status: "unsubscribed",
        source: "suppression",
        listIds: [],
        unsubscribedAt: now,
        tags: [],
        consent: null,
        createdAt: now,
        updatedAt: now,
      },
    );
  });
});
