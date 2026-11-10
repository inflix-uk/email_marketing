// The sender always comes from Settings. A campaign stores a copy of it when it
// is saved, so this brings that copy up to date right before the campaign is
// queued: a change on Settings then applies to drafts and scheduled campaigns
// saved earlier too.

import { normalizeEmail } from "@/lib/utils";

export interface SenderSettings {
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

export interface CampaignSender {
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
}

/**
 * The sender fields to store on a campaign, given the current Settings.
 * A reply-to that only followed the old sender (empty, the campaign's old From
 * address, or the From address in Settings) follows Settings again; a
 * different reply-to someone chose for this campaign is kept.
 * Returns null when Settings has no sender (nothing to apply).
 */
export function senderFromSettings(
  campaign: CampaignSender,
  settings: SenderSettings,
): { fromName: string; fromEmail: string; replyTo: string | null } | null {
  const fromEmail = normalizeEmail(settings.fromEmail ?? "");
  if (!fromEmail) return null;
  const fromName = (settings.fromName ?? "").trim() || fromEmail;
  const defaultReplyTo = normalizeEmail(settings.replyTo ?? "") || null;

  const current = normalizeEmail(campaign.replyTo ?? "");
  const followsSender =
    !current ||
    current === normalizeEmail(campaign.fromEmail ?? "") ||
    current === fromEmail ||
    current === defaultReplyTo;
  const replyTo = followsSender ? defaultReplyTo : current;

  return { fromName, fromEmail, replyTo: replyTo === fromEmail ? null : replyTo };
}
