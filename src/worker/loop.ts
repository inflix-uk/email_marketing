import { collections, DatabaseNotConfiguredError } from "@/db";
import { getSettings, isDevMailer, type AppSettings } from "@/lib/settings";
import {
  finalizeCampaigns,
  getCampaignsStats,
  processBatch,
  recoverStuckSends,
  startDueScheduledCampaigns,
} from "@/lib/sending";

const IDLE_POLL_MS = 2_000;
const ERROR_BACKOFF_MS = 5_000;
const CONFIG_BACKOFF_MS = 60_000;
const SETUP_RETRY_MS = 10_000;
const RECOVERY_INTERVAL_MS = 60_000;

export interface WorkerOptions {
  /** Abort to stop gracefully: in-flight emails finish, then the loop exits. */
  signal: AbortSignal;
  /** Exit as soon as there is nothing due (cron-style runs, tests). */
  once?: boolean;
  /** Only touch these campaigns (tests). */
  campaignIds?: string[];
  log?: (line: string) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

const short = (id: string) => id.slice(0, 8);

export function describeMailer(settings: AppSettings): string {
  if (isDevMailer(settings)) return "dev outbox (data/outbox, nothing is really sent)";
  const { host, port } = settings.smtp;
  return `smtp ${host.trim()}:${port}`;
}

function describeSettings(settings: AppSettings): string {
  return `mode: ${describeMailer(settings)}, rate ${settings.sendRatePerSecond}/s`;
}

/** The database isn't set up yet, or can't be reached. */
function setupProblem(err: unknown): string {
  if (err instanceof DatabaseNotConfiguredError) return "open /setup in the web app to connect MongoDB";
  const message = err instanceof Error ? err.message : String(err);
  return `database unreachable: ${message}`;
}

function isConnectionError(err: unknown): boolean {
  if (err instanceof DatabaseNotConfiguredError) return true;
  const name = (err as { name?: string })?.name ?? "";
  return /MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError|MongoTopologyClosedError/.test(name);
}

/**
 * Wait until the database is configured and reachable (first run: nothing is
 * set up until /setup has been completed in the web app). Returns false when
 * aborted, or in `once` mode when it isn't ready.
 */
async function waitForDatabase(opts: WorkerOptions, log: (line: string) => void): Promise<boolean> {
  let lastProblem = "";
  let lastLogAt = 0;
  while (!opts.signal.aborted) {
    try {
      await collections();
      await getSettings();
      return true;
    } catch (err) {
      const problem = setupProblem(err);
      // Retry every 10 s; say so when the reason changes, and about once a minute.
      if (problem !== lastProblem || Date.now() - lastLogAt >= 60_000) {
        log(`[worker] waiting for setup... (${problem})`);
        lastProblem = problem;
        lastLogAt = Date.now();
      }
      if (opts.once) return false;
      await sleep(SETUP_RETRY_MS, opts.signal);
    }
  }
  return false;
}

export async function runWorker(opts: WorkerOptions): Promise<void> {
  const { signal } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const scope = opts.campaignIds ? { campaignIds: opts.campaignIds } : {};

  log("[worker] starting");
  if (!(await waitForDatabase(opts, log))) {
    log("[worker] stopped");
    return;
  }

  let settingsLine = describeSettings(await getSettings());
  log(`[worker] started - ${settingsLine}`);

  let lastRecovery = 0;
  let waitingForDb = false;

  while (!signal.aborted) {
    let busy = false;
    let pause = IDLE_POLL_MS;
    try {
      // Settings are cached for 5 s, so this is cheap; log when they change.
      const current = describeSettings(await getSettings());
      if (waitingForDb) {
        log("[worker] database is back - resuming");
        waitingForDb = false;
      }
      if (current !== settingsLine) {
        settingsLine = current;
        log(`[worker] settings changed - ${settingsLine}`);
      }

      if (Date.now() - lastRecovery > RECOVERY_INTERVAL_MS) {
        lastRecovery = Date.now();
        const n = await recoverStuckSends(undefined, scope);
        if (n > 0) log(`[worker] re-queued ${n} email(s) left mid-send by a stopped worker`);
      }

      const scheduled = await startDueScheduledCampaigns(new Date(), scope);
      for (const c of scheduled.started) {
        log(`[worker] campaign "${c.name}" (${short(c.id)}): scheduled time reached - queued ${c.queued} email(s)`);
      }
      for (const c of scheduled.reverted) {
        log(`[worker] campaign "${c.name}" (${short(c.id)}): could not start, moved back to draft - ${c.reason}`);
      }
      for (const c of scheduled.errors) {
        console.error(`[worker] campaign "${c.name}" (${short(c.id)}): error while starting, will retry`, c.error);
      }

      const batch = await processBatch({ ...scope, shouldStop: () => signal.aborted });
      if (batch.campaignIds.length > 0) await logProgress(batch.campaignIds, log);

      const finished = await finalizeCampaigns(scope);
      for (const c of finished) await logFinished(c, log);

      // Only real progress skips the idle wait, so a failing database can't cause a hot loop.
      const progressed = batch.sent + batch.failed + batch.retried + batch.skipped;
      busy = progressed > 0 || scheduled.started.length > 0 || finished.length > 0;
      if (batch.errors > 0) {
        console.error("[worker] database error while sending - retrying in 5s");
        busy = false;
        pause = ERROR_BACKOFF_MS;
      }
      if (batch.configError) {
        busy = false;
        pause = CONFIG_BACKOFF_MS;
        console.error(
          "\n[worker] !!! MAIL SERVER PROBLEM - sending paused for 60s !!!\n" +
            `[worker] ${batch.configError}\n` +
            "[worker] Check the SMTP settings on the Settings page. No emails were marked as failed.\n",
        );
      }
    } catch (err) {
      busy = false;
      if (isConnectionError(err)) {
        if (!waitingForDb) log(`[worker] waiting for setup... (${setupProblem(err)})`);
        waitingForDb = true;
        pause = SETUP_RETRY_MS;
      } else {
        console.error("[worker] loop error (continuing):", err);
        pause = ERROR_BACKOFF_MS;
      }
    }

    if (busy) continue;
    if (opts.once) break;
    await sleep(pause, signal);
  }
  log("[worker] stopped");
}

async function logProgress(ids: string[], log: (line: string) => void): Promise<void> {
  const { campaigns } = await collections();
  const [rows, stats] = await Promise.all([
    campaigns.find({ _id: { $in: ids } }, { projection: { _id: 1, name: 1, totalRecipients: 1 } }).toArray(),
    getCampaignsStats(ids),
  ]);
  for (const c of rows) {
    const s = stats.get(c._id);
    if (!s) continue;
    const extra = [s.failed && `${s.failed} failed`, s.skipped && `${s.skipped} skipped`].filter(Boolean);
    log(
      `[worker] campaign "${c.name}" (${short(c._id)}): sent ${s.sent}/${c.totalRecipients || s.total}` +
        (extra.length ? ` (${extra.join(", ")})` : ""),
    );
  }
}

async function logFinished(c: { id: string; name: string }, log: (line: string) => void): Promise<void> {
  const s = (await getCampaignsStats([c.id])).get(c.id);
  log(
    `[worker] campaign "${c.name}" (${short(c.id)}): finished - ${s?.sent ?? 0} sent, ${s?.failed ?? 0} failed, ${s?.skipped ?? 0} skipped`,
  );
}
