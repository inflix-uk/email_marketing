// Enrolment: a contact enters an automation when its trigger fires.
// One enrolment per (automation, contact), ever - the unique index on that
// pair makes triggering idempotent, so the same event can arrive twice (double
// form submit, retry) without anyone getting the series a second time.

import { collections } from "@/db";
import { newId, type EnrollmentDoc } from "@/db/schema";
import { firstRunAt, matchesTrigger, triggerFilter, type AutomationEvent } from "./logic";

const CHUNK = 1000;

/**
 * Enrol contacts into the active automations whose trigger matches this event.
 * Call it AFTER the change is saved. Never throws (logs instead) - a broken
 * automation must not fail a sign-up or a contact edit.
 * Only for individual actions (form sign-up, single contact add/edit, API) -
 * NOT for bulk imports or pasted lists.
 */
export async function triggerAutomations(event: AutomationEvent): Promise<void> {
  try {
    await enrollForEvent(event);
  } catch (err) {
    console.error(`[automations] could not start automations for "${event?.type}":`, err);
  }
}

/** Same as triggerAutomations but throws on database errors and reports how many enrolments were created. */
export async function enrollForEvent(event: AutomationEvent, now: Date = new Date()): Promise<number> {
  const filter = event ? triggerFilter(event) : null;
  const contactIds = [...new Set((event?.contactIds ?? []).filter((id) => typeof id === "string" && id))];
  if (!filter || contactIds.length === 0) return 0;

  const { automations, contacts, enrollments } = await collections();
  const matching = (
    await automations
      .find({ status: "active", ...filter }, { projection: { trigger: 1, "steps.delayMinutes": 1 } })
      .toArray()
  ).filter((a) => matchesTrigger(a.trigger, event) && (a.steps?.length ?? 0) > 0);
  if (matching.length === 0) return 0;

  let created = 0;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    // Only people who can be emailed: never pending, unsubscribed, bounced or complained contacts.
    const subscribed = await contacts
      .find({ _id: { $in: contactIds.slice(i, i + CHUNK) }, status: "subscribed" }, { projection: { _id: 1 } })
      .toArray();
    if (subscribed.length === 0) continue;

    for (const automation of matching) {
      const nextRunAt = firstRunAt(automation.steps, now);
      if (!nextRunAt) continue;
      const docs: EnrollmentDoc[] = subscribed.map((c) => ({
        _id: newId(),
        automationId: automation._id,
        contactId: c._id,
        stepIndex: 0,
        nextRunAt,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }));
      try {
        const res = await enrollments.insertMany(docs, { ordered: false });
        created += res.insertedCount;
      } catch (err) {
        // Already enrolled (now or in the past): skipped by the unique index; the rest were inserted.
        if (!isOnlyDuplicates(err)) throw err;
        created += insertedCount(err);
      }
    }
  }
  return created;
}

interface BulkErrorLike {
  code?: number;
  writeErrors?: { code?: number; err?: { code?: number } }[] | { code?: number; err?: { code?: number } };
  insertedCount?: number;
  result?: { insertedCount?: number };
}

/** True when an insert failed only because of duplicate keys (E11000). */
function isOnlyDuplicates(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as BulkErrorLike;
  const writeErrors = e.writeErrors === undefined ? [] : Array.isArray(e.writeErrors) ? e.writeErrors : [e.writeErrors];
  if (writeErrors.length > 0) return writeErrors.every((w) => (w.code ?? w.err?.code) === 11000);
  return e.code === 11000;
}

function insertedCount(err: unknown): number {
  const e = err as BulkErrorLike;
  return Number(e.insertedCount ?? e.result?.insertedCount ?? 0) || 0;
}
