"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import type { SegmentRule } from "@/db/schema";
import type { RuleOptions, SegmentPreview } from "@/lib/segments/queries";
import { MAX_RULES } from "@/lib/segments/rules";
import { cn, formatNumber } from "@/lib/utils";
import { previewSegmentAction, type SegmentFormState } from "./actions";
import { BUILT_IN_FIELDS, draftFromRule, newDraft, ruleFromDraft, withType, type RuleDraft, type RuleType } from "./rule-drafts";

export interface SegmentFormValues {
  name: string;
  description: string;
  match: "all" | "any";
  rules: SegmentRule[];
}

const EMPTY: SegmentFormValues = { name: "", description: "", match: "all", rules: [] };

/** How long to wait after the last change before asking the server who matches. */
const PREVIEW_DELAY_MS = 350;

type Shown = { kind: "ready"; preview: SegmentPreview } | { kind: "incomplete" } | { kind: "waiting" };

/**
 * Create / edit form for a segment: name, description and the rule builder,
 * with a live preview of who matches the rules as they are right now
 * (saved or not).
 */
export function SegmentForm({
  action,
  options,
  initial = EMPTY,
  initialPreview = null,
  submitLabel,
  pendingLabel,
  cancelHref,
  notice,
  aside,
}: {
  action: (state: SegmentFormState, formData: FormData) => Promise<SegmentFormState>;
  options: RuleOptions;
  initial?: SegmentFormValues;
  /** Server-rendered preview of the saved rules, so the page is complete before the first change. */
  initialPreview?: SegmentPreview | null;
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
  /** Shown above the form until the first save attempt (e.g. "Segment created"). */
  notice?: ReactNode;
  /** Extra cards shown under the preview (e.g. delete). */
  aside?: ReactNode;
}) {
  const [state, dispatch, saving] = useActionState(action, {});
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [match, setMatch] = useState<"all" | "any">(initial.match);
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    initial.rules.map((rule, key) => draftFromRule(rule, key, options.fieldKeys)),
  );

  // Rule errors come back by position; remember which rows were submitted so
  // each message stays with its row until that row is edited or removed.
  const [submittedKeys, setSubmittedKeys] = useState<number[]>([]);
  // What was edited since the last save attempt: its error message is hidden again.
  const [touched, setTouched] = useState<(number | "name" | "description" | "match" | "rules")[]>([]);

  /** The rules as they will be sent to the server. */
  const rulesJson = useMemo(() => JSON.stringify(rules.map(ruleFromDraft)), [rules]);

  // --- Live preview -----------------------------------------------------------
  const [shown, setShown] = useState<Shown>(initialPreview ? { kind: "ready", preview: initialPreview } : { kind: "waiting" });
  const [counting, startCounting] = useTransition();
  /** The rules the preview on screen was computed for. */
  const shownFor = useRef<string | null>(initialPreview ? `${match}:${rulesJson}` : null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current; // anything still in flight is now out of date
    const key = `${match}:${rulesJson}`;
    const ruleList = JSON.parse(rulesJson) as unknown[];
    if (ruleList.length === 0 || shownFor.current === key) return;
    const timer = setTimeout(() => {
      startCounting(async () => {
        const result = await previewSegmentAction(match, ruleList).catch(() => null);
        if (requestId.current !== id || !result) return;
        shownFor.current = key;
        setShown(result.ok ? { kind: "ready", preview: result.preview } : { kind: "incomplete" });
      });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [match, rulesJson]);

  // --- Editing ----------------------------------------------------------------
  function touch(key: (typeof touched)[number]) {
    setTouched((current) => (current.includes(key) ? current : [...current, key]));
  }

  function addRule() {
    setRules((current) => [...current, newDraft(Math.max(-1, ...current.map((r) => r.key)) + 1)]);
    touch("rules");
  }

  function updateRule(key: number, patch: Partial<RuleDraft>) {
    setRules((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touch(key);
  }

  function changeType(key: number, type: RuleType) {
    setRules((current) => current.map((r) => (r.key === key ? withType(r, type) : r)));
    touch(key);
  }

  function removeRule(key: number) {
    setRules((current) => current.filter((r) => r.key !== key));
    touch("rules");
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("match", match);
    formData.set("rules", rulesJson);
    setSubmittedKeys(rules.map((r) => r.key));
    setTouched([]);
    startTransition(() => dispatch(formData));
  }

  const allErrors = state.errors ?? {};
  const errors = {
    name: touched.includes("name") ? undefined : allErrors.name,
    description: touched.includes("description") ? undefined : allErrors.description,
    match: touched.includes("match") ? undefined : allErrors.match,
    rules: touched.includes("rules") ? undefined : allErrors.rules,
  };
  function ruleError(key: number): string | undefined {
    if (touched.includes(key)) return undefined;
    const index = submittedKeys.indexOf(key);
    return index === -1 ? undefined : allErrors.ruleErrors?.[index];
  }

  const joiner = match === "any" ? "or" : "and";

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* The preview and `aside` stay outside the form: `aside` may hold its own form (delete). */}
      <form onSubmit={onSubmit} className="space-y-6 lg:col-span-3" noValidate>
        {state.error ? (
          <Alert tone="error">{state.error}</Alert>
        ) : state.ok ? (
          <Alert tone="success">Segment saved.</Alert>
        ) : notice ? (
          <Alert tone="success">{notice}</Alert>
        ) : null}

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-4">
            <Field label="Name" htmlFor="segment-name" error={errors.name}>
              <Input
                id="segment-name"
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  touch("name");
                }}
                maxLength={120}
                autoComplete="off"
                placeholder="e.g. Active subscribers"
                aria-invalid={errors.name ? true : undefined}
              />
            </Field>
            <Field
              label={
                <>
                  Description <span className="font-normal text-slate-400">(optional)</span>
                </>
              }
              htmlFor="segment-description"
              error={errors.description}
              hint="For your team - subscribers don't see it."
            >
              <Textarea
                id="segment-description"
                name="description"
                rows={2}
                maxLength={500}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  touch("description");
                }}
                placeholder="Who is in this segment and what you use it for"
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rules" description="Contacts are added and removed automatically as they start or stop matching." />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <label htmlFor="segment-match">Include contacts who match</label>
              <Select
                id="segment-match"
                name="match"
                value={match}
                onChange={(e) => {
                  setMatch(e.target.value === "any" ? "any" : "all");
                  touch("match");
                }}
                className="sm:w-auto"
              >
                <option value="all">all of these rules</option>
                <option value="any">any of these rules</option>
              </Select>
            </div>
            {errors.match ? <p className="text-xs text-red-600">{errors.match}</p> : null}

            {rules.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                No rules yet. Add a rule to choose who is in this segment.
              </p>
            ) : (
              <ol className="space-y-2">
                {rules.map((rule, index) => (
                  <li key={rule.key}>
                    {index > 0 ? (
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{joiner}</p>
                    ) : null}
                    <RuleRow
                      rule={rule}
                      index={index}
                      options={options}
                      error={ruleError(rule.key)}
                      onChange={(patch) => updateRule(rule.key, patch)}
                      onTypeChange={(type) => changeType(rule.key, type)}
                      onRemove={() => removeRule(rule.key)}
                    />
                  </li>
                ))}
              </ol>
            )}
            {errors.rules ? <p className="text-xs text-red-600">{errors.rules}</p> : null}

            <Button type="button" variant="secondary" size="sm" onClick={addRule} disabled={rules.length >= MAX_RULES}>
              + Add rule
            </Button>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? pendingLabel : submitLabel}
          </Button>
          <ButtonLink href={cancelHref} variant="ghost">
            Cancel
          </ButtonLink>
        </div>
      </form>

      <div className="space-y-6 lg:col-span-2">
        <PreviewCard shown={rules.length === 0 ? null : shown} counting={counting} />
        {aside}
      </div>
    </div>
  );
}

