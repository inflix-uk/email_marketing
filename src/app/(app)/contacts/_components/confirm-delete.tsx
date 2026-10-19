"use client";

import { useState, type ReactNode } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Two-step delete: the first click reveals a short question and the real
 * submit button. `action` is a bound server action that redirects afterwards.
 */
export function ConfirmDelete({
  action,
  label,
  confirmLabel,
  children,
  className,
}: {
  action: () => Promise<void>;
  label: string;
  confirmLabel: string;
  /** The question shown in the confirmation step. */
  children: ReactNode;
  /** Extra classes for the first ("Delete ...") button. */
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" className={cn("text-red-700", className)} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-md bg-red-50 p-3 ring-1 ring-inset ring-red-200">
      <div className="text-sm text-red-800">{children}</div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger" size="sm" pendingText="Deleting..." autoFocus>
          {confirmLabel}
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
