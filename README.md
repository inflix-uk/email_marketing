# Inflix Marketing

A self-hosted email marketing tool for small teams. Keep contacts and lists in one place, design emails from ready-made templates, and send campaigns through any SMTP provider (Amazon SES, Resend, Brevo, Gmail, Mailgun...), with open/click tracking and automatic unsubscribe handling.

Everything is configured in the app: a setup screen on first run, then the **Settings** page. No `.env` file is needed.

- [Features](#features)
- [Quick start](#quick-start)
- [Getting a MongoDB Atlas connection string](#getting-a-mongodb-atlas-connection-string)
- [Settings](#settings)
- [How sending works](#how-sending-works)
- [Importing contacts (CSV)](#importing-contacts-csv)
- [Merge tags](#merge-tags)
- [Tracking and unsubscribes](#tracking-and-unsubscribes)
- [Deploying](#deploying)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

## Features

- **Contacts:** add people one at a time or import a CSV (column mapping + preview), custom fields such as company or city, CSV export. Each contact is subscribed, unsubscribed, bounced or complained.
- **Lists:** group contacts ("Newsletter", "Customers"); a contact can be in several lists.
- **Templates:** ready-made designs (newsletter, announcement, plain letter), HTML editing with a live preview, merge tags for personalisation.
- **Campaigns:** pick a template and lists, send yourself a test, then send now or schedule it. Pause, resume or cancel while it sends. Results: sent, failed, opens, clicks, unsubscribes and top links.
- **Background sending:** a worker process sends at the rate you choose and retries temporary failures. Nobody gets the same campaign twice, even if they are in several of its lists.
- **Compliance built in:** a personal unsubscribe link in every email, the one-click unsubscribe headers Gmail and Yahoo require, and your postal address in the footer. Unsubscribes are honoured immediately and never undone by an import.
- **Test mode:** until you connect an email provider, emails are saved as HTML files in `data/outbox/` instead of being sent, so you can try everything safely.

## Quick start

You need **Node.js 22 or newer** (`node --version`) and a MongoDB database - a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster is fine (see below), or run one locally with `npm run mongo:local`.

```bash
npm install
npm run dev        # web app on http://localhost:3000 + the sending worker
```

1. Open <http://localhost:3000>. The **setup screen** appears on first run.
2. **Connect your database:** paste your MongoDB connection string. It is tested, then saved to `data/config.json`.
3. **Create your admin account** (email + password).
4. Go to **Settings**: choose your email provider, enter the SMTP details, click **Test connection**, then set your sender name, email and company address. Send yourself a test email.

Optional demo data (3 templates, 2 lists, 30 contacts on `example.com`/`example.org` - addresses that can never receive mail - and a draft campaign):

```bash
npm run db:seed              # only if the database has no contacts/lists/templates/campaigns yet
npm run db:seed -- --reset   # deletes contacts, lists, templates and campaigns first (keeps your account and settings)
```

**Offline development:** `npm run mongo:local` starts a local MongoDB at `mongodb://127.0.0.1:27017` (data in `data/mongo-dev/`; the first run downloads the server, ~100 MB). Use `mongodb://127.0.0.1:27017/marketing` on the setup screen.

## Getting a MongoDB Atlas connection string

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas) and create a **free cluster** (M0). Pick a region close to where the app will run.
2. **Database Access → Add New Database User:** choose a username and a password (avoid special characters, or URL-encode them).
3. **Network Access → Add IP Address:** add your current IP for local use. For a server, add its IP, or `0.0.0.0/0` (anywhere) if its IP can change - the password still protects the database.
4. **Clusters → Connect → Drivers:** copy the connection string. Replace `<db_password>` with the user's password and add a database name after the host, for example:

   ```
   mongodb+srv://marketing:YOUR_PASSWORD@cluster0.abcde.mongodb.net/marketing?retryWrites=true&w=majority
   ```

   Without a database name the app uses `inflix_marketing`.

## Settings

Everything below is stored in the database and applies straight away - no restart, for both the web app and the worker.

| Section | What to set |
| --- | --- |
| **Email provider** | Choose a provider to pre-fill host, port and encryption, then enter the username and password. The password is never shown again (leave it blank to keep it). **Test connection** checks the values in the form without saving. **Use test mode** switches back to saving emails in `data/outbox/`. |
| **Sender** | Default From name / email and Reply-to for new campaigns, and your **company address** (shown in every email footer - required by law). |
| **Sending** | **App URL** - used in unsubscribe and tracking links; must be your public `https://` address when live. **Emails per second** (1-50) - keep it at or below your provider's limit. |
| **Send a test email** | Sends a short message with the saved settings. |
| **Account** | Change your sign-in email or password. |

Provider notes:

| Provider | Host | Port / encryption | Username / password |
| --- | --- | --- | --- |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 STARTTLS | SES *SMTP credentials* (not AWS access keys). New accounts are in the sandbox until you request production access. |
| Resend | `smtp.resend.com` | 465 SSL/TLS | `resend` / an API key |
| Brevo | `smtp-relay.brevo.com` | 587 STARTTLS | SMTP login / SMTP key (SMTP & API → SMTP) |
| Gmail / Workspace | `smtp.gmail.com` | 465 SSL/TLS | your address / an app password. Fine for testing; not meant for bulk mail. |
| Mailgun | `smtp.mailgun.org` (EU: `smtp.eu.mailgun.org`) | 587 STARTTLS | domain SMTP credentials |

**Before emailing real people:** verify your sending domain with the provider (a subdomain such as `mail.yourdomain.com` keeps marketing reputation separate), add the **SPF**, **DKIM** and **DMARC** DNS records it gives you (DMARC can start as `v=DMARC1; p=none`), and warm up gradually - a few hundred emails a day to engaged contacts, increasing over 2-4 weeks. Keep spam complaints below 0.3%. Only email people who opted in (UK GDPR / PECR).

## How sending works

```
 Web app (Next.js)          MongoDB                     Worker (src/worker)           SMTP provider
 You click "Send"  ──queue─▶ one "sends" document  ◀──poll── personalises + sends ──SMTP──▶ inboxes
 or schedule it              per recipient                  at "Emails per second"
```

1. **Queueing.** Sending a campaign creates one queue document per recipient: everyone in the chosen lists whose status is `subscribed`, each person once. Scheduled campaigns are queued by the worker when their time comes.
2. **Sending.** The worker fills in merge tags, adds tracking, the unsubscribe link and headers, and sends at up to the configured rate.
3. **Retries.** Temporary failures (timeouts, 4xx replies) are retried after 1 and 5 minutes, then marked failed. Permanent rejections (5xx, e.g. a bad address) fail straight away. If the problem is on your side (wrong password, server unreachable) the worker waits instead of using up retries.
4. **Finishing.** When every email is processed the campaign is marked **sent**; stats update live.

**The worker must be running for anything to send.** `npm run dev` and `npm start` start it alongside the web app (its log lines begin with `[worker]`). `npm run worker` runs it alone; `npm run worker -- --once` sends what's due and exits (cron-style).

## Importing contacts (CSV)

**Contacts → Import.** The file needs a header row:

```csv
email,first_name,last_name,company,city
jane.doe@example.com,Jane,Doe,Acme Ltd,Leeds
sam.patel@example.com,Sam,Patel,Patel & Co,Leicester
```

- Email, first name and last name columns are detected automatically (`Email Address`, `First Name`, `Surname`...; a single `Name` column is split).
- Every other column becomes a custom field in lower case with underscores (`Company Name` → `{{company_name}}`). You can change or ignore any column in the preview.
- Comma, semicolon or tab separated, UTF-8 ("CSV UTF-8" in Excel). Up to 8 MB or 100,000 rows.
- Invalid and duplicate rows are reported and skipped; emails are stored in lower case.
- **Existing contacts are never re-subscribed.** With "update existing", names and fields are filled in; empty cells never wipe data.

## Merge tags

Use them in the subject, preview text and body.

| Tag | Becomes |
| --- | --- |
| `{{first_name}}`, `{{last_name}}`, `{{full_name}}`, `{{email}}` | The contact's details |
| `{{first_name \| there}}` | A fallback after `\|` when the value is empty: "Hi Jane" or "Hi there" |
| `{{company}}` or `{{fields.company}}` | A custom field |
| `{{unsubscribe_url}}` | The contact's personal unsubscribe link |
| `{{company_address}}` | Your company address from Settings → Sender |

Tags are not case-sensitive, values are HTML-escaped, and unknown tags render empty (or their fallback). If a template has no `{{unsubscribe_url}}`, a footer with an unsubscribe link and your address is added automatically.

## Tracking and unsubscribes

- **Opens** use a tiny image - treat them as approximate (Apple Mail pre-loads images; some people block them). **Clicks** go through a signed redirect, so they are more reliable and can't be abused as an open redirect.
- **Unsubscribes:** every email has a personal link (`/u/…`) plus `List-Unsubscribe` / `List-Unsubscribe-Post` headers ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)), so Gmail, Yahoo and Apple Mail show their own button. The contact is marked unsubscribed immediately and skipped by all future campaigns.
- All these links use the **App URL** from Settings → Sending. Emails already sent keep the links they were sent with.

Dashboard rates are unique opens and clicks divided by emails sent, across campaigns sent in the last 30 days.

## Deploying

The app needs a **long-running Node.js process** (web app + worker), a **MongoDB database** (Atlas works well) and a **public HTTPS address**. A small Linux VPS is ideal (Hetzner, DigitalOcean, AWS Lightsail; 1 GB RAM is plenty). Serverless hosts such as Vercel can't keep the worker running.

```bash
git clone <your-repo-url> inflix-marketing && cd inflix-marketing
npm ci
npm run build
npm start          # web app on port 3000 + the worker
```

Then open the site, complete the setup screen, and in **Settings → Sending** set the **App URL** to your public `https://` address.

Keep it running with **pm2** (`npm install -g pm2 && pm2 start npm --name inflix-marketing -- start && pm2 save && pm2 startup`) or a systemd service (`ExecStart=/usr/bin/npm start`, `WorkingDirectory=` the app folder, `Restart=always`). Put an HTTPS reverse proxy in front - with [Caddy](https://caddyserver.com) the whole config is:

```
mail.yourdomain.com {
    reverse_proxy localhost:3000
}
```

**Optional environment variables** (for servers; set them in the service environment):

| Variable | Effect |
| --- | --- |
| `MONGODB_URI` | Connection string, overrides `data/config.json` (the setup screen then skips the database step). |
| `AUTH_SECRET` | Secret that signs logins and unsubscribe/tracking links. Without it one is generated and stored in the database. Changing it signs everyone out and breaks links in emails already sent. |

**To update:** `git pull && npm ci && npm run build`, then restart. **Backups:** use Atlas backups or `mongodump`. Run only one worker per database.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app (http://localhost:3000) + worker, with auto-reload |
| `npm run dev:web` / `npm run worker:dev` | Only the web app / only the worker |
| `npm run build` / `npm start` | Production build / production web app + worker |
| `npm run worker` | Worker only; add `-- --once` to send what's due and exit |
| `npm run db:seed` | Demo data into an empty database (`-- --reset` deletes contacts, lists, templates and campaigns first) |
| `npm run mongo:local` | Local MongoDB for offline development |
| `npm test` | Unit tests (`src/**/*.test.ts`, Node's test runner) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

## Project structure

```
src/
  app/
    setup/            First-run screen (database + admin account)
    login/            Sign-in
    (app)/            Signed-in pages: dashboard, campaigns, contacts, lists, templates, settings
    u/                Public unsubscribe pages
    api/t/, api/unsubscribe/   Tracking and one-click unsubscribe endpoints (public)
  components/         UI kit, sidebar, email editor
  db/                 MongoDB collections + document types, demo data (seed.ts)
  lib/
    config.ts         Where the database is (data/config.json or MONGODB_URI)
    settings.ts       App settings stored in MongoDB (edited on /settings)
    mailer.ts         SMTP sending / test-mode outbox
    render.ts         Merge tags
    tokens.ts         Signed unsubscribe and tracking links
    sending/          Queueing, message building, stats, worker send loop
    contacts/, templates/   CSV import/export, template helpers
  worker/             The background sending process
  proxy.ts            Login protection for non-public paths
data/                 config.json, outbox/ (test mode), mongo-dev/ - not committed
```

Developer conventions are in [AGENTS.md](AGENTS.md).

## Troubleshooting

- **Nothing is being sent.** Is the worker running (`[worker]` log lines)? Is the yellow **Test mode** banner showing? Then emails go to `data/outbox/` - connect a provider in Settings.
- **Can't connect to MongoDB.** Check the password in the connection string and that your IP is allowed in Atlas → Network Access.
- **Test connection times out.** Check host and port; some networks block outgoing SMTP ports - try 587 or 465.
- **Authentication failed (535).** Check the username and password. For SES use the SMTP credentials, not AWS keys.
- **Port 465 vs 587.** 465 needs *SSL/TLS*, 587 needs *STARTTLS*.
- **Emails go to spam.** Check SPF, DKIM and DMARC (Gmail → ⋮ → Show original), send from your verified domain, warm up slowly.
- **Links point to localhost.** Set the App URL in Settings → Sending to your public https address.

## Roadmap

- **Segments** by field values, engagement or signup date, not just lists.
- **Automations:** welcome series and drip sequences.
- **A/B tests** of subject lines and content.
- **Multiple users** with roles.
- **Bounce and complaint webhooks** (SES/SNS, Resend, Brevo) to update contacts automatically.
- **Signup forms** with double opt-in.
