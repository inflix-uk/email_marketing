// Email report formulas. Pure (no database), shared by the single-campaign
// report and the cross-campaign reports page, so every screen computes a
// metric the same way.
//
// Definitions:
//   S  = sent: emails the mail server accepted (test sends are never counted)
//   O  = unique openers,  C = unique clickers
//   open rate        = O / S
//   click rate       = C / S
//   click-to-open    = C / O        (N/A when nobody opened)
//   hard bounce rate = hard / S,  soft bounce rate = soft / S
//   bounce rate      = (hard + soft) / S
//   unsubscribe rate = unsubscribes / S,  complaint rate = complaints / S
//   accepted excl. hard bounces = S - hard bounces after acceptance
//     (SMTP gives no delivery confirmation, so we never call it "delivered")
// A zero denominator gives null, shown as "N/A". Values are kept at full
// precision; only formatting rounds (2 decimals).

export interface MetricCounts {
  /** S: accepted by the mail server, excluding tests. */
  sent: number;
  /** O: recipients who opened at least once. */
  uniqueOpens: number;
  totalOpens: number;
  /** C: recipients who clicked at least once. */
  uniqueClicks: number;
  totalClicks: number;
  hardBounces: number;
  softBounces: number;
  unsubscribes: number;
  complaints: number;
  /**
   * Hard bounces among the accepted emails (reported later by the provider).
   * Defaults to `hardBounces`.
   */
  acceptedHardBounces?: number;
}

export interface CampaignMetrics {
  /** Fractions (0.2 = 20%), or null when the denominator is 0. */
  openRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
  hardBounceRate: number | null;
  softBounceRate: number | null;
  bounceRate: number | null;
  unsubscribeRate: number | null;
  complaintRate: number | null;
  /** S - hard bounces (never below 0). */
  acceptedExclHardBounces: number;
}

/** part / whole, or null when whole is 0 (or not a finite positive number). */
export function ratio(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0 || !Number.isFinite(part)) return null;
  return part / whole;
}

export function computeMetrics(c: MetricCounts): CampaignMetrics {
  const S = c.sent;
  return {
    openRate: ratio(c.uniqueOpens, S),
    clickRate: ratio(c.uniqueClicks, S),
    clickToOpenRate: ratio(c.uniqueClicks, c.uniqueOpens),
    hardBounceRate: ratio(c.hardBounces, S),
    softBounceRate: ratio(c.softBounces, S),
    bounceRate: ratio(c.hardBounces + c.softBounces, S),
    unsubscribeRate: ratio(c.unsubscribes, S),
    complaintRate: ratio(c.complaints, S),
    acceptedExclHardBounces: Math.max(0, S - (c.acceptedHardBounces ?? c.hardBounces)),
  };
}

/** 0.2 -> "20.00%", null -> "N/A". */
export function formatRate(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Share of a total as a rate (for link tables, device breakdowns). */
export function formatShare(part: number, whole: number, decimals = 2): string {
  return formatRate(ratio(part, whole), decimals);
}

/** Short explanations for tooltips (plain words, no jargon). */
export const METRIC_HELP = {
  sent: "Emails your mail server accepted. Test emails are not counted.",
  openRate: "People who opened at least once, divided by emails sent.",
  clickRate: "People who clicked at least one link, divided by emails sent.",
  clickToOpenRate: "People who clicked, divided by people who opened. N/A when nobody opened.",
  bounceRate: "Hard + soft bounces, divided by emails sent. Hard = the address doesn't exist. Soft = a temporary problem, like a full mailbox.",
  unsubscribeRate: "Unsubscribes divided by emails sent.",
  complaintRate: "People who marked the email as spam, divided by emails sent.",
  accepted:
    "Sent minus hard bounces. Mail servers don't confirm delivery to the inbox, so this is the closest honest number.",
  total: "Total counts every open or click, including repeats by the same person. Unique counts each person once.",
} as const;
