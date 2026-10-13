<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project: Inflix Marketing (email campaign tool)

A standalone product. Never use anything related to Udemy / Ucademy (names, branding, domains, emails, sample data).

Stack: Next.js 16 App Router + React 19 + Tailwind v4, MongoDB (official `mongodb` driver, no ORM), nodemailer, zod v4, papaparse. Background sending runs in a separate worker process (`src/worker`).

## Configuration - nothing lives in .env
- First run: `/setup` asks for the MongoDB connection string (saved to `data/config.json`, git-ignored) and creates the admin account (`users` collection).
- Everything else (SMTP, sender, company address, app URL, sending speed) is one settings document edited on `/settings`: `getSettings()` / `updateSettings()` in `src/lib/settings.ts` (5 s cache, shared by web + worker).
- Optional env overrides for servers only: `MONGODB_URI`, `AUTH_SECRET`.

## Commands
- `npm run dev` - web (port 3000) + worker. `npm run dev:web` / `npm run worker:dev` separately.
- `npm run mongo:local` - local MongoDB for development (mongodb://127.0.0.1:27017) if you don't use Atlas.
- `npm run typecheck`, `npm run lint`, `npm test` (node:test via tsx, files `src/**/*.test.ts`).
- `npm run db:seed` - demo data. `npx tsx scripts/dev-session.ts` - prints a `session=...` cookie for curl-testing logged-in pages.

## Layout
- `src/db/schema.ts` - document types (`ContactDoc`...), app types with `id` (`Contact`...), status constants, `fromDoc`, `newId`.
- `src/db/index.ts` - `collections()` (typed: contacts, lists, templates, campaigns, sends, clicks, users, settings), indexes, `isDuplicateKeyError`.
- `src/lib/` - shared helpers: `settings`, `config`, `render` (merge tags), `mailer`, `tokens` (signed public URLs; pure, take a `LinkContext` from `getLinkContext()`), `auth`/`session`/`password`, `utils`, `starter-templates`.
- `src/lib/sending/` - campaign queueing, message building, worker loop logic.
- `src/components/ui/` - UI kit (Button, ButtonLink, SubmitButton, Input, Textarea, Select, Field, Alert, PageHeader, Card, CardHeader, CardBody, Stat, EmptyState, Table/Th/Td/TBody, Badge, StatusBadge).
- `src/app/(app)/` - authenticated pages. Public: `/setup`, `/login`, `/u/[sendId]`, `/api/t/*`, `/api/unsubscribe/*`.

## Data conventions (MongoDB)
- `_id` is a string UUID (`newId()`); convert to app objects with `fromDoc` (`_id` -> `id`). Never expose ObjectIds.
- Memberships are embedded arrays: `contact.listIds`, `campaign.listIds` (no join tables). Use `$addToSet` / `$pull`.
- Always set `createdAt` / `updatedAt` (Date) yourself on insert, `updatedAt` on update.
- No multi-document transactions (must work on a standalone mongod too): use atomic single-document updates (`findOneAndUpdate` / `updateOne` with a status condition) as claims, and unique indexes + `ordered: false` inserts for idempotency.
- Counts and stats in the database (`countDocuments`, aggregation pipelines), not by loading documents into JS. Batch writes with `bulkWrite` / `insertMany` in chunks (~1000).
- Escape user input used in `$regex` (search).

## Conventions
- Next 16: `params` / `searchParams` are Promises. Middleware is `src/proxy.ts` (cookie-presence check only). Type page props explicitly.
- Server Components by default; `"use client"` only for interactivity.
- Mutations are Server Actions in an `actions.ts` next to the page: `await requireSession()` first, validate with zod, then `revalidatePath(...)`. Return state objects for `useActionState` forms.
- Emails are stored lower-cased: `normalizeEmail` / `isValidEmail` from `@/lib/utils`.
- Never re-subscribe a contact whose status is `unsubscribed`/`bounced`/`complained` as a side effect (imports, list adds). Only an explicit manual edit may do that.
- Code under `src/lib/**` and `src/db/**` also runs in the worker via tsx: don't import `server-only` or `next/*` there (except `lib/auth.ts`, `lib/setup.ts`). Scripts run as CommonJS: no top-level `await`.
