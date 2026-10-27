import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { StarterPicker } from "../starter-picker";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage() {
  // Viewers can't create templates.
  if (!can((await requireSession()).role, "edit")) redirect("/templates");
  return (
    <>
      <PageHeader
        back={
          <Link href="/templates" className="text-slate-500 hover:text-slate-700">
            ← Templates
          </Link>
        }
        title="New template"
        description="Pick a design, or paste your own HTML."
      />
      <StarterPicker />
    </>
  );
}
