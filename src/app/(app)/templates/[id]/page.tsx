import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { collections } from "@/db";
import { fromDoc } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { testSender } from "@/lib/templates/recipients";
import { formatDateTime } from "@/lib/utils";
import { duplicateTemplate } from "../actions";
import { DeleteTemplateButton } from "../delete-template-button";
import { TemplateForm } from "./template-form";

type Props = { params: Promise<{ id: string }> };

const getTemplate = cache(async (id: string) => {
  const { templates } = await collections();
  const doc = await templates.findOne({ _id: id });
  return doc ? fromDoc(doc) : undefined;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const template = await getTemplate(id);
  return { title: template?.name ?? "Template not found" };
}

export default async function TemplatePage({ params }: Props) {
  const { id } = await params;
  const [template, session, settings] = await Promise.all([getTemplate(id), requireSession(), getSettings()]);
  if (!template) notFound();

  return (
    <>
      <PageHeader
        back={
          <Link href="/templates" className="text-slate-500 hover:text-slate-700">
            ← Templates
          </Link>
        }
        title={template.name}
        description={`Last saved ${formatDateTime(template.updatedAt)}`}
        actions={
          <>
            <ButtonLink href={`/campaigns/new?templateId=${template.id}`} variant="secondary">
              Use in campaign
            </ButtonLink>
            <form action={duplicateTemplate}>
              <input type="hidden" name="id" value={template.id} />
              <SubmitButton variant="secondary" pendingText="Duplicating...">
                Duplicate
              </SubmitButton>
            </form>
            <DeleteTemplateButton id={template.id} name={template.name} />
          </>
        }
      />

      {/* Keyed so switching templates (e.g. after Duplicate) starts with fresh editor state. */}
      <TemplateForm
        key={template.id}
        template={{
          id: template.id,
          name: template.name,
          subject: template.subject,
          previewText: template.previewText,
          html: template.html,
          design: template.design ?? null,
        }}
        testRecipient={session.email}
        sender={testSender(settings)}
      />
    </>
  );
}
