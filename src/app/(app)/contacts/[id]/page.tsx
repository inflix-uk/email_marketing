import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { getContact, getContactActivity, getListOptions, getTagOptions } from "@/lib/contacts/queries";
import { formatDateTime } from "@/lib/utils";
import {
  deleteContactAction,
  resubscribeContactAction,
  unsubscribeContactAction,
  updateContactAction,
} from "../actions";
import { ConfirmDelete } from "../_components/confirm-delete";
import { ContactForm } from "../_components/contact-form";
import { SubscriptionCard } from "./subscription-card";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added manually",
  import: "CSV import",
  api: "API",
  form: "Sign-up form",
  suppression: "Suppression list",
};

/** "form:<id>" -> "Sign-up form"; unknown values are shown as they are. */
function sourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  if (source === "form" || source.startsWith("form:")) return "Sign-up form";
  return SOURCE_LABELS[source] ?? source;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right text-slate-900">{children}</dd>
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const contact = await getContact(id);
  return { title: contact?.email ?? "Contact not found" };
}

export default async function ContactPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { created } = await searchParams;
  const [contact, lists, activity, tagOptions] = await Promise.all([
    getContact(id),
    getListOptions(),
    getContactActivity(id),
    getTagOptions(),
  ]);
  if (!contact) notFound();
  const { consent } = contact;

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

  return (
    <>
      <PageHeader
        title={<span className="break-all">{name || contact.email}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {name ? <span className="break-all">{contact.email}</span> : null}
            <StatusBadge status={contact.status} />
          </span>
        }
        back={
          <Link href="/contacts" className="text-slate-500 hover:text-slate-700">
            &larr; Contacts
          </Link>
        }
      />

      {created ? (
        <Alert tone="success" className="mb-6">
          Contact added.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ContactForm
            action={updateContactAction.bind(null, contact.id)}
            lists={lists}
            initial={{
              email: contact.email,
              firstName: contact.firstName,
              lastName: contact.lastName,
              fields: contact.fields,
              listIds: contact.listIds,
              tags: contact.tags ?? [],
            }}
            knownTags={tagOptions.map((t) => t.tag)}
            submitLabel="Save changes"
            pendingLabel="Saving..."
            cancelHref="/contacts"
          />
        </div>

        <div className="space-y-6">
          <SubscriptionCard
            status={contact.status}
            unsubscribedAt={contact.unsubscribedAt}
            unsubscribeAction={unsubscribeContactAction.bind(null, contact.id)}
            resubscribeAction={resubscribeContactAction.bind(null, contact.id)}
          />

          <Card>
            <CardHeader title="About" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <Row label="Source">{sourceLabel(contact.source)}</Row>
                <Row label="Added">{formatDateTime(contact.createdAt)}</Row>
                <Row label="Last updated">{formatDateTime(contact.updatedAt)}</Row>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Consent" />
            <CardBody>
              {consent ? (
                <dl className="space-y-2 text-sm">
                  <Row label="Given via">{sourceLabel(consent.source)}</Row>
                  <Row label="Date">{formatDateTime(consent.at)}</Row>
                  {consent.confirmedAt ? <Row label="Confirmed">{formatDateTime(consent.confirmedAt)}</Row> : null}
                  {consent.ip ? <Row label="IP address">{consent.ip}</Row> : null}
                </dl>
              ) : (
                <p className="text-sm text-slate-500">No consent record for this contact.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Engagement" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <Row label="Last emailed">{formatDateTime(contact.lastEmailedAt)}</Row>
                <Row label="Last opened">{formatDateTime(contact.lastOpenedAt)}</Row>
                <Row label="Last clicked">{formatDateTime(contact.lastClickedAt)}</Row>
                {contact.bouncedAt ? <Row label="Bounced">{formatDateTime(contact.bouncedAt)}</Row> : null}
              </dl>
              {contact.bounceReason ? (
                <p className="mt-3 break-words rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-200">
                  <span className="font-medium">Bounce reason:</span> {contact.bounceReason}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delete contact" />
            <CardBody className="space-y-3">
              <p className="text-sm text-slate-600">
                Permanently removes this contact, their list memberships and their campaign history.
              </p>
              <ConfirmDelete
                action={deleteContactAction.bind(null, contact.id)}
                label="Delete contact"
                confirmLabel="Yes, delete contact"
              >
                Delete <strong className="break-all">{contact.email}</strong>? This can&apos;t be undone. To stop emailing
                someone, unsubscribe them instead - deleted contacts can be re-added by a later import.
              </ConfirmDelete>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Activity" description="Campaigns sent to this contact, newest first." />
        {activity.length === 0 ? (
          <CardBody>
            <EmptyState title="No emails yet" description="Campaigns this contact receives will show up here." />
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Campaign</Th>
                <Th>Status</Th>
                <Th>Sent</Th>
                <Th>Opened</Th>
                <Th>Clicked</Th>
              </tr>
            </thead>
            <TBody>
              {activity.map((send) => (
                <tr key={send.id}>
                  <Td>
                    <Link
                      href={`/campaigns/${send.campaignId}`}
                      className="font-medium text-slate-900 hover:text-indigo-600"
                    >
                      {send.campaignName}
                    </Link>
                    {send.status === "failed" && send.lastError ? (
                      <p className="mt-0.5 max-w-xs truncate text-xs text-red-600" title={send.lastError}>
                        {send.lastError}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={send.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-slate-500">{formatDateTime(send.sentAt)}</Td>
                  <Td className="whitespace-nowrap text-slate-500">
                    {send.openedAt ? (
                      <>
                        {formatDateTime(send.openedAt)}
                        {send.openCount > 1 ? <span className="text-xs"> ({send.openCount}×)</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-500">
                    {send.clickedAt ? (
                      <>
                        {formatDateTime(send.clickedAt)}
                        {send.clickCount > 1 ? <span className="text-xs"> ({send.clickCount}×)</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
