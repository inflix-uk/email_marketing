import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/layout";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import type { DashboardData } from "./data";

const ROWS = [
  { key: "subscribed", label: "Subscribed", bar: "bg-emerald-500" },
  { key: "unsubscribed", label: "Unsubscribed", bar: "bg-slate-400" },
  { key: "bounced", label: "Bounced", bar: "bg-red-500" },
  { key: "complained", label: "Marked as spam", bar: "bg-red-700" },
] as const;

/** Contact breakdown by status - a quick list-health check. */
export function Audience({ contacts }: { contacts: DashboardData["contacts"] }) {
  return (
    <Card>
      <CardHeader
        title="Audience"
        actions={
          contacts.total ? (
            <ButtonLink href="/contacts" variant="ghost" size="sm">
              Manage
            </ButtonLink>
          ) : null
        }
      />
      <CardBody>
        {contacts.total === 0 ? (
          <EmptyState
            title="No contacts yet"
            description="Import a CSV from your CRM or spreadsheet, or add people one by one."
            action={
              <ButtonLink href="/contacts/import" variant="secondary" size="sm">
                Import contacts
              </ButtonLink>
            }
          />
        ) : (
          <ul className="space-y-3">
            {ROWS.map((row) => {
              const n = contacts[row.key];
              const pct = (n / contacts.total) * 100;
              return (
                <li key={row.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-600">{row.label}</span>
                    <span className="font-medium tabular-nums text-slate-900">
                      {formatNumber(n)}{" "}
                      <span className="font-normal text-slate-500">({formatPercent(n, contacts.total)})</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className={cn("h-full rounded-full", row.bar)} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
