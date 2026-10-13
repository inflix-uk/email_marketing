import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { getRuleOptions } from "@/lib/segments/queries";
import { createSegmentAction } from "../actions";
import { SegmentForm } from "../segment-form";

export const metadata: Metadata = { title: "New segment" };

export default async function NewSegmentPage() {
  const options = await getRuleOptions();

  return (
    <>
      <PageHeader
        title="New segment"
        description="Describe who should be in it. The segment keeps itself up to date as contacts change."
        back={
          <Link href="/segments" className="text-slate-500 hover:text-slate-700">
            &larr; Segments
          </Link>
        }
      />
      <SegmentForm
        action={createSegmentAction}
        options={options}
        submitLabel="Create segment"
        pendingLabel="Creating..."
        cancelHref="/segments"
      />
    </>
  );
}
