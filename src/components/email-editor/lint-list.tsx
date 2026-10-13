import type { ReactNode } from "react";
import type { LintIssue } from "@/lib/templates/lint";

// Highlights {{tags}} and <tags> in messages as code.
const CODE_RE = /(\{\{[^}]*\}\}|<\/?[a-z][^>]*>)/gi;

function formatMessage(message: string): ReactNode[] {
  return message.split(CODE_RE).map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.8em] text-slate-800">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function IssueIcon({ level }: { level: LintIssue["level"] }) {
  return level === "error" ? (
    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
        clipRule="evenodd"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden>
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The linter's findings, shown under the editor. */
export function LintList({ issues }: { issues: LintIssue[] }) {
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const summary = [errors ? plural(errors, "error") : "", warnings ? plural(warnings, "warning") : ""]
    .filter(Boolean)
    .join(", ");

  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700" aria-live="polite">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden>
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
        No problems found
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase" aria-live="polite">
        Checks: {summary}
      </p>
      <ul className="mt-2 space-y-1.5">
        {issues.map((issue) => (
          <li key={`${issue.level}:${issue.message}`} className="flex gap-2 text-sm">
            <IssueIcon level={issue.level} />
            <span className={issue.level === "error" ? "text-red-700" : "text-slate-700"}>
              <span className="sr-only">{issue.level === "error" ? "Error: " : "Warning: "}</span>
              {formatMessage(issue.message)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
