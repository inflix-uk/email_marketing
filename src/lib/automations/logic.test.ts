import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationStep, AutomationTrigger } from "@/db/schema";
import {
  advanceAfterStep,
  delayToMinutes,
  describeStepTiming,
  describeTrigger,
  failureAction,
  firstRunAt,
  formatDelay,
  getActivationProblems,
  hasContent,
  matchesTrigger,
  MAX_DELAY_MINUTES,
  MAX_STEP_ATTEMPTS,
  normalizeTag,
  retryDelayMs,
  runAtAfter,
  splitDelay,
  triggerFilter,
} from "./logic";

const NOW = new Date("2026-03-01T10:00:00.000Z");

function step(over: Partial<AutomationStep> = {}): AutomationStep {
  return { id: "s1", delayMinutes: 0, subject: "Welcome", previewText: null, html: "<p>Hello</p>", ...over };
}

describe("delay maths", () => {
  it("converts value + unit to minutes", () => {
    assert.equal(delayToMinutes(0, "minutes"), 0);
    assert.equal(delayToMinutes(15, "minutes"), 15);
    assert.equal(delayToMinutes(3, "hours"), 180);
    assert.equal(delayToMinutes(2, "days"), 2880);
    assert.equal(delayToMinutes(1.5, "hours"), 90);
  });

  it("treats negative and non-numeric values as no delay and caps at a year", () => {
    assert.equal(delayToMinutes(-5, "days"), 0);
    assert.equal(delayToMinutes(Number.NaN, "hours"), 0);
    assert.equal(delayToMinutes(9999, "days"), MAX_DELAY_MINUTES);
  });

  it("splits minutes back into the largest exact unit", () => {
    assert.deepEqual(splitDelay(0), { value: 0, unit: "minutes" });
    assert.deepEqual(splitDelay(45), { value: 45, unit: "minutes" });
    assert.deepEqual(splitDelay(120), { value: 2, unit: "hours" });
    assert.deepEqual(splitDelay(90), { value: 90, unit: "minutes" });
    assert.deepEqual(splitDelay(4320), { value: 3, unit: "days" });
    assert.deepEqual(splitDelay(1500), { value: 25, unit: "hours" });
  });

  it("round-trips through the form representation", () => {
    for (const minutes of [0, 1, 59, 60, 61, 1440, 2880, 10080, 43200]) {
      const { value, unit } = splitDelay(minutes);
      assert.equal(delayToMinutes(value, unit), minutes);
    }
  });

  it("formats delays in plain English", () => {
    assert.equal(formatDelay(0), "immediately");
    assert.equal(formatDelay(1), "1 minute");
    assert.equal(formatDelay(60), "1 hour");
    assert.equal(formatDelay(180), "3 hours");
    assert.equal(formatDelay(1440), "1 day");
    assert.equal(formatDelay(2880), "2 days");
    assert.equal(describeStepTiming(0, 0), "Immediately after the trigger");
    assert.equal(describeStepTiming(60, 0), "1 hour after the trigger");
    assert.equal(describeStepTiming(2880, 1), "2 days after the previous email");
  });

  it("computes run times from a delay", () => {
    assert.equal(runAtAfter(NOW, 0).getTime(), NOW.getTime());
    assert.equal(runAtAfter(NOW, 90).toISOString(), "2026-03-01T11:30:00.000Z");
    assert.equal(runAtAfter(NOW, 2880).toISOString(), "2026-03-03T10:00:00.000Z");
    // Garbage in the database never produces an invalid or past date.
    assert.equal(runAtAfter(NOW, -10).getTime(), NOW.getTime());
    assert.equal(runAtAfter(NOW, Number.NaN).getTime(), NOW.getTime());
  });
});

