"use client";

import Form from "next/form";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type { CampaignSort, CampaignTab } from "@/lib/campaigns/workspace";

/** Search, sort and folder filter for the campaigns list. Everything lives in the URL. */
export function WorkspaceToolbar({
  tab,
  q,
  sort,
  folder,
  folders,
  dateLabel,
}: {
  tab: CampaignTab;
  q: string;
  sort: CampaignSort;
  folder: string;
  folders: string[];
  dateLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <Form ref={formRef} action="/campaigns" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tab" value={tab} />
      <div className="w-64 max-w-full">
        <Input type="search" name="q" defaultValue={q} placeholder="Search name or subject" aria-label="Search campaigns" />
      </div>
      <div className="w-40">
        <Select name="sort" defaultValue={sort} aria-label="Sort" onChange={submit}>
          <option value="date">{dateLabel}</option>
          <option value="newest">Newest</option>
          <option value="name">Name</option>
        </Select>
      </div>
      {folders.length > 0 || folder ? (
        <div className="w-48">
          <Select name="folder" defaultValue={folder} aria-label="Folder" onChange={submit}>
            <option value="">All folders</option>
            {[...new Set([...folders, ...(folder ? [folder] : [])])].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </Form>
  );
}
