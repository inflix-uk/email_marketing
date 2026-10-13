import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { countRecipients, getCampaignProblems } from "@/lib/sending";
import { lintEmailHtml } from "@/lib/templates/lint";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { deleteCampaign, duplicateCampaign, unscheduleCampaign } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { LocalDateTime } from "../_components/local-time";
import { getListsWithCounts } from "../_lib/queries";
import { EditorForm } from "./editor-form";
import { EditorStateProvider } from "./editor-state";
import { ReviewPanel } from "./review-panel";

/** /campaigns/[id] for draft and scheduled campaigns. */
export async function CampaignEditor({ campaign }: { campaign: Campaign }) {
  const [session, lists, problems] = await Promise.all([
    requireSession(),
    getListsWithCounts(),
    getCampaignProblems(campaign.id),
  ]);
  // Ignore ids of lists deleted since the campaign was saved.
  const listIdSet = new Set(lists.map((l) => l.id));
  const selectedListIds = (campaign.listIds ?? []).filter((id) => listIdSet.has(id));
  const recipients = selectedListIds.length ? await countRecipients(selectedListIds) : 0;
  const lintIssues = lintEmailHtml(campaign.html);

  return (
    <EditorStateProvider>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title={campaign.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span>Last edited {formatDateTime(campaign.updatedAt)}</span>
          </span>
        }
        actions={
          <>
            <ActionButton action={duplicateCampaign.bind(null, campaign.id)} pendingText="Duplicating...">
              Duplicate
            </ActionButton>
            {campaign.status === "draft" ? (
              <ConfirmButton
                action={deleteCampaign.bind(null, campaign.id)}
                label="Delete"
                variant="ghost"
                title="Delete this draft?"
                description={
                  <p>
                    &ldquo;{campaign.name}&rdquo; will be deleted permanently. This can&apos;t be undone.
                  </p>
                }
                confirmLabel="Delete draft"
                pendingText="Deleting..."
              />
            ) : null}
          </>
        }
      />

      {campaign.status === "scheduled" && campaign.scheduledAt ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-sky-50 px-5 py-4 ring-1 ring-inset ring-sky-200">
          <div className="flex items-start gap-3">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 text-sky-600"
            >
              <path d="M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-sky-900">
                Scheduled for <LocalDateTime value={campaign.scheduledAt.toISOString()} />
              </p>
              <p className="mt-0.5 text-sm text-sky-800">
                It will go out automatically to about {formatNumber(recipients)}{" "}
                {recipients === 1 ? "recipient" : "recipients"}. You can keep editing until then.
              </p>
            </div>
          </div>
          <ActionButton action={unscheduleCampaign.bind(null, campaign.id)} pendingText="Unscheduling...">
            Unschedule
          </ActionButton>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <EditorForm
          campaignId={campaign.id}
          defaults={{
            name: campaign.name,
            subject: campaign.subject,
            previewText: campaign.previewText ?? "",
            fromName: campaign.fromName,
            fromEmail: campaign.fromEmail,
            replyTo: campaign.replyTo ?? "",
            html: campaign.html,
          }}
          lists={lists}
          selectedListIds={selectedListIds}
          recipientCount={recipients}
        />
        <aside aria-label="Review and send" className="lg:col-start-3 lg:row-start-1">
          <ReviewPanel
            campaign={campaign}
            problems={problems}
            lintIssues={lintIssues}
            recipients={recipients}
            defaultTestEmail={session.email}
          />
        </aside>
      </div>
    </EditorStateProvider>
  );
}
