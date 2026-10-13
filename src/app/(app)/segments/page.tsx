import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { getSegmentsWithCounts } from "@/lib/segments/queries";
import { formatDate, formatNumber } from "@/lib/utils";
import { ClickableRow } from "../contacts/_components/clickable-row";

export const metadata: Metadata = { title: "Segments" };

export default async function SegmentsPage() {
  const segments = await getSegmentsWithCounts();

  return (
    <>
      <PageHeader
        title="Segments"
        description="Saved filters over your contacts. A segment updates itself - whoever matches its rules right now is in it."
        actions={<ButtonLink href="/segments/new">New segment</ButtonLink>}
      />

      {segments.length === 0 ? (
        <EmptyState
          title="No segments yet"
          description={
            <>
              Use a segment to email just the right people without keeping a list up to date by hand - for example
              &ldquo;opened an email in the last 30 days&rdquo;, &ldquo;company is Acme&rdquo; or &ldquo;on the Newsletter list
              but didn&apos;t open the last campaign&rdquo;. Then pick the segment when you send a campaign.
            </>
          }
          action={<ButtonLink href="/segments/new">Create your first segment</ButtonLink>}
        />
      ) : (
        <Card>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Name</Th>
                <Th className="hidden sm:table-cell">Rules</Th>
                <Th className="text-right">Subscribed</Th>
                <Th className="hidden md:table-cell">Updated</Th>
              </tr>
            </thead>
            <TBody>
              {segments.map((segment) => (
                <ClickableRow key={segment.id} href={`/segments/${segment.id}`}>
                  <Td className="max-w-xs">
                    <Link href={`/segments/${segment.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {segment.name}
                    </Link>
                    {segment.description ? <p className="truncate text-xs text-slate-500">{segment.description}</p> : null}
                  </Td>
                  <Td className="hidden max-w-md text-slate-600 sm:table-cell">{segment.summary}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(segment.subscribed)}</Td>
                  <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDate(segment.updatedAt)}</Td>
                </ClickableRow>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
