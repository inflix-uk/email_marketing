import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { formatDetails, listAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity log" };

const LIMIT = 200;

/** Plain words for the actions we record; anything else is shown as stored. */
const ACTION_LABELS: Record<string, string> = {
  "campaign.send": "Sent a campaign",
  "campaign.schedule": "Scheduled a campaign",
  "campaign.unschedule": "Unscheduled a campaign",
  "campaign.pause": "Paused a campaign",
  "campaign.resume": "Resumed a campaign",
  "campaign.cancel": "Cancelled a campaign",
  "campaign.delete": "Deleted a campaign",
  "campaign.export": "Downloaded campaign recipients",
  "contacts.export": "Downloaded contacts",
  "template.delete": "Deleted a template",
  "contact.delete": "Deleted a contact",
  "contact.bulk_subscribe": "Subscribed contacts",
  "contact.bulk_unsubscribe": "Unsubscribed contacts",
  "contact.bulk_delete": "Deleted contacts",
  "contact.bulk_add_to_list": "Added contacts to a list",
  "contact.bulk_remove_from_list": "Removed contacts from a list",
  "settings.email_sending": "Changed email sending",
  "settings.sender": "Changed the sender",
  "account.update": "Changed their account",
  "team.invite": "Added someone",
  "team.new_link": "Made a new invite link",
  "team.remove": "Removed someone",
  "team.role": "Changed a role",
};

export default async function ActivityPage() {
  const session = await requireSession();
  if (!can(session.role, "audit")) redirect("/settings");
  const entries = await listAuditLog(LIMIT);

  return (
    <>
      <PageHeader
        title="Activity log"
        description={`The latest ${LIMIT} things people did.`}
        back={
          <Link href="/settings" className="text-slate-500 hover:text-slate-700">
            &larr; Settings
          </Link>
        }
      />

      {entries.length === 0 ? (
        <EmptyState title="Nothing yet" description="Sends, deletes, exports and settings changes will show up here." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <TBody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-slate-500">{formatDateTime(e.createdAt)}</Td>
                  <Td className="text-slate-900">{e.actorEmail ?? "System"}</Td>
                  <Td className="text-slate-900">{ACTION_LABELS[e.action] ?? e.action}</Td>
                  <Td className="max-w-md break-words text-xs text-slate-500">{formatDetails(e.details)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
