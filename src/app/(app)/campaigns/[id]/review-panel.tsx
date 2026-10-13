import type { Campaign } from "@/db/schema";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import type { LintIssue } from "@/lib/templates/lint";
import { formatNumber } from "@/lib/utils";
import { scheduleCampaign, sendNow, sendTest } from "../actions";
import { UnsavedChangesNotice } from "./editor-state";
import { ScheduleForm, SendNowButton, SendTestForm } from "./send-controls";

/** Point each blocking problem at the part of the page that fixes it. */
function fixFor(problem: string): { href: string; label: string } | null {
  const p = problem.toLowerCase();
  if (p.includes("subject b") || p.includes("a/b")) return { href: "#abSubjectB", label: "Edit A/B test" };
  if (p.includes("subject")) return { href: "#subject", label: "Edit subject" };
  if (p.includes("unsubscribe")) return { href: "#content", label: "Edit content" };
  if (p.includes("smtp") || p.includes("company address") || p.includes("postal")) {
    return { href: "/settings", label: "Open settings" };
  }
  if (p.includes("reply")) return { href: "#replyTo", label: "Edit reply-to" };
  if (p.includes("from") || p.includes("sender")) return { href: "#sender", label: "Edit sender" };
  if (
    p.includes("list") ||
    p.includes("segment") ||
    p.includes("recipient") ||
    p.includes("audience") ||
    p.includes("contact")
  ) {
    return { href: "#audience", label: "Choose audience" };
  }
  if (p.includes("content") || p.includes("html") || p.includes("body") || p.includes("empty")) {
    return { href: "#content", label: "Edit content" };
  }
  return null;
}

export function ReviewPanel({
  campaign,
  problems,
  lintIssues,
  recipients,
  defaultTestEmail,
}: {
  campaign: Campaign;
  problems: string[];
  lintIssues: LintIssue[];
  recipients: number;
  defaultTestEmail: string;
}) {
  const ready = problems.length === 0;
  const scheduledAt = campaign.status === "scheduled" && campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null;

  return (
    <Card>
      <CardHeader
        title="Review & send"
        description={ready ? "Everything needed to send is in place." : "A few things need fixing before you can send."}
      />
      <CardBody className="space-y-6">
        <section aria-labelledby="checklist-heading" className="space-y-3">
          <h3 id="checklist-heading" className="text-sm font-medium text-slate-900">
            Checklist
          </h3>
          {ready ? (
            <p className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Ready to send to <strong className="font-semibold">{formatNumber(recipients)}</strong>{" "}
                {recipients === 1 ? "recipient" : "recipients"}.
              </span>
            </p>
          ) : (
            <ul className="space-y-2.5">
              {problems.map((problem) => {
                const fix = fixFor(problem);
                return (
                  <li key={problem} className="flex items-start gap-2 text-sm">
                    <CrossIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <p className="text-slate-700">{problem}</p>
                      {fix ? (
                        <a href={fix.href} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                          {fix.label} &rarr;
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <UnsavedChangesNotice />
        </section>

        {lintIssues.length ? (
          <section aria-labelledby="lint-heading" className="space-y-3">
            <h3 id="lint-heading" className="text-sm font-medium text-slate-900">
              Content suggestions
            </h3>
            <ul className="space-y-2">
              {lintIssues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <WarningIcon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${issue.level === "error" ? "text-red-500" : "text-amber-500"}`}
                  />
                  <span>
                    <span className="sr-only">{issue.level === "error" ? "Error: " : "Warning: "}</span>
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-slate-200 pt-5">
          <SendTestForm action={sendTest.bind(null, campaign.id)} defaultTo={defaultTestEmail} />
        </section>

        <section className="space-y-5 border-t border-slate-200 pt-5">
          <SendNowButton action={sendNow.bind(null, campaign.id)} recipients={recipients} blocked={!ready} />
          <ScheduleForm action={scheduleCampaign.bind(null, campaign.id)} scheduledAt={scheduledAt} blocked={!ready} />
        </section>
      </CardBody>
    </Card>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.58 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.7 7.3a1 1 0 00-1.4 1.4L8.58 10l-1.3 1.3a1 1 0 101.42 1.4L10 11.42l1.3 1.3a1 1 0 001.4-1.42L11.42 10l1.3-1.3a1 1 0 00-1.42-1.4L10 8.58 8.7 7.3z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        d="M8.26 3.1c.77-1.36 2.72-1.36 3.49 0l5.58 9.92c.75 1.34-.21 2.98-1.74 2.98H4.42c-1.53 0-2.5-1.64-1.74-2.98L8.26 3.1zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}
