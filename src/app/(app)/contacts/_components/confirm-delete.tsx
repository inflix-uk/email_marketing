"use client";

import { useState, type ReactNode } from "react";
import { Button, SubmitButton } from "@/components/ui/button";

/**
 * Two-step delete: the first click reveals an explanation and the real
 * submit button. `action` is a bound server action that redirects afterwards.
 */
export function ConfirmDelete({
  action,
  label,
  confirmLabel,
  children,
}: {
  action: () => Promise<void>;
  label: string;
  confirmLabel: string;
  /** What will happen - shown in the confirmation step. */
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" className="text-red-700" onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-md bg-red-50 p-4 ring-1 ring-inset ring-red-200">
      <div className="text-sm text-red-800">{children}</div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger" pendingText="Deleting..." autoFocus>
          {confirmLabel}
        </SubmitButton>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
