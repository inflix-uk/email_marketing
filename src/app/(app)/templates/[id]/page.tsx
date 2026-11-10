import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SubmitButton } from "@/components/ui/button";
import { collections } from "@/db";
import { fromDoc } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { contactFieldKeys } from "@/lib/contacts/queries";
import { parseCampaignParam } from "@/lib/campaigns/drafts";
import { findEditableCampaign } from "@/lib/campaigns/draft-store";
import { can } from "@/lib/permissions";
import { recentTemplateTests } from "@/lib/sending";
import { formatDateTime } from "@/lib/utils";
import { duplicateTemplate } from "../actions";
import { DeleteTemplateButton } from "../delete-template-button";
import { TemplateForm } from "./template-form";

type Props = {
  params: Promise<{ id: string }>;
  /** ?campaign= : opened from a campaign ("Edit design"); saving updates it and offers the way back. */
  searchParams: Promise<{ campaign?: string | string[] }>;
};

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

export default async function TemplatePage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const campaignId = parseCampaignParam(query.campaign);
  const [template, session, testLog, campaignDoc, fieldKeys] = await Promise.all([
    getTemplate(id),
    requireSession(),
    recentTemplateTests(id),
    campaignId ? findEditableCampaign(campaignId) : Promise.resolve(null),
    contactFieldKeys(),
  ]);
  if (!template) notFound();
  const campaign =
    campaignDoc && can(session.role, "edit")
      ? { id: campaignDoc._id, name: campaignDoc.subject.trim() || campaignDoc.name || "Untitled campaign" }
      : null;
  const tests = testLog.map((t) => ({
    id: t._id,
    to: t.to,
    subject: t.subject,
    status: t.status,
    error: t.error,
    contentHash: t.contentHash,
    when: formatDateTime(t.createdAt),
  }));

  return (
    <>
      <h1 className="sr-only">Edit template</h1>
      {campaign ? null : (
        <div className="mb-3 text-sm">
          <Link href="/templates" className="text-slate-500 hover:text-slate-700">
            ← Templates
          </Link>
        </div>
      )}

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
        campaign={campaign}
        testRecipient={session.email}
        tests={tests}
        fieldKeys={fieldKeys}
        secondaryActions={
          can(session.role, "edit") ? (
            <>
              <form action={duplicateTemplate}>
                <input type="hidden" name="id" value={template.id} />
                <SubmitButton variant="ghost" pendingText="Duplicating..." title="Make a copy of the saved version">
                  Duplicate
                </SubmitButton>
              </form>
              {can(session.role, "delete") ? (
                <DeleteTemplateButton id={template.id} name={template.name} variant="ghost" />
              ) : null}
            </>
          ) : null
        }
      />
    </>
  );
}
