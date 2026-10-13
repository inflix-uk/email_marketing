// Automations: email series sent automatically after a trigger (welcome email,
// onboarding drip). Public API used by the web app (forms, contacts, lists, the
// REST API, the automation pages) and by the worker. Framework-agnostic: no
// next/* imports, so the worker can run it under tsx.
//
//   await triggerAutomations({ type: "list_joined", listId, contactIds: [id] });
//     Call AFTER the change is saved. Enrols subscribed contacts into the active
//     automations with a matching trigger. Never throws. Only for individual
//     actions (form sign-up, single contact add/edit, API) - NOT for bulk
//     imports or pasted lists.
//
//   const sent = await processDueAutomations({ limit, signal });
//     Called by the worker loop on every tick; sends the emails that are due.

export { triggerAutomations, enrollForEvent } from "./enroll";
export { processDueAutomations, ENROLLMENT_LEASE_MS } from "./process";
export {
  getEnrollmentCounts,
  getWaitingByStep,
  getStepStats,
  getAutomationsStats,
  emptyEnrollmentCounts,
  type EnrollmentCounts,
} from "./stats";
export {
  DELAY_UNITS,
  MAX_DELAY_MINUTES,
  MAX_STEPS,
  MAX_STEP_ATTEMPTS,
  delayToMinutes,
  splitDelay,
  formatDelay,
  describeStepTiming,
  runAtAfter,
  normalizeTag,
  matchesTrigger,
  describeTrigger,
  firstRunAt,
  advanceAfterStep,
  getActivationProblems,
  hasContent,
  type AutomationEvent,
  type DelayUnit,
  type Advance,
} from "./logic";
