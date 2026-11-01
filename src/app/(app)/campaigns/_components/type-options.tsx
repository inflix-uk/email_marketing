"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/form";
import type { CampaignType } from "@/db/schema";
import type { TypeFormValues } from "@/lib/campaign-types/form";
import { cn } from "@/lib/utils";
import { previewFeed, type FeedPreview } from "../type-actions";

// The campaign-type part of the compose form (rendered inside its <form>, so
// every field below is submitted with it). All names start with "ct_".

const TYPES: { value: CampaignType; label: string; hint: string }[] = [
  { value: "regular", label: "Regular", hint: "One email to your lists." },
  { value: "ab", label: "A/B test", hint: "Try versions, send the best one." },
  { value: "resend", label: "Auto resend", hint: "Send again to people who didn't open." },
  { value: "rss", label: "RSS", hint: "Email new blog posts automatically." },
];

const KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DesignChoice {
  value: string;
  name: string;
}

export function CampaignTypeOptions({
  lockedType,
  values,
  designs,
}: {
  /** The stored type of an existing campaign (can't be changed); null on a new campaign. */
  lockedType: CampaignType | null;
  values: TypeFormValues;
  designs: DesignChoice[];
}) {
  const [type, setType] = useState<CampaignType>(lockedType ?? "regular");

  return (
    <div className="space-y-4">
      {lockedType === null ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-900">Type</legend>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {TYPES.map((t) => {
              const checked = t.value === type;
              return (
                <label
                  key={t.value}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600",
                    checked ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600" : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <input
                    type="radio"
                    name="ct_type"
                    value={t.value}
                    checked={checked}
                    onChange={() => setType(t.value)}
                    className="sr-only"
                  />
                  <span className={cn("block font-medium", checked ? "text-indigo-800" : "text-slate-900")}>{t.label}</span>
                  <span className="block text-xs text-slate-500">{t.hint}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : lockedType !== "regular" ? (
        <p className="text-sm text-slate-500">
          Type: <span className="font-medium text-slate-900">{TYPES.find((t) => t.value === lockedType)?.label}</span>
        </p>
      ) : null}

      {type === "ab" ? <AbOptions values={values.ab} designs={designs} /> : null}
      {type === "resend" ? <ResendOptions values={values.resend} designs={designs} /> : null}
      {type === "rss" ? <RssOptions values={values.rss} /> : null}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">{children}</div>;
}

function MoreOptions({ summary, children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="group rounded-md">
      <summary className="cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-500">
        More options{summary ? <span className="ml-2 font-normal text-slate-500">{summary}</span> : null}
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">{children}</div>
    </details>
  );
}

// --- A/B test -------------------------------------------------------------------

type Variable = TypeFormValues["ab"]["variable"];

function AbOptions({ values, designs }: { values: TypeFormValues["ab"]; designs: DesignChoice[] }) {
  const [variable, setVariable] = useState<Variable>(values.variable);
  const [mode, setMode] = useState(values.mode);
  const [versions, setVersions] = useState(() =>
    values.variants.slice(1).map((v) => ({ subject: v.subject, source: v.source, fromName: v.fromName })),
  );
  const usesSubject = variable === "subject" || variable === "subject_content";
  const usesContent = variable === "content" || variable === "subject_content";

  const update = (i: number, patch: Partial<(typeof versions)[number]>) =>
    setVersions((list) => list.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <Panel>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What to test" htmlFor="ct_ab_variable">
          <Select id="ct_ab_variable" name="ct_ab_variable" value={variable} onChange={(e) => setVariable(e.target.value as Variable)}>
            <option value="subject">Subject line</option>
            <option value="content">Template</option>
            <option value="sender">Sender name</option>
            <option value="subject_content">Subject and template</option>
          </Select>
        </Field>
        <Field label="How to send" htmlFor="ct_ab_mode">
          <Select id="ct_ab_mode" name="ct_ab_mode" value={mode} onChange={(e) => setMode(e.target.value === "split" ? "split" : "sample")}>
            <option value="sample">Test on a sample, then send the winner to the rest</option>
            <option value="split">Split the whole list</option>
          </Select>
        </Field>
      </div>

      <input type="hidden" name="ct_ab_count" value={versions.length + 1} />
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">Version A</span> uses the subject and template above
          {variable === "sender" ? " and the sender name from Settings" : ""}.
        </p>
        {versions.map((v, i) => {
          const key = KEYS[i + 1];
          return (
            <div key={key} className="flex flex-wrap items-end gap-3">
              <span className="mb-2 w-20 text-sm font-medium text-slate-900">Version {key}</span>
              {usesSubject ? (
                <div className="min-w-48 flex-1">
                  <Input
                    name={`ct_ab_subject_${key}`}
                    value={v.subject}
                    onChange={(e) => update(i, { subject: e.target.value })}
                    maxLength={300}
                    placeholder="Subject"
                    aria-label={`Subject for version ${key}`}
                  />
                </div>
              ) : null}
              {usesContent ? (
                <div className="min-w-48 flex-1">
                  <Select
                    name={`ct_ab_source_${key}`}
                    value={v.source}
                    onChange={(e) => update(i, { source: e.target.value })}
                    aria-label={`Template for version ${key}`}
                  >
                    <option value="" disabled>
                      Choose a template...
                    </option>
                    {designs.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {variable === "sender" ? (
                <div className="min-w-48 flex-1">
                  <Input
                    name={`ct_ab_from_${key}`}
                    value={v.fromName}
                    onChange={(e) => update(i, { fromName: e.target.value })}
                    maxLength={100}
                    placeholder="Sender name"
                    aria-label={`Sender name for version ${key}`}
                  />
                </div>
              ) : null}
              {versions.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setVersions((list) => list.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              ) : null}
            </div>
          );
        })}
        {versions.length + 1 < KEYS.length ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setVersions((list) => [...list, { subject: "", source: "", fromName: "" }])}
          >
            Add version
          </Button>
        ) : null}
      </div>

      {mode === "sample" ? (
        <MoreOptions summary={`Test on ${values.samplePercent}%, pick by ${values.metric === "open" ? "opens" : "clicks"} after ${values.waitHours} h`}>
          <Field label="Sample size (%)" htmlFor="ct_ab_sample" hint="Split evenly between the versions.">
            <Input id="ct_ab_sample" name="ct_ab_sample" type="number" min={5} max={90} defaultValue={values.samplePercent} />
          </Field>
          <Field label="Pick the winner by" htmlFor="ct_ab_metric">
            <Select id="ct_ab_metric" name="ct_ab_metric" defaultValue={values.metric}>
              <option value="click">Clicks</option>
              <option value="open">Opens</option>
            </Select>
          </Field>
          <Field label="Wait (hours)" htmlFor="ct_ab_wait" hint="Then the winner goes to everyone else.">
            <Input id="ct_ab_wait" name="ct_ab_wait" type="number" min={1} max={168} defaultValue={values.waitHours} />
          </Field>
        </MoreOptions>
      ) : (
        <p className="text-xs text-slate-500">Everyone gets one of the versions. There is no winner to send.</p>
      )}
    </Panel>
  );
}

// --- Auto resend ------------------------------------------------------------------

function ResendOptions({ values, designs }: { values: TypeFormValues["resend"]; designs: DesignChoice[] }) {
  return (
    <Panel>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Resend to" htmlFor="ct_rs_condition">
          <Select id="ct_rs_condition" name="ct_rs_condition" defaultValue={values.condition}>
            <option value="not_opened">People who didn&apos;t open</option>
            <option value="not_clicked">People who didn&apos;t click</option>
          </Select>
        </Field>
        <Field label="After" htmlFor="ct_rs_delay">
          <Input id="ct_rs_delay" name="ct_rs_delay" type="number" min={1} max={720} defaultValue={values.amount} />
        </Field>
        <Field label="Unit" htmlFor="ct_rs_unit">
          <Select id="ct_rs_unit" name="ct_rs_unit" defaultValue={values.unit}>
            <option value="days">Days</option>
            <option value="hours">Hours</option>
          </Select>
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        Opens are estimates: some email apps (for example with privacy protection) report an open for everyone, others
        block it. People who unsubscribe or bounce in the meantime are never emailed again.
      </p>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-500">More options</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="New subject" htmlFor="ct_rs_subject" hint="Leave empty to use the same subject.">
            <Input id="ct_rs_subject" name="ct_rs_subject" maxLength={300} defaultValue={values.subject} />
          </Field>
          <Field label="Different template" htmlFor="ct_rs_source">
            <Select id="ct_rs_source" name="ct_rs_source" defaultValue={values.source}>
              <option value="">Same email</option>
              {designs.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </details>
    </Panel>
  );
}

// --- RSS ----------------------------------------------------------------------------

function RssOptions({ values }: { values: TypeFormValues["rss"] }) {
  const [url, setUrl] = useState(values.feedUrl);
  const [frequency, setFrequency] = useState(values.frequency);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [checking, startChecking] = useTransition();

  function check() {
    startChecking(async () => setPreview(await previewFeed(url)));
  }

  return (
    <Panel>
      <Field label="Feed address" htmlFor="ct_rss_url" hint="For example https://example.com/feed">
        <div className="flex gap-2">
          <Input
            id="ct_rss_url"
            name="ct_rss_url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
          <Button type="button" variant="secondary" disabled={checking || !url.trim()} onClick={check}>
            {checking ? "Checking..." : "Check feed"}
          </Button>
        </div>
      </Field>
      {preview?.error ? <Alert tone="error">{preview.error}</Alert> : null}
      {preview?.ok ? (
        <div className="rounded-md bg-white p-3 ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-900">{preview.title || "Feed"} - newest posts</p>
          <ul className="mt-2 space-y-2">
            {preview.items?.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" className="h-12 w-16 shrink-0 rounded object-cover" />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{item.title || "Untitled post"}</span>
                  <span className="line-clamp-2 text-slate-500">{item.excerpt}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Send" htmlFor="ct_rss_frequency">
          <Select
            id="ct_rss_frequency"
            name="ct_rss_frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value === "weekly" ? "weekly" : "daily")}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </Select>
        </Field>
        {frequency === "weekly" ? (
          <Field label="On" htmlFor="ct_rss_weekday">
            <Select id="ct_rss_weekday" name="ct_rss_weekday" defaultValue={String(values.weekday)}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={String(i)}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="At (UK time)" htmlFor="ct_rss_time">
          <Input id="ct_rss_time" name="ct_rss_time" type="time" defaultValue={values.time} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        Put <code className="rounded bg-white px-1 ring-1 ring-slate-200">{"{{rss_items}}"}</code> in your template where the
        posts should go (otherwise they are added at the end). Only new posts are sent; if there are none, no email goes out.
        &quot;Send now&quot; starts the series.
      </p>
      <MoreOptions>
        <Field label="Posts per email" htmlFor="ct_rss_count">
          <Input id="ct_rss_count" name="ct_rss_count" type="number" min={1} max={20} defaultValue={values.itemCount} />
        </Field>
      </MoreOptions>
    </Panel>
  );
}
