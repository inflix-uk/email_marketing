// Public API of the sending engine, used by the web app (campaign pages,
// dashboard, template test sends) and the worker. Framework-agnostic: no
// next/* imports, so the worker can run it under tsx.

export { CampaignError, type CampaignErrorCode } from "./errors";
export { countRecipients, countCampaignRecipients, recipientsFilter } from "./recipients";
export {
  getCampaignProblems,
  queueCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  QUEUE_LOCK_STALE_MS,
} from "./queue";
export { sendTestEmail, MAX_TEST_RECIPIENTS } from "./test-send";
export {
  getCampaignStats,
  getCampaignsStats,
  getTopLinks,
  emptyStats,
  type CampaignStats,
} from "./stats";
export {
  buildCampaignEmail,
  buildEmail,
  type BuildOptions,
  type CampaignBuildContext,
  type EmailContent,
} from "./prepare";
export {
  recordOpen,
  recordClick,
  unsubscribeBySend,
  getUnsubscribeInfo,
  maskEmail,
  isPlausibleSendId,
  type UnsubscribeResult,
  type UnsubscribeInfo,
} from "./tracking";
export {
  recoverStuckSends,
  startDueScheduledCampaigns,
  processBatch,
  finalizeCampaigns,
  Pacer,
  MAX_ATTEMPTS,
  STUCK_SEND_MS,
  type BatchResult,
  type ProcessBatchOptions,
  type ScheduledStartResult,
} from "./process";
