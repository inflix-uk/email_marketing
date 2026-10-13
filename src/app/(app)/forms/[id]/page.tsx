import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader, Stat, StatusBadge } from "@/components/ui/layout";
import { getListOptions } from "@/lib/contacts/queries";
import { hostedFormUrl, htmlEmbedSnippet, iframeSnippet } from "@/lib/forms/snippets";
import { getForm } from "@/lib/forms/store";
import { getSettings } from "@/lib/settings";
import { formatDate, formatNumber } from "@/lib/utils";
import { ConfirmDelete } from "../../contacts/_components/confirm-delete";
import { deleteFormAction, updateFormAction } from "../actions";
import { CopyBox } from "../copy-box";
import { FormEditor } from "../form-editor";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const form = await getForm(id);
  return { title: form?.name ?? "Form not found" };
}

export default async function FormPage({ params }: Props) {
  const { id } = await params;
  const form = await getForm(id);
  if (!form) notFound();

  const [lists, settings] = await Promise.all([getListOptions(), getSettings()]);
  const appUrl = settings.appUrl.replace(/\/+$/, "");
  const link = hostedFormUrl(appUrl, form.id);

  return (
    <>
      <PageHeader
        title={form.name}
        description={
          <>
            <StatusBadge status={form.active ? "active" : "inactive"} />
            <span className="ml-2">Created {formatDate(form.createdAt)}</span>
          </>
        }
        back={
          <Link href="/forms" className="text-slate-500 hover:text-slate-700">
            &larr; Forms
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="self-start lg:col-span-2">
          <CardHeader title="Form settings" />
          <CardBody>
            <FormEditor
              action={updateFormAction.bind(null, form.id)}
              lists={lists}
              initial={{
                name: form.name,
                title: form.title,
                description: form.description ?? "",
                buttonText: form.buttonText,
                fields: form.fields,
                listIds: form.listIds,
                tags: form.tags,
                doubleOptIn: form.doubleOptIn,
                successMessage: form.successMessage,
                redirectUrl: form.redirectUrl ?? "",
                active: form.active,
              }}
              submitLabel="Save"
              pendingLabel="Saving..."
            />
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-6">
          <Stat
            label="Submissions"
            value={formatNumber(form.submissions)}
            hint={form.doubleOptIn ? "Includes people who haven't confirmed yet" : undefined}
          />

          <Card>
            <CardHeader title="Share" description="Three ways to use this form." />
            <CardBody className="space-y-5">
              {form.active ? null : <Alert tone="warning">This form is off - it won&apos;t accept sign-ups until you turn it on.</Alert>}
              <div className="space-y-1.5">
                <CopyBox label="Link" value={link} />
                <a href={link} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                  Open the form &rarr;
                </a>
              </div>
              <div className="space-y-1.5">
                <CopyBox label="HTML code" value={htmlEmbedSnippet(appUrl, form)} multiline />
                <p className="text-xs text-slate-500">Paste it into your website and style it to match. Copy it again after changing the fields.</p>
              </div>
              <div className="space-y-1.5">
                <CopyBox label="Embed (iframe)" value={iframeSnippet(appUrl, form)} />
                <p className="text-xs text-slate-500">Shows the ready-made form inside your page.</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delete form" />
            <CardBody className="space-y-3">
              <p className="text-sm text-slate-600">Contacts who signed up through this form are kept.</p>
              <ConfirmDelete action={deleteFormAction.bind(null, form.id)} label="Delete form" confirmLabel="Yes, delete form">
                Delete <strong>{form.name}</strong>? Its link and any copy of the form on your website will stop working. This
                can&apos;t be undone.
              </ConfirmDelete>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
