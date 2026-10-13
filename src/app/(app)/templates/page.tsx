import type { Metadata } from "next";
import Link from "next/link";
import { EmailThumbnail } from "@/components/email-editor";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { collections } from "@/db";
import { fromDoc } from "@/db/schema";
import { formatDate } from "@/lib/utils";
import { duplicateTemplate } from "./actions";
import { DeleteTemplateButton } from "./delete-template-button";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const { templates, campaigns } = await collections();
  const [docs, usage] = await Promise.all([
    templates
      .find({}, { projection: { name: 1, subject: 1, html: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1, _id: 1 })
      .toArray(),
    campaigns
      .aggregate<{ _id: string; n: number }>([
        { $match: { templateId: { $type: "string" } } },
        { $group: { _id: "$templateId", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const rows = docs.map(fromDoc);
  const campaignCount = new Map(usage.map((u) => [u._id, u.n]));

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable email designs to start your campaigns from."
        actions={rows.length > 0 ? <ButtonLink href="/templates/new">New template</ButtonLink> : null}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Templates are reusable email designs. Start from a ready-made layout or paste in your own HTML, then use it for any campaign."
          action={<ButtonLink href="/templates/new">New template</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((template) => {
            const editHref = `/templates/${template.id}`;
            const used = campaignCount.get(template.id) ?? 0;
            return (
              <li key={template.id}>
                <Card className="flex h-full flex-col overflow-hidden">
                  {/* Redundant with the title link, so hidden from keyboard / screen readers. */}
                  <Link href={editHref} tabIndex={-1} aria-hidden className="block border-b border-slate-200">
                    <EmailThumbnail html={template.html} className="aspect-[4/3]" />
                  </Link>

                  <div className="flex-1 px-4 pt-3 pb-4">
                    <h2 className="truncate text-sm font-semibold text-slate-900">
                      <Link href={editHref} className="hover:text-indigo-600">
                        {template.name}
                      </Link>
                    </h2>
                    <p className="mt-1 truncate text-sm text-slate-500" title={template.subject ?? undefined}>
                      {template.subject || <span className="text-slate-400 italic">No default subject</span>}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Updated {formatDate(template.updatedAt)}
                      {used > 0 ? ` · Used in ${used} ${used === 1 ? "campaign" : "campaigns"}` : null}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
                    <ButtonLink href={editHref} size="sm" variant="secondary">
                      Edit
                    </ButtonLink>
                    <ButtonLink href={`/campaigns/new?templateId=${template.id}`} size="sm" variant="secondary">
                      Use in campaign
                    </ButtonLink>
                    <div className="ml-auto flex items-center">
                      <form action={duplicateTemplate}>
                        <input type="hidden" name="id" value={template.id} />
                        <SubmitButton size="sm" variant="ghost" title="Duplicate">
                          <DuplicateIcon />
                          <span className="sr-only">Duplicate {template.name}</span>
                        </SubmitButton>
                      </form>
                      <DeleteTemplateButton id={template.id} name={template.name} size="sm" variant="ghost" compact />
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function DuplicateIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7" />
    </svg>
  );
}