describe("trigger matching", () => {
  const list: AutomationTrigger = { type: "list_joined", listId: "L1" };
  const form: AutomationTrigger = { type: "form_submitted", formId: "F1" };
  const tag: AutomationTrigger = { type: "tag_added", tag: "vip" };

  it("matches the same list / form / tag", () => {
    assert.equal(matchesTrigger(list, { type: "list_joined", listId: "L1", contactIds: [] }), true);
    assert.equal(matchesTrigger(form, { type: "form_submitted", formId: "F1", contactIds: [] }), true);
    assert.equal(matchesTrigger(tag, { type: "tag_added", tag: "vip", contactIds: [] }), true);
  });

  it("does not match another list / form / tag", () => {
    assert.equal(matchesTrigger(list, { type: "list_joined", listId: "L2", contactIds: [] }), false);
    assert.equal(matchesTrigger(form, { type: "form_submitted", formId: "F2", contactIds: [] }), false);
    assert.equal(matchesTrigger(tag, { type: "tag_added", tag: "vip-2026", contactIds: [] }), false);
  });

  it("does not match a different kind of event with the same id", () => {
    assert.equal(matchesTrigger(list, { type: "form_submitted", formId: "L1", contactIds: [] }), false);
    assert.equal(matchesTrigger(form, { type: "tag_added", tag: "F1", contactIds: [] }), false);
    assert.equal(matchesTrigger(tag, { type: "list_joined", listId: "vip", contactIds: [] }), false);
  });

  it("compares tags case-insensitively and ignores surrounding spaces", () => {
    assert.equal(normalizeTag("  VIP "), "vip");
    assert.equal(matchesTrigger(tag, { type: "tag_added", tag: " VIP ", contactIds: [] }), true);
    assert.equal(matchesTrigger({ type: "tag_added", tag: "Vip" }, { type: "tag_added", tag: "vip", contactIds: [] }), true);
  });

  it("never matches empty ids or a missing trigger", () => {
    assert.equal(matchesTrigger({ type: "list_joined", listId: "" }, { type: "list_joined", listId: "", contactIds: [] }), false);
    assert.equal(matchesTrigger({ type: "tag_added", tag: " " }, { type: "tag_added", tag: "", contactIds: [] }), false);
    assert.equal(matchesTrigger(null, { type: "list_joined", listId: "L1", contactIds: [] }), false);
  });

  it("builds the matching database filter", () => {
    assert.deepEqual(triggerFilter({ type: "list_joined", listId: "L1", contactIds: [] }), {
      "trigger.type": "list_joined",
      "trigger.listId": "L1",
    });
    assert.deepEqual(triggerFilter({ type: "form_submitted", formId: "F1", contactIds: [] }), {
      "trigger.type": "form_submitted",
      "trigger.formId": "F1",
    });
    assert.deepEqual(triggerFilter({ type: "tag_added", tag: " VIP ", contactIds: [] }), {
      "trigger.type": "tag_added",
      "trigger.tag": "vip",
    });
    assert.equal(triggerFilter({ type: "list_joined", listId: "", contactIds: [] }), null);
    assert.equal(triggerFilter({ type: "tag_added", tag: "  ", contactIds: [] }), null);
  });

  it("describes triggers in plain English", () => {
    const lists = new Map([["L1", "Newsletter"]]);
    const forms = new Map([["F1", "Footer sign-up"]]);
    assert.equal(describeTrigger(list, { lists }), 'Joins list "Newsletter"');
    assert.equal(describeTrigger(form, { forms }), 'Submits form "Footer sign-up"');
    assert.equal(describeTrigger(tag), 'Gets tag "vip"');
    assert.equal(describeTrigger({ type: "list_joined", listId: "gone" }, { lists }), "Joins list (deleted list)");
    assert.equal(describeTrigger({ type: "form_submitted", formId: "gone" }), "Submits form (deleted form)");
  });
});

