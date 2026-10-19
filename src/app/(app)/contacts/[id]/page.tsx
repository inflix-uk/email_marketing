import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { getContact, getListOptions } from "@/lib/contacts/queries";
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
  const [contact, lists] = await Promise.all([getContact(id), getListOptions()]);
  if (!contact) notFound();

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

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

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full max-w-2xl">
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
    </>
  );
}
