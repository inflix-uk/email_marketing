import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { newId } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { AutomationForm, type AutomationDefaults } from "../_components/automation-form";
import { AUTOMATION_EXAMPLES, BLANK_STEP, findExample } from "../_lib/examples";
import { firstParam, getTriggerOptions } from "../_lib/queries";

export const metadata: Metadata = { title: "New automation" };

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ example?: string | string[] }>;
}) {
  const example = findExample(firstParam((await searchParams).example));
  const [settings, options] = await Promise.all([getSettings(), getTriggerOptions()]);

  const defaults: AutomationDefaults = {
    name: example?.name ?? "",
    trigger: null,
    // Sender defaults come from Settings; they can be changed per automation.
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    steps: example
      ? example.steps.map((s) => ({ id: newId(), ...s }))
      : [{ id: newId(), delayMinutes: 0, subject: "", previewText: "", ...BLANK_STEP }],
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/automations" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Automations
          </Link>
        }
        title="New automation"
        description="Choose what starts it and write the emails. It is saved as a draft - nothing is sent until you activate it."
      />

      <nav aria-label="Starting point" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Start from:</span>
        <StartLink href="/automations/new" active={!example}>
          Blank
        </StartLink>
        {AUTOMATION_EXAMPLES.map((e) => (
          <StartLink key={e.key} href={`/automations/new?example=${e.key}`} active={example?.key === e.key}>
            {e.name}
          </StartLink>
        ))}
      </nav>

      <Alert tone="info" className="mb-6">
        Only people who join <strong>after</strong> you activate the automation are enrolled - existing contacts
        aren&apos;t emailed. Bulk imports and pasted lists don&apos;t trigger automations.
      </Alert>

      {/* The key resets the form when another starting point is chosen. */}
      <AutomationForm key={example?.key ?? "blank"} automationId={null} status={null} defaults={defaults} options={options} />
    </>
  );
}

function StartLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-indigo-600 px-3 py-1 font-medium text-white"
          : "rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
      }
    >
      {children}
    </Link>
  );
}
