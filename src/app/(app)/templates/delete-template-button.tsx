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
}: {
  id: string;
  name: string;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => dialogRef.current?.showModal()}>
        <span className="text-red-600">Delete</span>
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
            <span className="font-medium break-words text-slate-900">{name}</span> will be deleted. Campaigns made
            from it aren&apos;t affected.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <SubmitButton variant="danger" pendingText="Deleting...">
              Delete
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
