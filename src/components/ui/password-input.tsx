"use client";

import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./form";

/** Password field with an eye button to show or hide what's typed. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5" aria-hidden>
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 002.8 2.8" />
              <path d="M9.9 5.1A9.9 9.9 0 0112 5c5 0 9 4.5 10 7a12.5 12.5 0 01-3.2 4.3M6.6 6.6A12.6 12.6 0 002 12c1 2.5 5 7 10 7a9.8 9.8 0 005.4-1.6" />
            </>
          ) : (
            <>
              <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
