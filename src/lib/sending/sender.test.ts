import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { senderFromSettings } from "./sender";

const settings = { fromName: "Zextons", fromEmail: "hello@zextons.co.uk", replyTo: "" };

describe("senderFromSettings", () => {
  it("replaces an old sender with the one in Settings", () => {
    const out = senderFromSettings({ fromName: "Hamza", fromEmail: "hamza@zextons.co.uk", replyTo: null }, settings);
    assert.deepEqual(out, { fromName: "Zextons", fromEmail: "hello@zextons.co.uk", replyTo: null });
  });

  it("drops a reply-to that only followed the old sender", () => {
    const out = senderFromSettings(
      { fromName: "Hamza", fromEmail: "hamza@zextons.co.uk", replyTo: "Hamza@Zextons.co.uk" },
      settings,
    );
    assert.equal(out?.replyTo, null);
  });

  it("uses the Settings reply-to when the campaign has none of its own", () => {
    const out = senderFromSettings({ fromEmail: "hamza@zextons.co.uk", replyTo: "" }, { ...settings, replyTo: "Sales@Zextons.co.uk" });
    assert.equal(out?.replyTo, "sales@zextons.co.uk");
  });

  it("keeps a reply-to chosen for this campaign", () => {
    const out = senderFromSettings({ fromEmail: "hamza@zextons.co.uk", replyTo: "orders@zextons.co.uk" }, settings);
    assert.equal(out?.replyTo, "orders@zextons.co.uk");
  });

  it("never stores a reply-to equal to the From email", () => {
    const out = senderFromSettings({ fromEmail: "x@zextons.co.uk", replyTo: "" }, { ...settings, replyTo: "hello@zextons.co.uk" });
    assert.equal(out?.replyTo, null);
  });

  it("falls back to the address when Settings has no name", () => {
    assert.equal(senderFromSettings({}, { ...settings, fromName: "  " })?.fromName, "hello@zextons.co.uk");
  });

  it("does nothing when Settings has no sender", () => {
    assert.equal(senderFromSettings({ fromEmail: "hamza@zextons.co.uk" }, { ...settings, fromEmail: "" }), null);
  });
});
