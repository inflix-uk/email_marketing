/**
 * Why a campaign action was refused:
 * - problems: the campaign isn't ready (no subject, no recipients...);
 * - state: wrong status for this action (already sent, still a draft...);
 * - busy: another request/process is queueing it right now - try again shortly.
 */
export type CampaignErrorCode = "problems" | "state" | "busy";

/** A user-facing problem (bad state, missing content...). The UI shows `.message`. */
export class CampaignError extends Error {
  readonly code: CampaignErrorCode;

  constructor(message: string, code: CampaignErrorCode = "state") {
    super(message);
    this.name = "CampaignError";
    this.code = code;
  }
}
