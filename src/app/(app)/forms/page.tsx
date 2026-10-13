import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { listForms } from "@/lib/forms/store";
import { formatDate, formatNumber } from "@/lib/utils";
import { ClickableRow } from "../contacts/_components/clickable-row";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsPage() {
  const forms = await listForms();

  return (
    <>
      <PageHeader
        title="Forms"
        description="Sign-up forms for your website. Share the link or paste the code into any page."
        actions={forms.length > 0 ? <ButtonLink href="/forms/new">New form</ButtonLink> : null}
      />

      {forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description="Create a sign-up form to let people join your lists from your website."
          action={<ButtonLink href="/forms/new">Create a form</ButtonLink>}
        />
      ) : (
        <Card>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th className="hidden sm:table-cell">Opt-in</Th>
                <Th className="hidden text-right md:table-cell">Lists</Th>
                <Th className="text-right">Submissions</Th>
                <Th className="hidden md:table-cell">Created</Th>
              </tr>
            </thead>
            <TBody>
              {forms.map((form) => (
                <ClickableRow key={form.id} href={`/forms/${form.id}`}>
                  <Td className="max-w-sm">
                    <Link href={`/forms/${form.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {form.name}
                    </Link>
                    <p className="truncate text-xs text-slate-500">{form.title}</p>
                  </Td>
                  <Td>
                    <StatusBadge status={form.active ? "active" : "inactive"} />
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <Badge tone={form.doubleOptIn ? "indigo" : "gray"}>{form.doubleOptIn ? "double" : "single"}</Badge>
                  </Td>
                  <Td className="hidden text-right tabular-nums text-slate-500 md:table-cell">{formatNumber(form.listIds.length)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(form.submissions)}</Td>
                  <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDate(form.createdAt)}</Td>
                </ClickableRow>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
