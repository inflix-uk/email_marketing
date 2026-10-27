import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, CardBody, CardHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { collections } from "@/db";
import type { Campaign, VariantContent, VariantResult } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getVariantResults } from "@/lib/campaign-types";
import { metricRate } from "@/lib/campaign-types/ab-test";
import { describeDelay } from "@/lib/campaign-types/resend-rules";
import { getResendReport, getTemplateNames } from "@/lib/campaign-types/reports";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { can } from "@/lib/permissions";
import { formatNumber, formatPercent } from "@/lib/utils";
import { pickWinner } from "../type-actions";
import { ActionButton } from "./action-buttons";
import { LocalDateTime } from "./local-time";

// Report sections for typed campaigns, mounted once in campaign-report.tsx:
// A/B test versions, auto resend comparison, or a link back to the parent
// (an RSS series run / a resend email).

export async function CampaignTypeResults({ campaign }: { campaign: Campaign }) {
  if (campaign.parentId) return <ParentLink campaign={campaign} />;
  if (campaign.type === "ab" && campaign.variantTest) return <VariantResults campaign={campaign} />;
  if (campaign.type === "resend" && campaign.resend) return <ResendResults campaign={campaign} />;
  return null;
}

async function ParentLink({ campaign }: { campaign: Campaign }) {
  const { campaigns } = await collections();
  const parent = await campaigns.findOne({ _id: campaign.parentId! }, { projection: { name: 1, subject: 1 } });
  if (!parent) return null;
  const label = campaign.runKind === "rss" ? "Part of the RSS series" : "Resend of";
  return (
    <p className="mb-6 text-sm text-slate-600">
      {label}{" "}
      <Link href={`/campaigns/${parent._id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
        {parent.subject || parent.name}
      </Link>
    </p>
  );
}

// --- A/B test --------------------------------------------------------------------

function versionLabel(campaign: Campaign, v: VariantContent, templateNames: Map<string, string>): string {
  const test = campaign.variantTest!;
  const parts: string[] = [];
  const isA = v.key === "A";
  if (test.variable === "subject" || test.variable === "subject_content") parts.push(isA ? campaign.subject : (v.subject ?? ""));
  if (test.variable === "content" || test.variable === "subject_content") {
    const id = isA ? campaign.templateId : v.templateId;
    const starter = !isA && v.source?.startsWith("starter:") ? STARTER_TEMPLATES.find((t) => `starter:${t.key}` === v.source)?.name : null;
    parts.push((id && templateNames.get(id)) || starter || (isA ? "Main template" : "Template"));
  }
  if (test.variable === "sender") parts.push(isA ? campaign.fromName : (v.fromName ?? ""));
  return parts.filter(Boolean).join(" · ");
}

async function VariantResults({ campaign }: { campaign: Campaign }) {
  const test = campaign.variantTest!;
  const live = await getVariantResults(campaign.id, test);
  const templateNames = await getTemplateNames([campaign.templateId ?? "", ...test.variants.map((v) => v.templateId ?? "")]);
  const metricLabel = test.metric === "open" ? "opens" : "clicks";
  const canPick =
    test.mode === "sample" &&
    !test.winner &&
    (campaign.status === "sending" || campaign.status === "paused") &&
    can((await requireSession()).role, "send");

  let status: ReactNode;
  if (test.mode === "split") {
    status = "Every person got one version.";
  } else if (test.winner) {
    status = (
      <>
        Version {test.winner} won ({test.decision?.by === "manual" ? "picked by hand" : `most ${metricLabel}`}) and went to the rest.
      </>
    );
  } else if (campaign.status === "cancelled") {
    status = "Stopped before a winner was picked - the rest of the list wasn't sent.";
  } else if (test.state === "manual") {
    status = <strong className="font-semibold text-amber-800">Choose winner manually: no clear winner (a tie, or no {metricLabel} yet).</strong>;
  } else if (test.decideAt) {
    status = (
      <>
        Testing on {test.samplePercent}% - the winner by {metricLabel} is picked on <LocalDateTime value={test.decideAt.toISOString()} />.
      </>
    );
  } else {
    status = "Testing.";
  }

  const decided = new Map<string, VariantResult>((test.decision?.results ?? []).map((r) => [r.key, r]));

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="A/B test" description={status} />
      <Table>
        <thead className="bg-slate-50">
          <tr>
            <Th>Version</Th>
            <Th className="text-right">Sent</Th>
            <Th className="text-right">Opened</Th>
            <Th className="text-right">Clicked</Th>
            {test.decision ? <Th className="text-right">At decision</Th> : null}
            {canPick ? <Th className="sr-only">Pick</Th> : null}
          </tr>
        </thead>
        <TBody>
          {test.variants.map((v) => {
            const r = live.find((x) => x.key === v.key)!;
            const at = decided.get(v.key);
            return (
              <tr key={v.key}>
                <Td className="max-w-md">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-medium text-slate-900">{v.key}</span>
                    {test.winner === v.key ? <Badge tone="green">Winner</Badge> : null}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{versionLabel(campaign, v, templateNames)}</span>
                </Td>
                <Td className="text-right tabular-nums">{formatNumber(r.sent)}</Td>
                <Td className="text-right tabular-nums">{formatPercent(r.opened, r.sent)}</Td>
                <Td className="text-right tabular-nums">{formatPercent(r.clicked, r.sent)}</Td>
                {test.decision ? (
                  <Td className="text-right tabular-nums text-slate-500">
                    {at ? `${(metricRate(at, test.decision.metric) * 100).toFixed(1)}% ${test.decision.metric === "open" ? "opens" : "clicks"}` : "-"}
                  </Td>
                ) : null}
                {canPick ? (
                  <Td className="text-right">
                    <ActionButton action={pickWinner.bind(null, campaign.id, v.key)} size="sm" pendingText="Picking...">
                      Pick {v.key}
                    </ActionButton>
                  </Td>
                ) : null}
              </tr>
            );
          })}
        </TBody>
      </Table>
      {test.mode === "sample" ? (
        <CardBody className="border-t border-slate-200 text-xs text-slate-500">
          Rates count each person once. The winner is decided once; later opens and clicks don&apos;t change it.
        </CardBody>
      ) : null}
    </Card>
  );
}

// --- Auto resend --------------------------------------------------------------------

async function ResendResults({ campaign }: { campaign: Campaign }) {
  const rs = campaign.resend!;
  const report = await getResendReport(campaign.id, rs.state === "done" ? rs.childId : null);
  const who = rs.condition === "not_opened" ? "people who didn't open" : "people who didn't click";

  let status: ReactNode;
  if (rs.state === "done") {
    status = (
      <>
        Resent to {formatNumber(rs.resendCount)} {who}
        {rs.childId ? (
          <>
            {" "}
            -{" "}
            <Link href={`/campaigns/${rs.childId}`} className="font-medium text-indigo-600 hover:text-indigo-500">
              see the resend
            </Link>
          </>
        ) : null}
        .
      </>
    );
  } else if (rs.state === "skipped") {
    status = rs.note ?? "The resend wasn't needed.";
  } else if (campaign.status === "cancelled") {
    status = "Stopped - nothing will be resent.";
  } else if (rs.dueAt) {
    status = (
      <>
        Goes to {who} on <LocalDateTime value={rs.dueAt.toISOString()} /> ({describeDelay(rs.delayHours)} after the first email
        {campaign.status === "sent" ? "" : ", once it has finished sending"}).
      </>
    );
  } else {
    status = `Goes to ${who} ${describeDelay(rs.delayHours)} after the first email.`;
  }

  const rows: { label: string; sent: number; opened: number; clicked: number }[] = [
    { label: "First email", ...report.initial },
    ...(report.resend ? [{ label: "Resend", ...report.resend }] : []),
    ...(report.resend ? [{ label: "Combined (unique people)", ...report.combined }] : []),
  ];

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Auto resend" description={status} />
      <Table>
        <thead className="bg-slate-50">
          <tr>
            <Th>Email</Th>
            <Th className="text-right">Sent</Th>
            <Th className="text-right">Opened</Th>
            <Th className="text-right">Clicked</Th>
          </tr>
        </thead>
        <TBody>
          {rows.map((r) => (
            <tr key={r.label}>
              <Td className="font-medium text-slate-900">{r.label}</Td>
              <Td className="text-right tabular-nums">{formatNumber(r.sent)}</Td>
              <Td className="text-right tabular-nums">
                {formatPercent(r.opened, r.sent)} <span className="text-xs text-slate-500">({formatNumber(r.opened)})</span>
              </Td>
              <Td className="text-right tabular-nums">
                {formatPercent(r.clicked, r.sent)} <span className="text-xs text-slate-500">({formatNumber(r.clicked)})</span>
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
      <CardBody className="border-t border-slate-200 text-xs text-slate-500">
        Opens are estimates: privacy features in some email apps report or hide opens. Anyone who unsubscribed or bounced is
        never resent to.
      </CardBody>
    </Card>
  );
}
