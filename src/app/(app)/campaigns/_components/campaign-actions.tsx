"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/form";
import { useCan } from "@/components/role-context";
import {
  archiveCampaign,
  bulkCampaigns,
  deleteCampaignInList,
  duplicateCampaign,
  moveCampaign,
  restoreCampaign,
  type ActionState,
} from "../actions";

export const BULK_FORM_ID = "campaign-bulk";

function FolderInput({ folders, defaultValue, listId }: { folders: string[]; defaultValue?: string; listId: string }) {
  return (
    <>
      <Input name="folder" defaultValue={defaultValue} maxLength={60} placeholder="Folder name" list={listId} aria-label="Folder name" />
      <datalist id={listId}>
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}

/** "More" on a campaign row: duplicate, archive / restore, move to a folder, delete. */
export function CampaignMoreMenu({
  campaignId,
  name,
  archived,
  canArchive,
  canDelete,
  folder,
  folders,
}: {
  campaignId: string;
  name: string;
  archived: boolean;
  canArchive: boolean;
  /** Drafts and finished campaigns; scheduled or sending ones must be stopped first. */
  canDelete: boolean;
  folder: string | null;
  folders: string[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const listId = useId();
  const [dupState, dupAction] = useActionState<ActionState, FormData>(() => duplicateCampaign(campaignId), {});
  const [archiveState, archiveAction] = useActionState<ActionState, FormData>(
    () => (archived ? restoreCampaign(campaignId) : archiveCampaign(campaignId)),
    {},
  );
  const [moveState, moveAction] = useActionState<ActionState, FormData>(moveCampaign.bind(null, campaignId), {});
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(() => deleteCampaignInList(campaignId), {});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mayDelete = useCan("delete") && canDelete;
  const error = dupState.error ?? archiveState.error ?? moveState.error ?? deleteState.error;

  useEffect(() => {
    if (archiveState.ok || moveState.ok || deleteState.ok) dialogRef.current?.close();
  }, [archiveState, moveState, deleteState]);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="relative z-10" onClick={() => dialogRef.current?.showModal()}>
        More
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setConfirmingDelete(false)}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-white p-0 text-left shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
      >
        <div className="space-y-4 p-6">
          <h2 id={titleId} className="truncate text-base font-semibold text-slate-900">
            {name}
          </h2>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <form action={dupAction}>
              <SubmitButton variant="secondary" pendingText="Copying...">
                Duplicate
              </SubmitButton>
            </form>
            {archived || canArchive ? (
              <form action={archiveAction}>
                <SubmitButton variant="secondary" pendingText={archived ? "Restoring..." : "Archiving..."}>
                  {archived ? "Restore" : "Archive"}
                </SubmitButton>
              </form>
            ) : null}
          </div>
          <form action={moveAction} className="space-y-1.5">
            <p className="text-sm font-medium text-slate-900">Move to folder</p>
            <div className="flex gap-2">
              <FolderInput folders={folders} defaultValue={folder ?? ""} listId={listId} />
              <SubmitButton variant="secondary" pendingText="Moving...">
                Move
              </SubmitButton>
            </div>
            <p className="text-xs text-slate-500">Leave empty to take it out of its folder.</p>
          </form>
          {mayDelete ? (
            confirmingDelete ? (
              <form action={deleteAction} className="space-y-2 rounded-md bg-red-50 p-3 ring-1 ring-inset ring-red-200">
                <p className="text-sm text-red-900">Delete this campaign? Its results are deleted too. Your contacts stay as they are.</p>
                <div className="flex gap-2">
                  <SubmitButton variant="danger" size="sm" pendingText="Deleting...">
                    Delete
                  </SubmitButton>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                    Keep it
                  </Button>
                </div>
              </form>
            ) : (
              <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            )
          ) : null}
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              Close
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function bulkBoxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="ids"][form="${BULK_FORM_ID}"]`)];
}

/** Header checkbox: select every campaign on this page. */
export function SelectAllCampaigns() {
  return (
    <input
      type="checkbox"
      data-bulk-all=""
      aria-label="Select all on this page"
      className="relative z-10 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
      onChange={(e) => {
        for (const box of bulkBoxes()) {
          box.checked = e.currentTarget.checked;
          box.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }}
    />
  );
}

/** Appears when campaigns are ticked: Duplicate / Archive (or Restore) / Move to folder / Delete. */
export function BulkBar({ archivedTab, folders }: { archivedTab: boolean; folders: string[] }) {
  const [count, setCount] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mayDelete = useCan("delete");
  const listId = useId();
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await bulkCampaigns(prev, formData);
    setConfirmingDelete(false);
    if (result.ok) {
      for (const box of bulkBoxes()) box.checked = false;
      for (const all of document.querySelectorAll<HTMLInputElement>("input[data-bulk-all]")) all.checked = false;
      setCount(0);
    }
    return result;
  }, {});

  useEffect(() => {
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.name === "ids" && target.getAttribute("form") === BULK_FORM_ID) {
        setCount(bulkBoxes().filter((b) => b.checked).length);
        setConfirmingDelete(false);
      }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, []);

  const message = state.error ? <Alert tone="error">{state.error}</Alert> : state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null;

  return (
    <form id={BULK_FORM_ID} action={formAction} className={count || message ? "mb-3 space-y-2" : "hidden"}>
      {message}
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2.5 ring-1 ring-inset ring-indigo-200">
          <span className="mr-2 text-sm font-medium text-indigo-900">{count} selected</span>
          <SubmitButton name="intent" value="duplicate" variant="secondary" size="sm" pendingText="Working...">
            Duplicate
          </SubmitButton>
          <SubmitButton name="intent" value={archivedTab ? "restore" : "archive"} variant="secondary" size="sm" pendingText="Working...">
            {archivedTab ? "Restore" : "Archive"}
          </SubmitButton>
          <span className="flex items-center gap-2">
            <span className="w-44">
              <FolderInput folders={folders} listId={listId} />
            </span>
            <SubmitButton name="intent" value="move" variant="secondary" size="sm" pendingText="Working...">
              Move to folder
            </SubmitButton>
          </span>
          {mayDelete ? (
            confirmingDelete ? (
              <span className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 ring-1 ring-inset ring-red-200">
                <span className="text-sm text-red-900">
                  Delete {count} {count === 1 ? "campaign" : "campaigns"} and their results?
                </span>
                <SubmitButton name="intent" value="delete" variant="danger" size="sm" pendingText="Deleting...">
                  Delete
                </SubmitButton>
                <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
