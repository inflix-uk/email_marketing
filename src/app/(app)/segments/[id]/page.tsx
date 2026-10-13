import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { countCampaignsUsingSegment, getRuleNames, getRuleOptions, getSegment, previewRules } from "@/lib/segments/queries";
import { describeRules } from "@/lib/segments/summary";
import { ConfirmDelete } from "../../contacts/_components/confirm-delete";
import { deleteSegmentAction, updateSegmentAction } from "../actions";
import { SegmentForm } from "../segment-form";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const segment = await getSegment(id);
  return { title: segment?.name ?? "Segment not found" };
}

export default async function SegmentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;

  const segment = await getSegment(id);
  if (!segment) notFound();
  const [options, preview, names, campaignCount] = await Promise.all([
    getRuleOptions(),
    previewRules(segment.match, segment.rules),
    getRuleNames(segment.rules),
    countCampaignsUsingSegment(id),
  ]);

  return (
    <>
      <PageHeader
        title={segment.name}
        description={describeRules(segment.match, segment.rules, names)}
        back={
          <Link href="/segments" className="text-slate-500 hover:text-slate-700">
            &larr; Segments
          </Link>
        }
      />

      <SegmentForm
        action={updateSegmentAction.bind(null, id)}
        options={options}
        initial={{
          name: segment.name,
          description: segment.description ?? "",
          match: segment.match,
          rules: segment.rules,
        }}
        initialPreview={segment.rules.length > 0 ? preview : null}
        submitLabel="Save changes"
        pendingLabel="Saving..."
        cancelHref="/segments"
        notice={query.created ? "Segment created. Pick it as the audience when you send a campaign." : undefined}
        aside={
          <Card>
            <CardHeader title="Delete segment" />
            <CardBody className="space-y-3">
              <p className="text-sm text-slate-600">Contacts are kept - only this saved filter is removed.</p>
              <ConfirmDelete action={deleteSegmentAction.bind(null, id)} label="Delete segment" confirmLabel="Yes, delete segment">
                Delete <strong>{segment.name}</strong>? No contacts are deleted.{" "}
                {campaignCount > 0
                  ? `${campaignCount === 1 ? "1 campaign uses" : `${campaignCount} campaigns use`} this segment and will no longer include it. `
                  : null}
                This can&apos;t be undone.
              </ConfirmDelete>
            </CardBody>
          </Card>
        }
      />
    </>
  );
}
