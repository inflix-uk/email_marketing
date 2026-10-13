import { randomBytes } from "node:crypto";
import { collections } from "@/db";

// App settings live in one MongoDB document ({ _id: "app" }) and are edited
// on the Settings page. Both the web app and the worker read them through
// getSettings(), cached for a few seconds, so changes apply without a restart.

export interface SmtpSettings {
  /** Empty host = dev mode: emails are written to data/outbox instead of sent. */
  host: string;
  port: number;
  /** true = TLS from the start (port 465); false = STARTTLS (port 587). */
  secure: boolean;
  user: string;
  pass: string;
}

export interface AppSettings {
  /** Public URL of this app, used in tracking + unsubscribe links. */
  appUrl: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  /** Postal address shown in email footers (required by anti-spam laws). */
  companyAddress: string;
  /** Max emails the worker sends per second. */
  sendRatePerSecond: number;
  smtp: SmtpSettings;
}

export interface SettingsDoc extends Partial<AppSettings> {
  _id: "app";
  /** Signs sessions and public links. Generated on first use. */
  authSecret?: string;
  updatedAt?: Date;
}

export const DEFAULT_SETTINGS: AppSettings = {
  appUrl: "http://localhost:3000",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  companyAddress: "",
  sendRatePerSecond: 5,
  smtp: { host: "", port: 587, secure: false, user: "", pass: "" },
};

const CACHE_MS = 5_000;
const globalForSettings = globalThis as unknown as {
  settingsCache?: { value: AppSettings; at: number };
  authSecret?: string;
};

function merge(doc: SettingsDoc | null): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stripUndefined({
      appUrl: doc?.appUrl,
      fromName: doc?.fromName,
      fromEmail: doc?.fromEmail,
      replyTo: doc?.replyTo,
      companyAddress: doc?.companyAddress,
      sendRatePerSecond: doc?.sendRatePerSecond,
    }),
    smtp: { ...DEFAULT_SETTINGS.smtp, ...stripUndefined(doc?.smtp ?? {}) },
  };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function getSettings(): Promise<AppSettings> {
  const cached = globalForSettings.settingsCache;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const { settings } = await collections();
  const value = merge(await settings.findOne({ _id: "app" }));
  globalForSettings.settingsCache = { value, at: Date.now() };
  return value;
}

export type SettingsPatch = Partial<Omit<AppSettings, "smtp">> & { smtp?: Partial<SmtpSettings> };

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "smtp" || value === undefined) continue;
    $set[key] = key === "appUrl" ? String(value).trim().replace(/\/+$/, "") : value;
  }
  for (const [key, value] of Object.entries(patch.smtp ?? {})) {
    if (value !== undefined) $set[`smtp.${key}`] = value;
  }
  const { settings } = await collections();
  await settings.updateOne({ _id: "app" }, { $set }, { upsert: true });
  invalidateSettingsCache();
  return getSettings();
}

export function invalidateSettingsCache(): void {
  globalForSettings.settingsCache = undefined;
}

/** No SMTP server configured: emails go to data/outbox. */
export function isDevMailer(settings: AppSettings): boolean {
  return !settings.smtp.host.trim();
}

/** Secret for sessions + signed links: AUTH_SECRET env if set, else generated once and stored. */
export async function getAuthSecret(): Promise<string> {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (globalForSettings.authSecret) return globalForSettings.authSecret;

  const { settings } = await collections();
  let doc = await settings.findOne({ _id: "app" }, { projection: { authSecret: 1 } });
  if (!doc?.authSecret) {
    const generated = randomBytes(32).toString("hex");
    // Only set it if nobody else did in the meantime (web app + worker race).
    await settings.updateOne(
      { _id: "app", authSecret: { $exists: false } },
      { $set: { authSecret: generated } },
      { upsert: true },
    ).catch(() => {}); // duplicate _id on a lost upsert race: the other writer won
    doc = await settings.findOne({ _id: "app" }, { projection: { authSecret: 1 } });
  }
  if (!doc?.authSecret) throw new Error("Could not create the auth secret");
  globalForSettings.authSecret = doc.authSecret;
  return doc.authSecret;
}
