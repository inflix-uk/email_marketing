import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { workspaceHref } from "@/lib/campaigns/workspace";
import { DEFAULT_TIME_ZONE, formatInTimeZone, utcToZonedLocal } from "@/lib/schedule";
import { deleteCampaign, unscheduleCampaign, type ComposeNotice } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { ComposeForm } from "../_components/compose-form";
import { CampaignTypeSection } from "../_components/type-section";
import { EmailPreview } from "@/components/email-editor";
import { can } from "@/lib/permissions";
import { getComposeData } from "../_lib/compose-data";
import { displaySubject } from "../_lib/display";

const NOTICES: ComposeNotice[] = ["saved", "created", "design-saved", "test-sent", "test-failed", "scheduled"];

/** /campaigns/[id] for draft and scheduled campaigns. */
export async function CampaignEditor({ campaign, notice }: { campaign: Campaign; notice?: string }) {
  const [session, data] = await Promise.all([requireSession(), getComposeData(campaign)]);
  // Back to the tab this campaign is listed on.
  const backHref = workspaceHref({ tab: campaign.status === "scheduled" ? "outbox" : campaign.archivedAt ? "archived" : "drafts" });
  // Older scheduled campaigns only stored the UTC time: show it in the default timezone.
  const scheduledTimeZone = campaign.scheduledAt ? (campaign.scheduledTimeZone ?? DEFAULT_TIME_ZONE) : null;
  const scheduledLocal =
    campaign.scheduledAt && scheduledTimeZone
      ? (campaign.scheduledLocal ?? utcToZonedLocal(campaign.scheduledAt, scheduledTimeZone))
      : null;

  // Viewers see the email but can't change, send or delete it.
  if (!can(session.role, "edit")) {
    return (
      <>
        <PageHeader
          back={
            <Link href={backHref} className="font-medium text-slate-500 hover:text-slate-700">
              &larr; Campaigns
            </Link>
          }
          title={displaySubject(campaign.subject) || "Untitled campaign"}
          description={<StatusBadge status={campaign.status} />}
        />
        {campaign.status === "scheduled" && campaign.scheduledAt ? (
          <p className="mb-4 text-sm text-slate-600">
            Goes out <strong className="font-semibold">{formatInTimeZone(campaign.scheduledAt, scheduledTimeZone ?? DEFAULT_TIME_ZONE)}</strong>
          </p>
        ) : null}
        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <EmailPreview html={campaign.html} height={620} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={
          <Link href={backHref} className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title={displaySubject(campaign.subject) || "Untitled campaign"}
        description={<StatusBadge status={campaign.status} />}
        actions={
          campaign.status === "draft" && can(session.role, "delete") ? (
            <ConfirmButton
              action={deleteCampaign.bind(null, campaign.id)}
              label="Delete"
              variant="ghost"
              title="Delete this draft?"
              confirmLabel="Delete"
              pendingText="Deleting..."
            />
          ) : null
        }
      />

      {campaign.status === "scheduled" && campaign.scheduledAt ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sky-50 px-5 py-3 ring-1 ring-inset ring-sky-200">
          <p className="text-sm text-sky-900">
            Goes out <strong className="font-semibold">{formatInTimeZone(campaign.scheduledAt, scheduledTimeZone ?? DEFAULT_TIME_ZONE)}</strong>
          </p>
          <ActionButton action={unscheduleCampaign.bind(null, campaign.id)} pendingText="Unscheduling..." size="sm">
            Unschedule
          </ActionButton>
        </div>
      ) : null}

      <ComposeForm
        // Remount after saves that changed the stored campaign (e.g. scheduling).
        key={`${campaign.status}-${campaign.scheduledAt?.toISOString() ?? ""}`}
        campaignId={campaign.id}
        initial={{
          subject: campaign.subject,
          name: campaign.name,
          previewText: campaign.previewText ?? "",
          // Empty = the Settings reply-to (stored on save).
          replyTo: campaign.replyTo && campaign.replyTo.toLowerCase() !== data.defaultReplyTo.trim().toLowerCase() ? campaign.replyTo : "",
          format: campaign.format ?? "html",
          textBody: campaign.textBody ?? "",
          textBodyFor: campaign.textBodyFor ?? null,
          scheduledLocal,
          scheduledTimeZone,
        }}
        data={data}
        defaultTestTo={session.email}
        notice={NOTICES.find((n) => n === notice)}
        typeOptions={<CampaignTypeSection campaign={campaign} designs={data.designs} />}
        autosave={campaign.status === "draft"}
      />
    </>
  );
}
