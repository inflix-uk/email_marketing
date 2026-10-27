import { collections } from "@/db";
import { newId, type AuditLogDoc } from "@/db/schema";

// Activity log: who did what, shown to admins on Settings > Activity log.
// Shared with the worker, so no Next.js imports here.

export interface AuditActor {
  /** The user's id (sessions from getSession() carry it). */
  userId?: string | null;
  email?: string | null;
}

export interface AuditObject {
  type: string;
  id?: string | null;
  details?: Record<string, unknown> | null;
}

/** Keys that are never written to the log, at any depth. */
const SECRET_KEY = /pass|secret|token|apikey|api_key|key$|hash|credential|auth/i;
const MAX_STRING = 500;
const MAX_ARRAY = 50;
const MAX_DEPTH = 4;

/**
 * Pure: a copy of `details` safe to store - secret-looking keys removed, long
 * strings and arrays cut short, nesting limited. Returns null when empty.
 */
export function sanitizeDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  const clean = cleanValue(details, 0) as Record<string, unknown> | undefined;
  return clean && Object.keys(clean).length ? clean : null;
}

function cleanValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => cleanValue(v, depth + 1)).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      const cleaned = cleanValue(v, depth + 1);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return undefined;
}

/** Pure: the document audit() inserts. */
export function buildAuditEntry(actor: AuditActor | null, action: string, obj: AuditObject, now = new Date()): AuditLogDoc {
  return {
    _id: newId(),
    actorId: actor?.userId ?? null,
    actorEmail: actor?.email ?? null,
    action,
    objectType: obj.type,
    objectId: obj.id ?? null,
    details: sanitizeDetails(obj.details),
    createdAt: now,
  };
}

/**
 * Record an action, e.g. `await audit(session, "campaign.send", { type: "campaign", id, details: { queued } })`.
 * Never throws: a failed log write is reported on the console and the action carries on.
 * Never pass passwords or keys in `details` (secret-looking keys are dropped anyway).
 */
export async function audit(actor: AuditActor | null, action: string, obj: AuditObject): Promise<void> {
  try {
    const { auditLog } = await collections();
    await auditLog.insertOne(buildAuditEntry(actor, action, obj));
  } catch (err) {
    console.error("[audit] could not write the activity log:", err instanceof Error ? err.message : err);
  }
}

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

/** Newest first. */
export async function listAuditLog(limit = 200): Promise<AuditEntry[]> {
  const { auditLog } = await collections();
  const docs = await auditLog.find({}).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
  return docs.map((d) => ({
    id: d._id,
    actorEmail: d.actorEmail,
    action: d.action,
    objectType: d.objectType,
    objectId: d.objectId,
    details: d.details,
    createdAt: d.createdAt,
  }));
}

/** Pure: a short readable line for the details column. */
export function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return "";
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString() : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}
