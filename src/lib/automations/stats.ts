// Numbers for the automation pages. Everything is counted in the database.

import { collections } from "@/db";
import { automationSendKey, type AutomationDoc } from "@/db/schema";
import { emptyStats, getCampaignsStats, type CampaignStats } from "@/lib/sending";

export interface EnrollmentCounts {
  /** People currently waiting for their next email. */
  active: number;
  /** People who received (or were moved past) every step. */
  completed: number;
  /** People who left early: unsubscribed, bounced, deleted. */
  stopped: number;
  total: number;
}

export function emptyEnrollmentCounts(): EnrollmentCounts {
  return { active: 0, completed: 0, stopped: 0, total: 0 };
}

/** Enrolments per automation by status, in one aggregation. Automations without enrolments get zeros. */
export async function getEnrollmentCounts(automationIds: string[]): Promise<Map<string, EnrollmentCounts>> {
  const ids = [...new Set(automationIds.filter(Boolean))];
  const result = new Map<string, EnrollmentCounts>(ids.map((id) => [id, emptyEnrollmentCounts()]));
  if (ids.length === 0) return result;

  const { enrollments } = await collections();
  const rows = await enrollments
    .aggregate<{ _id: { automationId: string; status: string }; n: number }>([
      { $match: { automationId: { $in: ids } } },
      { $group: { _id: { automationId: "$automationId", status: "$status" }, n: { $sum: 1 } } },
    ])
    .toArray();
  for (const row of rows) {
    const counts = result.get(row._id.automationId);
    if (!counts) continue;
    const n = Number(row.n) || 0;
    if (row._id.status === "active" || row._id.status === "completed" || row._id.status === "stopped") {
      counts[row._id.status] += n;
    }
    counts.total += n;
  }
  return result;
}

/** People currently waiting for each step of one automation, keyed by step index. */
export async function getWaitingByStep(automationId: string): Promise<Map<number, number>> {
  const { enrollments } = await collections();
  const rows = await enrollments
    .aggregate<{ _id: number; n: number }>([
      { $match: { automationId, status: "active" } },
      { $group: { _id: "$stepIndex", n: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [Number(r._id) || 0, Number(r.n) || 0]));
}

type WithSteps = Pick<AutomationDoc, "_id"> & { steps?: { id: string }[] };

/**
 * Email stats per step (sent, opens, clicks...), keyed by step id. Automation
 * emails are stored as sends under automationSendKey(...), so this is the same
 * aggregation campaigns use.
 */
export async function getStepStats(automation: WithSteps): Promise<Map<string, CampaignStats>> {
  const steps = automation.steps ?? [];
  const byKey = await getCampaignsStats(steps.map((s) => automationSendKey(automation._id, s.id)));
  return new Map(steps.map((s) => [s.id, byKey.get(automationSendKey(automation._id, s.id)) ?? emptyStats()]));
}

/** Stats of all current steps added up, per automation - one aggregation for a whole list of automations. */
export async function getAutomationsStats(automations: WithSteps[]): Promise<Map<string, CampaignStats>> {
  const owner = new Map<string, string>();
  for (const a of automations) {
    for (const s of a.steps ?? []) owner.set(automationSendKey(a._id, s.id), a._id);
  }
  const byKey = await getCampaignsStats([...owner.keys()]);
  const result = new Map<string, CampaignStats>(automations.map((a) => [a._id, emptyStats()]));
  for (const [key, stats] of byKey) {
    const total = result.get(owner.get(key) ?? "");
    if (!total) continue;
    for (const field of Object.keys(total) as (keyof CampaignStats)[]) total[field] += stats[field];
  }
  return result;
}
