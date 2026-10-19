import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { deleteCampaign, unscheduleCampaign, type ComposeNotice } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { ComposeForm } from "../_components/compose-form";
import { LocalDateTime } from "../_components/local-time";
import { getComposeData } from "../_lib/compose-data";
import { displaySubject } from "../_lib/display";

const NOTICES: ComposeNotice[] = ["saved", "test-sent", "test-failed", "scheduled"];

/** /campaigns/[id] for draft and scheduled campaigns. */
export async function CampaignEditor({ campaign, notice }: { campaign: Campaign; notice?: string }) {
  const [session, data] = await Promise.all([requireSession(), getComposeData(campaign)]);

  return (
    <>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title={displaySubject(campaign.subject) || "Untitled campaign"}
        description={<StatusBadge status={campaign.status} />}
        actions={
          campaign.status === "draft" ? (
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
            Goes out <strong className="font-semibold"><LocalDateTime value={campaign.scheduledAt.toISOString()} /></strong>
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
        initialSubject={campaign.subject}
        scheduledAt={campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null}
        data={data}
        defaultTestTo={session.email}
        notice={NOTICES.find((n) => n === notice)}
      />
    </>
  );
}
