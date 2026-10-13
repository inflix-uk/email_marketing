"use client";

import { useId, useRef } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { deleteTemplate } from "./actions";

/** "Delete" button that asks for confirmation in a modal dialog. */
export function DeleteTemplateButton({
  id,
  name,
  size = "md",
  variant = "secondary",
  compact = false,
}: {
  id: string;
  name: string;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost";
  /** Icon-only trigger (for cards). */
  compact?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        title={compact ? "Delete" : undefined}
        onClick={() => dialogRef.current?.showModal()}
      >
        {compact ? (
          <>
            <TrashIcon />
            <span className="sr-only">Delete {name}</span>
          </>
        ) : (
          <span className="text-red-600">Delete</span>
        )}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-0 shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
        onClick={(event) => {
          // A click on the <dialog> itself (not the panel content) is a backdrop click.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <form action={deleteTemplate} className="p-6">
          <input type="hidden" name="id" value={id} />
          <h2 id={titleId} className="text-base font-semibold text-slate-900">
            Delete this template?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium break-words text-slate-900">{name}</span> will be permanently deleted.
            Campaigns created from it keep their own copy of the content and aren&apos;t affected.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <SubmitButton variant="danger" pendingText="Deleting...">
              Delete template
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-red-600"
      aria-hidden
    >
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5M5 5.5l.8 10.6a1.5 1.5 0 001.5 1.4h5.4a1.5 1.5 0 001.5-1.4L15 5.5M8.5 9v5M11.5 9v5" />
    </svg>
  );
}
