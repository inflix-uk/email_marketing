import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/layout";
import { cn } from "@/lib/utils";

export interface ChecklistStep {
  label: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** "Get started" onboarding card - each step is ticked from real data. */
export function GetStarted({ steps }: { steps: ChecklistStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  const next = steps.find((s) => !s.done);

  return (
    <Card>
      <CardHeader title="Get started" description={`${done} of ${steps.length} steps complete`} />
      <div className="px-5 pt-4">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
        >
          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="space-y-1 px-3 py-3">
        {steps.map((step, i) => {
          const isNext = step === next;
          return (
            <li
              key={step.label}
              className={cn("flex gap-3 rounded-md px-2 py-2.5", isNext && "bg-indigo-50/60")}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done
                    ? "bg-emerald-100 text-emerald-700"
                    : isNext
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-500 ring-1 ring-inset ring-slate-300",
                )}
              >
                {step.done ? <CheckIcon /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", step.done ? "text-slate-500 line-through" : "text-slate-900")}>
                  {step.label}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </p>
                {!step.done ? (
                  <>
                    <p className="mt-0.5 text-sm text-slate-500">{step.description}</p>
                    <Link
                      href={step.href}
                      className="mt-1 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-600"
                    >
                      {step.cta} <span aria-hidden>&rarr;</span>
                    </Link>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
