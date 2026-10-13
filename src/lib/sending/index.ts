// Public API of the sending engine, used by the web app (campaign pages,
// dashboard, template test sends) and the worker. Framework-agnostic: no
// next/* imports, so the worker can run it under tsx.

export { CampaignError, type CampaignErrorCode } from "./errors";
export {
  countRecipients,
  countCampaignRecipients,
  recipientsFilter,
  audienceRecipientsFilter,
} from "./recipients";
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
  getVariantStats,
  getCampaignTimeline,
  emptyStats,
  TIMELINE_HOURS,
  type CampaignStats,
} from "./stats";
export {
  abTestSize,
  createAbAssigner,
  hasAbTest,
  pickWinner,
  subjectForVariant,
  type Variant,
} from "./ab";
export {
  recordBounce,
  recordComplaint,
  mailboxRejection,
  pauseCampaignIfBouncing,
  bounceRatePercent,
  exceedsBounceLimit,
  BOUNCE_PAUSE_MIN_SENDS,
  type AutoPause,
  type BounceInput,
  type BounceResult,
} from "./bounces";
export { remainingDailyQuota, countSentToday, quotaLeft, startOfUtcDay, utcDayKey } from "./quota";
export {
  parseWebhook,
  isWebhookProvider,
  isAmazonUrl,
  WEBHOOK_PROVIDERS,
  type FeedbackEvent,
  type ParsedWebhook,
  type WebhookProvider,
} from "./webhooks";
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
  leaveLists,
  getUnsubscribeInfo,
  maskEmail,
  isPlausibleSendId,
  isBotUserAgent,
  type UnsubscribeResult,
  type UnsubscribeInfo,
} from "./tracking";
export {
  recoverStuckSends,
  startDueScheduledCampaigns,
  processBatch,
  finalizeCampaigns,
  decideAbWinner,
  Pacer,
  MAX_ATTEMPTS,
  STUCK_SEND_MS,
  type BatchResult,
  type ProcessBatchOptions,
  type ScheduledStartResult,
} from "./process";
