// MongoDB document shapes. Every document uses a string UUID as `_id`
// (newId()), so ids in URLs and forms are plain strings. Data-access code
// returns app objects with `id` instead of `_id` (see fromDoc).

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const CONTACT_STATUSES = ["subscribed", "unsubscribed", "bounced", "complained"] as const;
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
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
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

/** [sends] One per (campaign, contact) - unique on that pair. The queue item and its tracking stats. */
export interface SendDoc {
  _id: string;
  campaignId: string;
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
  createdAt: Date;
  updatedAt: Date;
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

/** Convert a Mongo document to an app object (`_id` -> `id`). */
export function fromDoc<T extends { _id: string }>(doc: T): WithId<T> {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export function newId(): string {
  return crypto.randomUUID();
}
