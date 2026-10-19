import type { Metadata } from "next";
import Link from "next/link";
import { EmailThumbnail } from "@/components/email-editor";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { collections } from "@/db";
import { fromDoc } from "@/db/schema";
import { formatDate } from "@/lib/utils";
import { StarterPicker } from "./starter-picker";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const { templates } = await collections();
  const rows = (
    await templates
      .find({}, { projection: { name: 1, html: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1, _id: 1 })
      .toArray()
  ).map(fromDoc);

  if (rows.length === 0) {
    // Nothing to list yet: go straight to choosing a design.
    return (
      <>
        <PageHeader title="Templates" description="Pick a design to create your first template." />
        <StarterPicker />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Templates" actions={<ButtonLink href="/templates/new">New template</ButtonLink>} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {rows.map((template) => (
          <li key={template.id}>
            <Link
              href={`/templates/${template.id}`}
              className="group block overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200 transition-shadow hover:ring-2 hover:ring-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <EmailThumbnail html={template.html} className="aspect-[4/3] border-b border-slate-200" />
              <div className="px-3 py-2.5">
                <p className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600">
                  {template.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">Updated {formatDate(template.updatedAt)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
