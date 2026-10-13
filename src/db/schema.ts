// MongoDB document shapes. Every document uses a string UUID as `_id`
// (newId()), so ids in URLs and forms are plain strings. Data-access code
// returns app objects with `id` instead of `_id` (see fromDoc).

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

// "pending" = signed up through a double opt-in form but hasn't confirmed yet (never emailed campaigns).
export const CONTACT_STATUSES = ["subscribed", "pending", "unsubscribed", "bounced", "complained"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const SEND_STATUSES = ["queued", "sending", "sent", "failed", "skipped"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

// ---------------------------------------------------------------------------
// Documents (collection name in brackets)
// ---------------------------------------------------------------------------

/** [contacts] - `email` is unique, lower-cased and trimmed. */
export interface ContactDoc {
  _id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** Free-form custom fields, e.g. { company: "Acme", city: "Leeds" }. */
  fields: Record<string, string>;
  status: ContactStatus;
  /** manual | import | api */
  source: string | null;
  /** Lists this contact belongs to (replaces a join table). */
  listIds: string[];
  unsubscribedAt: Date | null;
  // --- Optional fields: older documents may not have them (treat missing as empty/null) ---
  /** Free-form labels, lower-cased, e.g. ["vip", "webinar-2026"]. */
  tags?: string[];
  /** Where and when this person agreed to receive email. */
  consent?: ContactConsent | null;
  /** Engagement timestamps, maintained by the sender / tracking routes. */
  lastEmailedAt?: Date | null;
  lastOpenedAt?: Date | null;
  lastClickedAt?: Date | null;
  /** Set when a hard bounce / spam complaint changed the status. */
  bouncedAt?: Date | null;
  bounceReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactConsent {
  /** e.g. "form:<formId>", "import", "manual", "api" */
  source: string;
  ip?: string | null;
  at: Date;
  /** Double opt-in: when the confirmation link was clicked. */
  confirmedAt?: Date | null;
}

/** [lists] */
export interface ListDoc {
  _id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** [templates] */
export interface TemplateDoc {
  _id: string;
  name: string;
  /** Default subject suggested when a campaign is created from this template. */
  subject: string | null;
  previewText: string | null;
  html: string;
  /** Visual-editor design (JSON string). null/missing = the HTML was written by hand. */
  design?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A/B subject test: part of the audience gets subject A or B; the rest gets the winner. */
export interface AbTest {
  subjectB: string;
  /** Percent of the audience in the test (split evenly between A and B), 10-100. */
  testPercent: number;
  /** Hours to wait before picking the winner by unique open rate. */
  waitHours: number;
  winner: "A" | "B" | null;
  decidedAt: Date | null;
}

/** [campaigns] */
export interface CampaignDoc {
  _id: string;
  name: string;
  subject: string;
  previewText: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  /** Campaign's own copy of the HTML (copied from a template, then editable). */
  html: string;
  templateId: string | null;
  /** Target lists (replaces a join table). */
  listIds: string[];
  /** Target segments: audience = contacts in any list OR matching any segment. Missing = []. */
  segmentIds?: string[];
  /** Visual-editor design (JSON string) the html was generated from, if any. */
  design?: string | null;
  abTest?: AbTest | null;
  /** Why the system paused this campaign (e.g. high bounce rate). Cleared on resume. */
  pauseReason?: string | null;
  status: CampaignStatus;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Number of sends created when the campaign was queued. */
  totalRecipients: number;
  /** Internal: set while queueCampaign builds the send queue (crash-safe claim). */
  queueLockedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * [sends] One per (campaign, contact) - unique on that pair. The queue item and its tracking stats.
 * Automation emails are sends too: kind "automation", automationId set, and
 * campaignId = automationSendKey(automationId, stepId), so tracking, unsubscribe and stats work unchanged.
 */
export interface SendDoc {
  _id: string;
  campaignId: string;
  kind?: "campaign" | "automation";
  automationId?: string | null;
  /** A/B test variant; null/missing = not in the test group (receives the winning subject). */
  variant?: "A" | "B" | null;
  bouncedAt?: Date | null;
  complainedAt?: Date | null;
  contactId: string;
  /** Snapshot of the address at queue time. */
  email: string;
  status: SendStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  messageId: string | null;
  sentAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  unsubscribedAt: Date | null;
  openCount: number;
  clickCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** [clicks] One per tracked link click. */
export interface ClickDoc {
  _id: string;
  sendId: string;
  campaignId: string;
  url: string;
  createdAt: Date;
}

/** [users] Admin accounts (email unique). */
export interface UserDoc {
  _id: string;
  email: string;
  /** scrypt hash - see lib/password.ts */
  passwordHash: string;
  name?: string | null;
  /** Bumped to sign out every session of this user (password change, "sign out everywhere"). */
  sessionVersion?: number;
  resetTokenHash?: string | null;
  resetTokenExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// --- Segments ---------------------------------------------------------------

export type SegmentRule =
  | { type: "list"; op: "in" | "not_in"; listId: string }
  | { type: "tag"; op: "has" | "not_has"; tag: string }
  | {
      type: "field";
      /** "email" | "first_name" | "last_name" | a custom field key */
      field: string;
      op: "equals" | "not_equals" | "contains" | "starts_with" | "exists" | "not_exists";
      value?: string;
    }
  | { type: "created"; op: "in_last_days" | "before" | "after"; /** days, or an ISO date */ value: string }
  | {
      type: "activity";
      activity: "opened" | "clicked" | "not_opened" | "not_clicked";
      /** any email in the last N days, or one specific campaign */
      scope: "last_days" | "campaign";
      days?: number;
      campaignId?: string;
    };

/** [segments] A saved filter over contacts, evaluated live. */
export interface SegmentDoc {
  _id: string;
  name: string;
  description: string | null;
  /** "all" = every rule must match (AND); "any" = at least one (OR). */
  match: "all" | "any";
  rules: SegmentRule[];
  createdAt: Date;
  updatedAt: Date;
}

// --- Sign-up forms ------------------------------------------------------------

export interface FormField {
  /** "first_name" | "last_name" | a custom field key */
  key: string;
  label: string;
  required: boolean;
}

/** [forms] Public sign-up form (hosted page /f/<id> + embeddable POST endpoint). */
export interface FormDoc {
  _id: string;
  name: string;
  /** Lists new subscribers are added to. */
  listIds: string[];
  tags: string[];
  /** Extra fields besides email. */
  fields: FormField[];
  /** Send a confirmation email; the contact stays "pending" until the link is clicked. */
  doubleOptIn: boolean;
  title: string;
  description: string | null;
  buttonText: string;
  successMessage: string;
  redirectUrl: string | null;
  active: boolean;
  submissions: number;
  createdAt: Date;
  updatedAt: Date;
}

// --- Automations ----------------------------------------------------------------

export type AutomationTrigger =
  | { type: "list_joined"; listId: string }
  | { type: "form_submitted"; formId: string }
  | { type: "tag_added"; tag: string };

export interface AutomationStep {
  id: string;
  /** Wait this long after the trigger (step 1) or after the previous step. */
  delayMinutes: number;
  subject: string;
  previewText: string | null;
  html: string;
  design?: string | null;
}

/** [automations] An email series sent automatically after a trigger (welcome email, drip). */
export interface AutomationDoc {
  _id: string;
  name: string;
  status: "draft" | "active" | "paused";
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** [enrollments] One contact's progress through an automation (unique on the pair). */
export interface EnrollmentDoc {
  _id: string;
  automationId: string;
  contactId: string;
  /** Index of the next step to send. */
  stepIndex: number;
  nextRunAt: Date;
  status: "active" | "completed" | "stopped";
  createdAt: Date;
  updatedAt: Date;
}

/** The synthetic campaignId used on sends of one automation step. */
export function automationSendKey(automationId: string, stepId: string): string {
  return "auto:" + automationId + ":" + stepId;
}

// --- API keys & rate limiting ------------------------------------------------------

/** [apiKeys] Keys for the public REST API. Only a hash is stored. */
export interface ApiKeyDoc {
  _id: string;
  name: string;
  /** sha256 hex of the full key */
  keyHash: string;
  /** First characters, shown in the UI to tell keys apart. */
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** [rateLimits] Fixed-window counters (TTL index on expiresAt). _id is the bucket key. */
export interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// App-facing types: same fields, `id` instead of `_id`
// ---------------------------------------------------------------------------

export type WithId<T extends { _id: string }> = Omit<T, "_id"> & { id: string };

export type Contact = WithId<ContactDoc>;
export type List = WithId<ListDoc>;
export type Template = WithId<TemplateDoc>;
export type Campaign = WithId<CampaignDoc>;
export type EmailSend = WithId<SendDoc>;
export type Click = WithId<ClickDoc>;
export type Segment = WithId<SegmentDoc>;
export type Form = WithId<FormDoc>;
export type Automation = WithId<AutomationDoc>;

/** Convert a Mongo document to an app object (`_id` -> `id`). */
export function fromDoc<T extends { _id: string }>(doc: T): WithId<T> {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export function newId(): string {
  return crypto.randomUUID();
}
