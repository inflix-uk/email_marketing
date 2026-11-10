import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { getContact, getContactActivity, getListOptions, type ContactActivity } from "@/lib/contacts/queries";
import { phoneOf } from "@/lib/contacts/search";
import { formatDateTime } from "@/lib/utils";
import { deleteContactAction, resubscribeContactAction, unsubscribeContactAction, updateContactAction } from "../actions";
import { ConfirmDelete } from "../_components/confirm-delete";
import { ContactForm } from "../_components/contact-form";
import { SubscriptionControl } from "./subscription-control";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const contact = await getContact(id);
  return { title: contact?.email ?? "Contact not found" };
}

export default async function ContactPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { created } = await searchParams;
  const [contact, lists, activity] = await Promise.all([getContact(id), getListOptions(), getContactActivity(id, 50)]);
  if (!contact) notFound();

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const phone = phoneOf(contact.fields);
  const listNames = new Map(lists.map((l) => [l.id, l.name]));
  const memberOf = contact.listIds.flatMap((listId) => {
    const listName = listNames.get(listId);
    return listName === undefined ? [] : [{ id: listId, name: listName }];
  });
  const fieldEntries = Object.entries(contact.fields).filter(([, value]) => value !== "" && value != null);

  return (
    <>
      <PageHeader
        title={<span className="break-all">{name || contact.email}</span>}
        description={name ? <span className="break-all">{contact.email}</span> : undefined}
        back={
          <Link href="/contacts" className="text-slate-500 hover:text-slate-700">
            &larr; Contacts
          </Link>
        }
      />

      {created ? (
        <Alert tone="success" className="mb-4 max-w-2xl">
          Contact added.
        </Alert>
      ) : null}

      <div className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="min-w-0 flex-1">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              <Detail label="Email">
                <span className="break-all">{contact.email}</span>
              </Detail>
              <Detail label="Name">{name || <Empty />}</Detail>
              <Detail label="Phone">{phone ?? <Empty />}</Detail>
              <Detail label="Status">
                <StatusBadge status={contact.status} />
              </Detail>
              <Detail label="Source">{contact.source ? sourceLabel(contact.source) : <Empty />}</Detail>
              <Detail label="Lists">
                {memberOf.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {memberOf.map((l) => (
                      <Link key={l.id} href={`/lists/${l.id}`} className="hover:opacity-80">
                        <Badge tone="indigo">{l.name}</Badge>
                      </Link>
                    ))}
                  </span>
                ) : (
                  <span className="text-slate-400">Not in any list</span>
                )}
              </Detail>
              {contact.tags?.length ? (
                <Detail label="Tags">
                  <span className="flex flex-wrap gap-1.5">
                    {contact.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </span>
                </Detail>
              ) : null}
              <Detail label="Added">{formatDateTime(contact.createdAt)}</Detail>
              <Detail label="Last updated">{formatDateTime(contact.updatedAt)}</Detail>
              <Detail label="Last emailed">{formatDateTime(contact.lastEmailedAt)}</Detail>
              <Detail label="Last opened">{formatDateTime(contact.lastOpenedAt)}</Detail>
              <Detail label="Last clicked">{formatDateTime(contact.lastClickedAt)}</Detail>
              {contact.unsubscribedAt ? <Detail label="Unsubscribed">{formatDateTime(contact.unsubscribedAt)}</Detail> : null}
              {contact.bouncedAt ? (
                <Detail label="Bounced">
                  {formatDateTime(contact.bouncedAt)}
                  {contact.bounceReason ? (
                    <span className="block break-words text-xs text-slate-500">{contact.bounceReason}</span>
                  ) : null}
                </Detail>
              ) : null}
              {contact.consent ? (
                <Detail label="Consent">
                  {sourceLabel(contact.consent.source)}, {formatDateTime(contact.consent.at)}
                  {contact.consent.confirmedAt ? (
                    <span className="block text-xs text-slate-500">Confirmed {formatDateTime(contact.consent.confirmedAt)}</span>
                  ) : null}
                </Detail>
              ) : null}
            </dl>

            {fieldEntries.length ? (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">Other fields</h3>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {fieldEntries.map(([key, value]) => (
                    <Detail key={key} label={fieldLabel(key)}>
                      <span className="break-words">{String(value)}</span>
                    </Detail>
                  ))}
                </dl>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card className="w-full lg:w-72">
          <CardBody className="space-y-4">
            <SubscriptionControl
              key={contact.status}
              status={contact.status}
              unsubscribeAction={unsubscribeContactAction.bind(null, contact.id)}
              subscribeAction={resubscribeContactAction.bind(null, contact.id)}
            />
            <div className="border-t border-slate-200 pt-4">
              <ConfirmDelete
                action={deleteContactAction.bind(null, contact.id)}
                label="Delete contact"
                confirmLabel="Yes, delete"
                className="w-full"
              >
                Delete this contact? This can&apos;t be undone.
              </ConfirmDelete>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="w-full xl:max-w-xl">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Edit</h2>
          <ContactForm
            action={updateContactAction.bind(null, contact.id)}
            lists={lists}
            initial={{
              email: contact.email,
              firstName: contact.firstName,
              lastName: contact.lastName,
              listIds: contact.listIds,
            }}
            submitLabel="Save"
            pendingLabel="Saving..."
          />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Emails sent</h2>
          <ActivityTable rows={activity} />
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function Empty() {
  return <span className="text-slate-400">—</span>;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by hand",
  import: "Import",
  api: "API",
  suppression: "Suppression list",
};

function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source === "form" || source.startsWith("form:")) return "Sign-up form";
  return source;
}

/** "phone_number" -> "Phone number" */
function fieldLabel(key: string): string {
  const text = key.replace(/_+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

type Tone = "green" | "red" | "yellow" | "gray";

/** A small badge with the date as a tooltip, or a dash when it didn't happen. */
function When({ at, tone = "green", label = "Yes" }: { at: Date | null; tone?: Tone; label?: string }) {
  if (!at) return <span className="text-slate-300">—</span>;
  return (
    <span title={formatDateTime(at)}>
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

function ActivityTable({ rows }: { rows: ContactActivity[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody className="py-8 text-center text-sm text-slate-500">No campaigns sent to this contact yet.</CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <thead className="bg-slate-50">
          <tr>
            <Th>Campaign</Th>
            <Th>Sent</Th>
            <Th>Opened</Th>
            <Th>Clicked</Th>
            <Th>Bounced</Th>
            <Th>Unsubscribed</Th>
          </tr>
        </thead>
        <TBody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="max-w-xs">
                <Link
                  href={`/campaigns/${r.campaignId}`}
                  className="block truncate font-medium text-indigo-600 hover:text-indigo-500"
                >
                  {r.campaignName}
                </Link>
                {r.status !== "sent" ? (
                  <span className="mt-0.5 block">
                    <StatusBadge status={r.status} />
                  </span>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">{formatDateTime(r.sentAt)}</Td>
              <Td>
                <When at={r.openedAt} label={r.openCount > 1 ? `${r.openCount}x` : "Yes"} />
              </Td>
              <Td>
                <When at={r.clickedAt} label={r.clickCount > 1 ? `${r.clickCount}x` : "Yes"} />
              </Td>
              <Td>
                {r.bouncedAt || r.complainedAt ? (
                  <When at={r.bouncedAt ?? r.complainedAt} tone="red" label={r.bouncedAt ? "Yes" : "Spam report"} />
                ) : (
                  <When at={r.softBouncedAt} tone="yellow" label="Soft" />
                )}
              </Td>
              <Td>
                <When at={r.unsubscribedAt} tone="gray" />
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