describe("step advancing", () => {
  const steps = [{ delayMinutes: 0 }, { delayMinutes: 1440 }, { delayMinutes: 30 }];

  it("schedules the first run from the first step's delay", () => {
    assert.equal(firstRunAt(steps, NOW)?.getTime(), NOW.getTime());
    assert.equal(firstRunAt([{ delayMinutes: 60 }], NOW)?.toISOString(), "2026-03-01T11:00:00.000Z");
    assert.equal(firstRunAt([], NOW), null);
  });

  it("moves to the next step after its own delay", () => {
    assert.deepEqual(advanceAfterStep(steps, 0, NOW), {
      status: "active",
      stepIndex: 1,
      nextRunAt: new Date("2026-03-02T10:00:00.000Z"),
    });
    assert.deepEqual(advanceAfterStep(steps, 1, NOW), {
      status: "active",
      stepIndex: 2,
      nextRunAt: new Date("2026-03-01T10:30:00.000Z"),
    });
  });

  it("completes after the last step", () => {
    assert.deepEqual(advanceAfterStep(steps, 2, NOW), { status: "completed", stepIndex: 3 });
    assert.deepEqual(advanceAfterStep([{ delayMinutes: 0 }], 0, NOW), { status: "completed", stepIndex: 1 });
  });

  it("completes when steps were removed while someone was waiting", () => {
    assert.deepEqual(advanceAfterStep([{ delayMinutes: 0 }], 4, NOW), { status: "completed", stepIndex: 5 });
    assert.deepEqual(advanceAfterStep([], 0, NOW), { status: "completed", stepIndex: 1 });
  });

  it("retries temporary errors with backoff, up to the attempt limit", () => {
    assert.equal(retryDelayMs(1), 60_000);
    assert.equal(retryDelayMs(2), 5 * 60_000);
    assert.equal(retryDelayMs(7), 5 * 60_000);
    assert.equal(retryDelayMs(0), 60_000);
    assert.equal(failureAction({ permanent: false, attempts: 1 }), "retry");
    assert.equal(failureAction({ permanent: false, attempts: MAX_STEP_ATTEMPTS - 1 }), "retry");
    assert.equal(failureAction({ permanent: false, attempts: MAX_STEP_ATTEMPTS }), "fail");
    assert.equal(failureAction({ permanent: true, attempts: 1 }), "fail");
  });
});

describe("activation checks", () => {
  const ready = {
    trigger: { type: "list_joined", listId: "L1" } as AutomationTrigger,
    steps: [step()],
    fromName: "Acme",
    fromEmail: "hello@example.com",
  };

  it("accepts a complete automation", () => {
    assert.deepEqual(getActivationProblems(ready), []);
  });

  it("requires at least one step", () => {
    assert.deepEqual(getActivationProblems({ ...ready, steps: [] }), ["Add at least one email."]);
  });

  it("requires a subject and content on every step", () => {
    const problems = getActivationProblems({
      ...ready,
      steps: [step(), step({ id: "s2", subject: "  " }), step({ id: "s3", html: "<html><body><p> </p></body></html>" })],
    });
    assert.deepEqual(problems, ["Email 2 needs a subject line.", "Email 3 has no content."]);
  });

  it("requires a sender", () => {
    assert.deepEqual(getActivationProblems({ ...ready, fromName: "", fromEmail: "" }), [
      "Add a from name.",
      "Add a from email.",
    ]);
    assert.deepEqual(getActivationProblems({ ...ready, fromEmail: "not-an-email" }), [
      "The from email isn't a valid address.",
    ]);
  });

  it("requires a trigger target", () => {
    assert.deepEqual(getActivationProblems({ ...ready, trigger: { type: "list_joined", listId: "" } }), [
      "Choose the list that starts this automation.",
    ]);
    assert.deepEqual(getActivationProblems({ ...ready, trigger: { type: "tag_added", tag: " " } }), [
      "Enter the tag that starts this automation.",
    ]);
  });

  it("recognises visible content", () => {
    assert.equal(hasContent("<p>Hello</p>"), true);
    assert.equal(hasContent('<table><tr><td><img src="https://example.com/a.png"></td></tr></table>'), true);
    assert.equal(hasContent(""), false);
    assert.equal(hasContent("<html><head><title>x</title><style>p{}</style></head><body><!-- todo --></body></html>"), false);
    assert.equal(hasContent("<div>&nbsp;</div>"), false);
  });
});