// --- One rule -------------------------------------------------------------------

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: "list", label: "List" },
  { value: "tag", label: "Tag" },
  { value: "field", label: "Contact detail" },
  { value: "created", label: "Date added" },
  { value: "activity", label: "Email activity" },
];

const OTHER_FIELD = "__other__";

function RuleRow({
  rule,
  index,
  options,
  error,
  onChange,
  onTypeChange,
  onRemove,
}: {
  rule: RuleDraft;
  index: number;
  options: RuleOptions;
  error?: string;
  onChange: (patch: Partial<RuleDraft>) => void;
  onTypeChange: (type: RuleType) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const narrow = "sm:w-auto";

  return (
    <div className={cn("rounded-md bg-slate-50 p-3 ring-1 ring-inset", error ? "ring-red-300" : "ring-slate-200")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          aria-label={`Rule ${n}: what it is about`}
          value={rule.type}
          onChange={(e) => onTypeChange(e.target.value as RuleType)}
          className={cn(narrow, "font-medium")}
        >
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>

        {rule.type === "list" ? (
          <>
            <Select aria-label={`Rule ${n}: condition`} value={rule.op} onChange={(e) => onChange({ op: e.target.value })} className={narrow}>
              <option value="in">is on</option>
              <option value="not_in">is not on</option>
            </Select>
            <Select
              aria-label={`Rule ${n}: list`}
              value={rule.listId}
              onChange={(e) => onChange({ listId: e.target.value })}
              className="sm:w-auto sm:max-w-64"
            >
              <option value="">{options.lists.length ? "Choose a list..." : "No lists yet"}</option>
              {rule.listId && !options.lists.some((l) => l.id === rule.listId) ? (
                <option value={rule.listId}>Deleted list</option>
              ) : null}
              {options.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {rule.type === "tag" ? (
          <>
            <Select aria-label={`Rule ${n}: condition`} value={rule.op} onChange={(e) => onChange({ op: e.target.value })} className={narrow}>
              <option value="has">has the tag</option>
              <option value="not_has">doesn&apos;t have the tag</option>
            </Select>
            {options.tags.length > 0 ? (
              <Select
                aria-label={`Rule ${n}: tag`}
                value={rule.tag}
                onChange={(e) => onChange({ tag: e.target.value })}
                className="sm:w-auto sm:max-w-64"
              >
                <option value="">Choose a tag...</option>
                {rule.tag && !options.tags.includes(rule.tag) ? <option value={rule.tag}>{rule.tag} (no longer used)</option> : null}
                {options.tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                aria-label={`Rule ${n}: tag`}
                value={rule.tag}
                onChange={(e) => onChange({ tag: e.target.value })}
                placeholder="Tag, e.g. vip"
                maxLength={100}
                autoComplete="off"
                className="sm:w-48"
              />
            )}
          </>
        ) : null}

        {rule.type === "field" ? (
          <>
            <Select
              aria-label={`Rule ${n}: field`}
              value={rule.customField ? OTHER_FIELD : rule.field}
              onChange={(e) =>
                e.target.value === OTHER_FIELD
                  ? onChange({ customField: true, field: "" })
                  : onChange({ customField: false, field: e.target.value })
              }
              className="sm:w-auto sm:max-w-56"
            >
              {BUILT_IN_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
              {options.fieldKeys.length > 0 ? (
                <optgroup label="Custom fields">
                  {options.fieldKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value={OTHER_FIELD}>Other field...</option>
            </Select>
            {rule.customField ? (
              <Input
                aria-label={`Rule ${n}: field name`}
                value={rule.field}
                onChange={(e) => onChange({ field: e.target.value })}
                placeholder="Field name, e.g. company"
                maxLength={50}
                autoComplete="off"
                className="font-mono sm:w-48"
              />
            ) : null}
            <Select aria-label={`Rule ${n}: condition`} value={rule.op} onChange={(e) => onChange({ op: e.target.value })} className={narrow}>
              <option value="equals">is</option>
              <option value="not_equals">is not</option>
              <option value="contains">contains</option>
              <option value="starts_with">starts with</option>
              <option value="exists">is filled in</option>
              <option value="not_exists">is empty</option>
            </Select>
            {rule.op === "exists" || rule.op === "not_exists" ? null : (
              <Input
                aria-label={`Rule ${n}: text`}
                value={rule.value}
                onChange={(e) => onChange({ value: e.target.value })}
                placeholder="Text"
                maxLength={200}
                autoComplete="off"
                className="sm:w-48"
              />
            )}
          </>
        ) : null}

        {rule.type === "created" ? (
          <>
            <Select aria-label={`Rule ${n}: condition`} value={rule.op} onChange={(e) => onChange({ op: e.target.value })} className={narrow}>
              <option value="in_last_days">is in the last</option>
              <option value="before">is before</option>
              <option value="after">is after</option>
            </Select>
            {rule.op === "in_last_days" ? (
              <DaysInput label={`Rule ${n}: number of days`} value={rule.days} onChange={(days) => onChange({ days })} />
            ) : (
              <Input
                aria-label={`Rule ${n}: date`}
                type="date"
                value={rule.date}
                onChange={(e) => onChange({ date: e.target.value })}
                className="sm:w-44"
              />
            )}
          </>
        ) : null}

        {rule.type === "activity" ? (
          <>
            <Select
              aria-label={`Rule ${n}: what the contact did`}
              value={rule.activity}
              onChange={(e) => onChange({ activity: e.target.value })}
              className={narrow}
            >
              <option value="opened">opened</option>
              <option value="clicked">clicked a link in</option>
              <option value="not_opened">did not open</option>
              <option value="not_clicked">did not click a link in</option>
            </Select>
            <Select aria-label={`Rule ${n}: which emails`} value={rule.scope} onChange={(e) => onChange({ scope: e.target.value })} className={narrow}>
              <option value="last_days">any email in the last</option>
              <option value="campaign">one campaign</option>
            </Select>
            {rule.scope === "campaign" ? (
              <Select
                aria-label={`Rule ${n}: campaign`}
                value={rule.campaignId}
                onChange={(e) => onChange({ campaignId: e.target.value })}
                className="sm:w-auto sm:max-w-64"
              >
                <option value="">{options.campaigns.length ? "Choose a campaign..." : "No campaigns yet"}</option>
                {rule.campaignId && !options.campaigns.some((c) => c.id === rule.campaignId) ? (
                  <option value={rule.campaignId}>Deleted campaign</option>
                ) : null}
                {options.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : (
              <DaysInput label={`Rule ${n}: number of days`} value={rule.days} onChange={(days) => onChange({ days })} />
            )}
          </>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove rule ${n}`}
          className="self-start sm:ml-auto sm:self-auto"
        >
          Remove
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {rule.type === "activity" && rule.scope === "campaign" && rule.activity.startsWith("not_") ? (
        <p className="mt-2 text-xs text-slate-500">Only people who were sent this campaign are included.</p>
      ) : null}
    </div>
  );
}

function DaysInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <span className="flex items-center gap-2">
      <Input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={1}
        max={3650}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sm:w-24"
      />
      <span className="text-sm text-slate-700">days</span>
    </span>
  );
}

// --- Preview --------------------------------------------------------------------

function PreviewCard({ shown, counting }: { shown: Shown | null; counting: boolean }) {
  const preview = shown?.kind === "ready" ? shown.preview : null;
  const others = preview ? preview.total - preview.subscribed : 0;

  return (
    <Card aria-live="polite">
      <CardHeader title="Who matches" description="Updates as you change the rules - before you save." />
      <CardBody>
        {shown === null ? (
          <p className="text-sm text-slate-500">Add a rule to see who matches.</p>
        ) : shown.kind === "incomplete" ? (
          <p className="text-sm text-slate-500">Finish filling in every rule to see who matches.</p>
        ) : preview ? (
          <div className={cn("transition-opacity", counting && "opacity-60")}>
            <p className="text-sm text-slate-700">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">{formatNumber(preview.subscribed)}</span>{" "}
              subscribed {preview.subscribed === 1 ? "contact matches" : "contacts match"}
            </p>
            {others > 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                {formatNumber(others)} more {others === 1 ? "matches" : "match"} but won&apos;t be emailed (unsubscribed, bounced or
                not confirmed).
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Counting...</p>
        )}
      </CardBody>

      {preview && preview.sample.length > 0 ? (
        <div className={cn("border-t border-slate-200 transition-opacity", counting && "opacity-60")}>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Contact</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <TBody>
              {preview.sample.map((c) => (
                <tr key={c.id}>
                  <Td className="max-w-56">
                    <Link href={`/contacts/${c.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                      {c.email}
                    </Link>
                    {c.name ? <span className="block truncate text-xs text-slate-500">{c.name}</span> : null}
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} />
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          {preview.total > preview.sample.length ? (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              Showing the first {preview.sample.length} of {formatNumber(preview.total)} matching contacts.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
