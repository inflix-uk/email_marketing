import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { StarterPicker } from "../starter-picker";

export const metadata: Metadata = { title: "New template" };

export default function NewTemplatePage() {
  return (
    <>
      <PageHeader
        back={
          <Link href="/templates" className="text-slate-500 hover:text-slate-700">
            ← Templates
          </Link>
        }
        title="New template"
        description="Pick a design to start from."
      />
      <StarterPicker />
    </>
  );
}
