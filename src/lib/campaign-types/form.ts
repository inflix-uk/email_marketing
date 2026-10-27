// Campaign-type fields of the compose form: parsing (submitCampaign calls
// parseCampaignTypeFields) and the initial values for the form.
// Form field names all start with "ct_" so they never clash with the main form.

import { z } from "zod";
import { collections } from "@/db";
import {
  CAMPAIGN_TYPES,
  VARIANT_KEYS,
  type Campaign,
  type CampaignDoc,
  type CampaignType,
  type ResendSettings,
  type RssSettings,
  type VariantContent,
  type VariantTest,
} from "@/db/schema";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { clampPercent, MAX_VARIANTS } from "./ab-test";
import { campaignType } from "./hooks";
import { clampResendHours } from "./resend-rules";
import { checkFeedUrl, startRssSeries } from "./rss-runner";
import { formatInZone, parseTime, RSS_TIME_ZONE } from "./rss-schedule";

export type TypeFieldsResult =
  | { ok: true; fields: Partial<CampaignDoc> }
  | { ok: false; error: string; fieldErrors: Record<string, string[]> };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const oneLine = (value: string, max: number) => value.replace(/[\r\n]+/g, " ").trim().slice(0, max);

function intIn(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Content copied from a design picker value ("template:<id>" / "starter:<key>"). */
export async function resolveDesignSource(
  source: string,
): Promise<Pick<VariantContent, "templateId" | "html" | "previewText" | "design"> | null> {
  if (source.startsWith("starter:")) {
    const starter = STARTER_TEMPLATES.find((t) => t.key === source.slice("starter:".length));
    return starter ? { templateId: null, html: starter.html, previewText: starter.previewText || null, design: starter.design } : null;
  }
  if (source.startsWith("template:")) {
    const { templates } = await collections();
    const t = await templates.findOne({ _id: source.slice("template:".length) });
    return t ? { templateId: t._id, html: t.html, previewText: t.previewText || null, design: t.design || null } : null;
  }
  return null;
}

const typeSchema = z.enum(CAMPAIGN_TYPES);

async function parseVariantTest(formData: FormData): Promise<VariantTest> {
  const variable = z.enum(["subject", "content", "sender", "subject_content"]).catch("subject").parse(text(formData, "ct_ab_variable"));
  const count = intIn(text(formData, "ct_ab_count"), 2, MAX_VARIANTS, 2);
  const usesSubject = variable === "subject" || variable === "subject_content";
  const usesContent = variable === "content" || variable === "subject_content";
  const variants: VariantContent[] = [];
  for (const key of VARIANT_KEYS.slice(0, count)) {
    const empty: VariantContent = { key, subject: null, source: null, templateId: null, html: null, previewText: null, design: null, fromName: null };
    // Version A is the campaign itself (subject, template, sender from the main form / Settings).
    if (key === "A") {
      variants.push(empty);
      continue;
    }
    const v = { ...empty };
    if (usesSubject) v.subject = oneLine(text(formData, `ct_ab_subject_${key}`), 300) || null;
    if (usesContent) {
      const source = text(formData, `ct_ab_source_${key}`).slice(0, 200);
      if (source) {
        const resolved = await resolveDesignSource(source);
        v.source = source;
        if (resolved) Object.assign(v, resolved);
      }
    }
    if (variable === "sender") v.fromName = oneLine(text(formData, `ct_ab_from_${key}`), 100) || null;
    variants.push(v);
  }
  return {
    variable,
    variants,
    mode: text(formData, "ct_ab_mode") === "split" ? "split" : "sample",
    samplePercent: clampPercent(text(formData, "ct_ab_sample") || 20),
    metric: text(formData, "ct_ab_metric") === "open" ? "open" : "click",
    waitHours: intIn(text(formData, "ct_ab_wait"), 1, 168, 4),
    state: "testing",
    decideAt: null,
    winner: null,
    decidedAt: null,
    decision: null,
    remainderReleasedAt: null,
  };
}

async function parseResend(formData: FormData): Promise<ResendSettings> {
  const amount = intIn(text(formData, "ct_rs_delay"), 1, 720, 3);
  const unit = text(formData, "ct_rs_unit") === "hours" ? 1 : 24;
  const source = text(formData, "ct_rs_source").slice(0, 200);
  const resolved = source ? await resolveDesignSource(source) : null;
  return {
    condition: text(formData, "ct_rs_condition") === "not_clicked" ? "not_clicked" : "not_opened",
    delayHours: clampResendHours(amount * unit),
    subject: oneLine(text(formData, "ct_rs_subject"), 300) || null,
    source: resolved ? source : null,
    templateId: resolved?.templateId ?? null,
    html: resolved?.html ?? null,
    previewText: resolved?.previewText ?? null,
    design: resolved?.design ?? null,
    state: "waiting",
    dueAt: null,
    claimedAt: null,
    childId: null,
    resentAt: null,
    resendCount: 0,
    note: null,
  };
}

function parseRss(formData: FormData, existing: RssSettings | null | undefined): RssSettings | { error: string } {
  const rawUrl = text(formData, "ct_rss_url");
  let feedUrl = "";
  if (rawUrl) {
    const checked = checkFeedUrl(rawUrl);
    if ("error" in checked) return { error: checked.error };
    feedUrl = checked.url;
  }
  const time = parseTime(text(formData, "ct_rss_time")) ? text(formData, "ct_rss_time").padStart(5, "0") : "08:00";
  return {
    seenIds: [],
    lastItemAt: null,
    runCount: 0,
    lastCheckedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    runningAt: null,
    ...existing,
    feedUrl,
    itemCount: intIn(text(formData, "ct_rss_count"), 1, 20, 5),
    frequency: text(formData, "ct_rss_frequency") === "weekly" ? "weekly" : "daily",
    weekday: intIn(text(formData, "ct_rss_weekday"), 0, 6, 1),
    time,
    timeZone: RSS_TIME_ZONE,
    lastError: null,
  };
}

/**
 * The campaign-type part of a compose-form save. The type is read only when
 * the campaign is created; afterwards the stored type is kept (locked).
 */
export async function parseCampaignTypeFields(
  formData: FormData,
  existing: Pick<Campaign, "type" | "rss"> | null | undefined,
): Promise<TypeFieldsResult> {
  const type: CampaignType = existing ? campaignType(existing) : typeSchema.catch("regular").parse(text(formData, "ct_type") || "regular");
  const fields: Partial<CampaignDoc> = existing ? {} : { type };
  switch (type) {
    case "ab":
      fields.variantTest = await parseVariantTest(formData);
      break;
    case "resend":
      fields.resend = await parseResend(formData);
      break;
    case "rss": {
      const rss = parseRss(formData, existing?.rss);
      if ("error" in rss) return { ok: false, error: rss.error, fieldErrors: { ct_rss_url: [rss.error] } };
      fields.rss = rss;
      break;
    }
  }
  return { ok: true, fields };
}

/**
 * Compose-form buttons that mean something else for a type: for an RSS
 * series "Send now" / "Schedule" start the series. null = run the normal intent.
 */
export async function runCampaignTypeIntent(
  campaignId: string,
  intent: string,
  when: Date | null,
): Promise<{ ok?: boolean; message?: string; error?: string } | null> {
  if (intent !== "send" && intent !== "schedule") return null;
  const { campaigns } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId }, { projection: { type: 1 } });
  if (campaignType(campaign) !== "rss") return null;
  try {
    const first = await startRssSeries(campaignId, intent === "schedule" ? when : null);
    return { ok: true, message: `Series started. The feed is checked next on ${formatInZone(first)}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The series couldn't be started." };
  }
}

// --- Initial values for the form (plain, serialisable) -------------------------

export interface TypeFormValues {
  ab: {
    variable: VariantTest["variable"];
    mode: VariantTest["mode"];
    samplePercent: number;
    metric: VariantTest["metric"];
    waitHours: number;
    variants: { key: string; subject: string; source: string; fromName: string }[];
  };
  resend: { condition: ResendSettings["condition"]; amount: number; unit: "hours" | "days"; subject: string; source: string };
  rss: { feedUrl: string; itemCount: number; frequency: "daily" | "weekly"; weekday: number; time: string };
}

export function typeFormValues(campaign?: Pick<Campaign, "variantTest" | "resend" | "rss"> | null): TypeFormValues {
  const ab = campaign?.variantTest;
  const rs = campaign?.resend;
  const rss = campaign?.rss;
  const delay = rs?.delayHours ?? 72;
  return {
    ab: {
      variable: ab?.variable ?? "subject",
      mode: ab?.mode ?? "sample",
      samplePercent: ab?.samplePercent ?? 20,
      metric: ab?.metric ?? "click",
      waitHours: ab?.waitHours ?? 4,
      variants: (ab?.variants?.length ? ab.variants : [{ key: "A" }, { key: "B" }]).map((v) => {
        const c = v as Partial<VariantContent> & { key: string };
        return { key: c.key, subject: c.subject ?? "", source: c.source ?? "", fromName: c.fromName ?? "" };
      }),
    },
    resend: {
      condition: rs?.condition ?? "not_opened",
      amount: delay % 24 === 0 ? delay / 24 : delay,
      unit: delay % 24 === 0 ? "days" : "hours",
      subject: rs?.subject ?? "",
      source: rs?.source ?? "",
    },
    rss: {
      feedUrl: rss?.feedUrl ?? "",
      itemCount: rss?.itemCount ?? 5,
      frequency: rss?.frequency ?? "daily",
      weekday: rss?.weekday ?? 1,
      time: rss?.time ?? "08:00",
    },
  };
}
