import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { INVITE_LINK_DAYS, listTeam, requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { removeTeammateAction, signOutEverywhereAction } from "./actions";
import { AddTeammateForm, TeamTable } from "./team-forms";

export const metadata: Metadata = { title: "Team" };

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  removed: { tone: "success", text: "Teammate removed. They have been signed out." },
  self: { tone: "error", text: "You can't remove your own account." },
  last: { tone: "error", text: "You can't remove the last account." },
  gone: { tone: "error", text: "That teammate was already removed." },
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ remove?: string | string[]; notice?: string | string[] }>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const team = await listTeam();

  // "Remove" is two steps: the link adds ?remove=<id>, this page then asks to confirm.
  const removeId = first(query.remove);
  const toRemove = team.length > 1 ? team.find((m) => m.id === removeId && m.email !== session.email) : undefined;
  const notice = toRemove ? undefined : NOTICES[first(query.notice) ?? ""];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Team"
        description="Everyone here can sign in and use the whole account."
        back={
          <Link href="/settings" className="text-slate-500 hover:text-slate-700">
            &larr; Settings
          </Link>
        }
      />

      <div className="space-y-6">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

        {toRemove ? (
          <form action={removeTeammateAction} className="space-y-3 rounded-md bg-red-50 p-4 ring-1 ring-inset ring-red-200">
            <input type="hidden" name="id" value={toRemove.id} />
            <p className="text-sm text-red-800">
              Remove <strong>{toRemove.email}</strong>? They will be signed out and won&apos;t be able to sign in any more.
              Contacts and campaigns are not affected.
            </p>
            <div className="flex flex-wrap gap-2">
              <SubmitButton variant="danger" pendingText="Removing...">
                Yes, remove
              </SubmitButton>
              <ButtonLink href="/settings/team" variant="secondary">
                Cancel
              </ButtonLink>
            </div>
          </form>
        ) : null}

        <Card>
          <CardHeader title="Teammates" />
          <TeamTable
            linkDays={INVITE_LINK_DAYS}
            rows={team.map((m) => ({
              id: m.id,
              email: m.email,
              name: m.name,
              added: formatDate(m.createdAt),
              pending: m.pending,
              isYou: m.email === session.email,
            }))}
          />
        </Card>

        <Card>
          <CardHeader
            title="Add teammate"
            description={`They get a link to set their own password. The link works for ${INVITE_LINK_DAYS} days.`}
          />
          <CardBody>
            <AddTeammateForm linkDays={INVITE_LINK_DAYS} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Sign out everywhere"
            description="Signs you out on every device, including this one. Use it if you lost a device or signed in on a shared computer."
          />
          <CardBody>
            <form action={signOutEverywhereAction}>
              <SubmitButton variant="secondary" pendingText="Signing out...">
                Sign out everywhere
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
