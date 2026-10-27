import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { can, isRole, PERMISSIONS, roleOf, ROLES } from "./permissions";

describe("can", () => {
  test("admin can do everything", () => {
    for (const p of PERMISSIONS) assert.equal(can("admin", p), true, p);
  });

  test("editor can work on content but not settings or the team", () => {
    for (const p of ["view", "edit", "send", "delete", "export"] as const) assert.equal(can("editor", p), true, p);
    for (const p of ["settings", "team", "audit"] as const) assert.equal(can("editor", p), false, p);
  });

  test("viewer is read-only", () => {
    assert.equal(can("viewer", "view"), true);
    for (const p of PERMISSIONS.filter((p) => p !== "view")) assert.equal(can("viewer", p), false, p);
  });

  test("unknown or missing roles can do nothing", () => {
    assert.equal(can(null, "view"), false);
    assert.equal(can(undefined, "view"), false);
    assert.equal(can("owner" as never, "view"), false);
  });
});

describe("roleOf", () => {
  test("accounts without a role are admins (backward compatible)", () => {
    assert.equal(roleOf({}), "admin");
    assert.equal(roleOf({ role: null }), "admin");
    assert.equal(roleOf(null), "admin");
  });

  test("keeps a stored role", () => {
    for (const r of ROLES) assert.equal(roleOf({ role: r }), r);
  });

  test("an unknown stored value gets the least access", () => {
    assert.equal(isRole("superuser"), false);
    assert.equal(roleOf({ role: "superuser" }), "viewer");
  });
});
