"use client";

import { useFormStatus } from "react-dom";
import { EmailThumbnail } from "@/components/email-editor";

/** Submit button styled as a design card; submitting creates the template and opens it. */
export function StarterCard({ name, html }: { name: string; html: string | null }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="group flex h-full w-full flex-col overflow-hidden rounded-lg bg-white text-left shadow-sm ring-1 ring-slate-200 transition-shadow hover:ring-2 hover:ring-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-70"
    >
      {html ? (
        <EmailThumbnail html={html} className="aspect-[4/3] w-full border-b border-slate-200" />
      ) : (
        <span
          className="flex aspect-[4/3] w-full items-center justify-center border-b border-slate-200 bg-slate-50 text-slate-400 group-hover:text-indigo-600"
          aria-hidden
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="h-8 w-8">
            <path d="M10 4v12M4 10h12" />
          </svg>
        </span>
      )}
      <span className="px-3 py-2.5 text-sm font-medium text-slate-900 group-hover:text-indigo-600">
        {pending ? "Opening..." : name}
      </span>
    </button>
  );
}
