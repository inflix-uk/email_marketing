import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/layout";
import { formatNumber } from "@/lib/utils";

/** Quick links to the features that bring in and welcome new subscribers. */
export function Grow({ formCount, activeAutomationCount }: { formCount: number; activeAutomationCount: number }) {
  const links = [
    {
      href: "/forms",
      title: "Sign-up forms",
      text: "Collect subscribers from your website.",
      status: formCount ? `${formatNumber(formCount)} ${formCount === 1 ? "form" : "forms"}` : "Create one",
    },
    {
      href: "/automations",
      title: "Automations",
      text: "Send a welcome email or a series automatically.",
      status: activeAutomationCount ? `${formatNumber(activeAutomationCount)} active` : "Set one up",
    },
  ];

  return (
    <Card>
      <CardHeader title="Grow your audience" />
      <ul className="divide-y divide-slate-100">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{link.title}</span>
                <span className="block text-sm text-slate-500">{link.text}</span>
              </span>
              <span className="shrink-0 text-sm font-medium text-indigo-600">
                {link.status} <span aria-hidden>&rarr;</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
