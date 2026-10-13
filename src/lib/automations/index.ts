// CONTRACT (stub written by the orchestrator - the automations agent replaces
// the bodies; signatures must stay exactly as they are, other areas import them).

export type AutomationEvent =
  | { type: "list_joined"; listId: string; contactIds: string[] }
  | { type: "form_submitted"; formId: string; contactIds: string[] }
  | { type: "tag_added"; tag: string; contactIds: string[] };

/**
 * Enrol contacts into the active automations whose trigger matches this event.
 * Call it AFTER the change is saved. Never throws (logs instead) - a broken
 * automation must not fail a sign-up or a contact edit.
 * Only for individual actions (form sign-up, single contact add/edit, API) -
 * NOT for bulk imports or pasted lists.
 */
export async function triggerAutomations(event: AutomationEvent): Promise<void> {
  void event;
}

/**
 * Send the automation emails that are due. Called by the worker loop on every
 * tick. Returns the number of emails sent. Must respect the daily send limit
 * and stop promptly when `signal` aborts.
 */
export async function processDueAutomations(opts?: { limit?: number; signal?: AbortSignal }): Promise<number> {
  void opts;
  return 0;
}
