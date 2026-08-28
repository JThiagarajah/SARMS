# SARMS — Student Academic Results and GPA Management System

University of Vavuniya, Faculty of Applied Science, Department of Physical Science
IT3162 Group Project — reference implementation

This is a working full-stack implementation of the system described in the IT3162 project
proposal: a role-based web application that manages ICA marks, final results, GPA/OGPA, and a
staged release workflow across seven account types.

## Roles implemented

1. **Student** — grades and GPA only, never a numeric mark; target-GPA planner; anonymised
   batch comparison.
2. **Lecturer** — defines ICA instruments, enters/edits ICA marks and releases each ICA grade at
   their own discretion, enters ESE marks and submits a course's final marks. All editing rights
   for a course are revoked the instant its final marks are submitted.
3. **Head of Department (HOD)** — reviews, corrects, and approves a lecturer's submitted final
   marks; decides correction requests; owns curriculum & marking-scheme settings jointly with
   the Dean.
4. **Dean** — faculty oversight, strictly view-only. No edit, approve, or release action exists
   for this role anywhere in the system.
5. **Chairman, Examination Branch** — the final release gate. Releasing a course's results
   publishes them to students and simultaneously, permanently revokes the HOD's and Lecturer's
   editing rights for that course.
6. **Examination Branch** — sees results only after official release; generates official result
   sheets and certificates.
7. **Super Admin** — system/organisation administration only (departments, programmes, courses,
   offerings, enrolments, accounts). Deliberately walled off from every grade-bearing table, so
   no single account can both run the system and quietly alter a result.

The release chain is: **Lecturer submits → HOD edits/approves → Chairman of Examination Branch
releases → Dean views (no gate).**

## Architecture

```
backend/    Node.js + Express + TypeScript REST API
frontend/   React + TypeScript + Vite single-page app
```

- **Database**: **PostgreSQL**, via the `pg` driver — a real client-server database, the kind you'd
  actually deploy and trust with 1,000+ students' worth of marks. (Earlier drafts of SARMS ran on
  SQLite for zero-setup local development; the system was migrated to Postgres specifically so it
  could be deployed as a reliable, always-on service rather than a single-file local database —
  see **Deploying SARMS** below.) Every table is created with `CREATE TABLE IF NOT EXISTS`, applied
  automatically on every backend startup (`src/db/client.ts` → `initDb()`), so upgrading an existing
  installation to a newer version of SARMS never requires a manual migration step and never touches
  existing data.
- **Auth**: JWT bearer tokens, bcrypt password hashes, forced password change on first login for
  every account the Super Admin creates.
- **Grading engine**: pure, unit-tested functions in `backend/src/lib/grading.ts` — M1/M2
  ESE+ICA weighting, credit-weighted Final Result, the "lowest component grade carries forward"
  rule, ACU-specific minimum pass grades, GPA/OGPA. 31 passing tests in
  `backend/src/__tests__/grading.test.ts`.
- **Marking-scheme settings**: versioned by (department, academic year) and owned by Dean/HOD.
  Because every `Result` row stores its own computed `m1`/`m2`/`final_mark`, editing a future
  year's scheme never rewrites a result computed under a prior scheme.
- **PDF export**: generated server-side with `pdf-lib` — result sheets for Lecturer/HOD/Dean/
  Chairman/Examination Branch, and certificates for the Examination Branch.
- **Activity log**: every state-changing action across every role is recorded and visible to the
  Super Admin.
- **Bulk Excel/CSV import**: the Super Admin can create many student or staff accounts at once
  from a spreadsheet (`Accounts → Bulk import (Excel)`), and a Lecturer can upload ICA marks or a
  course's final ESE marks in bulk instead of typing them into the on-screen grid one student at a
  time. Every bulk endpoint has a matching "download template" button that produces a pre-filled
  spreadsheet (existing students/marks already in the right rows) so there's nothing to guess about
  column names. Uploads are validated and applied row-by-row — a bad row (out-of-range mark, unknown
  registration number, missing field) is reported individually without blocking the rows around it.
- **Forgot password**: a self-service "Forgot password?" link on the sign-in page, matching the
  layout of the University's existing examination portal (see.vau.ac.lk). It never confirms or
  denies whether a username exists — it only proceeds if the username **and** the personal email on
  file both match, then emails a 6-digit one-time code (15-minute expiry, single use) to that
  address. See **Email delivery (forgot password)** below for how to wire up real email.

- **My Profile**: every role has a "My Profile" page (self-service) showing their account
  details — for a Student this includes registration number, programme, level, admission year and
  department, pulled from the same tables the Super Admin manages. From here anyone can also set
  or update their own personal (recovery) email and jump to changing their password, without
  needing the Super Admin to do it for them.
- **Charts**: the Department Report's two count-based breakdowns (results by lifecycle stage,
  grade distribution) are donut charts — genuine part-to-whole compositions, so a chart type built
  for that reads better than a bar. The Student Dashboard's "GPA by level" stays a bar chart on
  purpose: GPA is a magnitude on a fixed 0–4 scale, not a share of a whole, and comparing bar
  heights across levels stays legible in a way slice angles wouldn't. Grade distribution folds
  anything past the top 5 grades into a neutral "Other" slice, since donut charts stop being
  readable much past 6 segments — pass/fail rates are what matter at a glance, not name-checking
  every rare grade.

## Branding

The interface uses the University of Vavuniya's official seal and maroon/gold colour scheme
(`frontend/public/assets/vau-seal.png`, `frontend/src/styles.css`), and the sign-in page follows
the same structure as the University's existing SEE (System for Examination Entry) portal —
logo, username/password, and a "Forgot password?" link — for a consistent look and feel across
university systems.

## Getting started

Requires **Node.js 18+** and a **PostgreSQL** server (14+) you can connect to — either installed
locally or a free-tier hosted instance (see **Deploying SARMS** below for hosting options; the
same `DATABASE_URL` approach works whether Postgres is on your machine or in the cloud).

### Database

Create an empty database and a user for SARMS to connect as (adjust names/password as you like —
just make sure `backend/.env`'s `DATABASE_URL` matches):

```bash
# using the psql command-line client, connected as a superuser (e.g. `postgres`)
CREATE ROLE sarms LOGIN PASSWORD 'choose-a-password';
CREATE DATABASE sarms OWNER sarms;
```

If you'd rather click through a GUI, **pgAdmin** (pgadmin.org) or **DBeaver** (dbeaver.io) can
create the role and database the same way — see **Inspecting the database** below.

### Backend

```bash
cd backend
npm install
# edit .env: set DATABASE_URL="postgres://sarms:choose-a-password@localhost:5432/sarms"
#            (or your hosted Postgres connection string)
npm run db:migrate   # applies schema.sql — safe to re-run any time, never destructive
npm run seed          # populates realistic demo data (see credentials below)
npm run dev            # starts the API on http://localhost:4000
```

`npm run db:reset` also exists for local development — it **drops every SARMS table and starts
over empty**. Never run it against a database with real data you want to keep.

Run the grading-engine test suite any time with `npm test`.

### Frontend

```bash
cd frontend
npm install
npm run dev   # starts the app on http://localhost:5173 (proxies /api to :4000)
```

Open http://localhost:5173 and sign in with any of the demo accounts below.

### Email delivery (forgot password)

SARMS has no email server of its own, so `backend/.env` ships with the SMTP fields blank and the
app runs in **dev mode**: requesting a reset prints the one-time code to the backend's console
*and* returns it directly in the API response (shown on the "Forgot password" page itself), so the
whole flow — request code, reset password, sign in with the new one — is fully testable without
any email setup. This mirrors how one-time account passwords already work elsewhere in SARMS
(shown on-screen for the Super Admin to hand out, since there's no email integration).

To send real emails instead, fill in `backend/.env`:

```
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-address@gmail.com"
SMTP_PASS="your-16-character-app-password"
SMTP_FROM="your-address@gmail.com"
```

For Gmail, `SMTP_PASS` must be an **App Password** (https://myaccount.google.com/apppasswords),
never your normal account password — Gmail rejects plain-password SMTP logins outright, and a
real password should never be pasted into a `.env` file regardless. Restart the backend after
editing `.env`; once `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are all set, `devOtp` disappears from the
API response and the code is only ever sent by email. The demo Super Admin account (`admin`) is
seeded with `jestudio22@gmail.com` as its personal email specifically for testing this end-to-end.

The **personal email** used for password recovery is a separate field from an account's regular
institutional email — it's optional, set per-account by the Super Admin (single-account form,
"Edit"/"Set" in the accounts table, or the "Personal Email" column in the bulk-import spreadsheet),
and it's the *only* thing the forgot-password flow ever reads or emails.

## Demo accounts

Seeded by `backend/npm run seed`. All start with `Student@12345` / `Lecturer@12345` etc. as a
one-time password — every account **except** the ones below must change it on first login, since
the seed script deliberately leaves one student (`kaviya.s`) in that state to demonstrate the
forced-change flow.

| Role | Username | Password |
|---|---|---|
| Super Admin | `admin` | `Admin@12345` |
| Head of Department | `hod.physci` | `Hod@12345` |
| Dean (view-only) | `dean.appsci` | `Dean@12345` |
| Chairman, Examination Branch | `chairman.examboard` | `Chairman@12345` |
| Examination Branch | `examboard.staff` | `ExamBoard@12345` |
| Lecturer (IT2032, IT2054) | `lecturer.perera` | `Lecturer@12345` |
| Lecturer (IT2043) | `lecturer.silva` | `Lecturer@12345` |
| Student — released result | `nirosh.b` | `Student@12345` |
| Student — forced password change | `kaviya.s` | `Student@12345` |
| Students | `aisha.f`, `ruwan.j`, `priya.m`, `tharindu.w` | `Student@12345` |

To try the forgot-password flow: go to `/forgot-password`, enter username `admin` and personal
email `jestudio22@gmail.com` (seeded specifically for this). See **Email delivery** above.

The seed data walks three course offerings through different stages of the lifecycle so every
role has something to see immediately: **IT2032** (Data Structures & Algorithms) is fully
released, including a student (Tharindu) whose strong theory mark is overridden by a failing
practical grade — a live demonstration of the "lowest component grade carries forward" rule.
**IT2043** (Database Systems) is submitted and awaiting HOD review, with one pending correction
request. **IT2054** (Software Engineering Lab) is still in the ICA-entry stage.

## Project structure

```
backend/
  src/
    db/            schema.sql, client.ts (Postgres pool + async query helpers), migrate.ts,
                     resetDb.ts, seed.ts
    lib/            grading engine, marking-scheme lookup, GPA service, auth, activity log,
                     excel.ts (xlsx read/write helpers), mailer.ts (SMTP/dev-mode email)
    middleware/     JWT auth + role-guard middleware
    routes/         auth (incl. forgot/reset password), admin, bulkAccounts, academic, ica,
                     results, settings, gpa, pdf
    __tests__/      grading engine unit tests (Jest)
frontend/
  public/
    assets/         vau-seal.png (University of Vavuniya seal, used as logo/favicon)
  src/
    api/            typed fetch client (incl. multipart upload + file-download helpers)
    auth/            AuthContext (JWT session)
    components/      Layout, ProtectedRoute, StatusBadge
    lib/             role labels, useApi data-fetching hook
    pages/           one folder per role, plus shared read-only views, plus ForgotPassword.tsx /
                     ResetPassword.tsx
```

## What changed in this round

- **Course Units (Super Admin)** can now be edited and deleted, not just created. A course unit
  can't be deleted while it still has course offerings against it, and its component type can't
  be changed once it has offerings (that would invalidate marks already entered).
- **Departments & Programmes (Super Admin)** can now be edited and deleted too, with the same
  "can't delete while something depends on it" protection, and duplicate names are rejected with
  a clear message instead of a raw database error.
- **The Final Marks / bulk-ESE-upload card on the Lecturer's offering page no longer disappears.**
  It used to render nothing at all once there was nothing pending and no fresh upload result —
  which made the bulk-ESE-upload feature look like it didn't exist. It now always shows a card
  explaining exactly what's going on (no students enrolled / already fully submitted / ready to
  enter marks).
- **Lecturer submission now asks for confirmation in two steps.** Entering ESE marks (or picking
  a file for bulk upload) no longer submits immediately — a "Review before submitting" step shows
  exactly what's about to be locked in, with an explicit "Confirm & submit" (or "Confirm & upload")
  action before anything actually happens.
- **The Lecturer's offering page is now split into three tabs** — ICA marks, Final marks (ESE),
  and Results — instead of one long page mixing ICA and ESE together.
- **Bulk-upload error messages are more specific.** Uploading a file that doesn't match the
  expected template (wrong/missing columns — e.g. a hand-built sheet or the wrong file entirely)
  now fails fast with one clear message naming exactly which columns are missing, instead of a
  row-by-row wall of confusing per-row errors.
- **A Level-4 "Special/Honours" eligibility flag** — for students in an honours-flagged programme
  who reach Level 4 with an OGPA of 3.0 or higher (computed from every released result so far),
  a badge now appears on their dashboard and profile. This is a read-only, informational flag for
  now — it doesn't gate enrollment or create a separate course structure, since that design still
  needs to be worked out with you.
- **A welcome banner with a (placeholder) motivational message from the Dean** now greets students
  on their dashboard — swap in the Dean's actual wording in `StudentDashboard.tsx`
  (`DEAN_WELCOME_MESSAGE`) whenever you have it.
- **A site footer** (department contact details, matching the SEE portal's layout) now appears on
  every page.
- **Mobile navigation**: below ~860px wide, the sidebar becomes a hamburger-triggered dropdown
  instead of a fixed column, tables scroll horizontally inside their card instead of squeezing or
  overflowing the page, and forms/grids stack into a single column.

## What changed after that

- **Super Admin can now delete an account outright**, not just deactivate it — but only while
  nothing in SARMS references it yet (no marks, no enrolments, no offerings assigned, no logged
  actions). An account with real history is blocked with a clear message telling you to
  deactivate it instead; you also can't delete the account you're currently signed in as.
- **The one-time password shown when an account is created (or bulk-imported) is no longer lost
  on refresh.** A PDF with the username and password now downloads automatically the instant the
  password is generated — for a single account, a bulk-import batch, or a password reset — with a
  manual "Download PDF again" button as backup. SARMS still never stores the plaintext password
  anywhere; if one is genuinely lost after all that, use the new **Reset password** button on the
  Accounts page to issue a fresh one (the old one stops working immediately). The Activity Log
  records *when* a password was created or reset and by whom, without ever storing the password
  itself — see the "on databases" note below for why that split matters.
- **Fixed a real bug this surfaced**: creating a staff account for a role that doesn't need a
  department (Chairman, Examination Branch, Super Admin) could fail with a misleading "username or
  email already in use" error, because the form was sending an empty department value that tripped
  a foreign-key check. Fixed at the source — the error was never about a duplicate username.

### Inspecting the database (and the password hashes)

SARMS now runs on **PostgreSQL** — connect with a free GUI client:

- **pgAdmin** (pgadmin.org) or **DBeaver** (dbeaver.io) — either one connects using the same
  pieces as `DATABASE_URL` (host, port, database name, username, password). Browse to the `users`
  table and look at the `password_hash` column: it holds bcrypt hashes (strings starting `$2b$`
  or `$2a$`) — a one-way transform, so seeing that column full of those confirms passwords are
  hashed, not stored in plain text, without either of us being able to reverse one back to the
  original password. That check is exactly the same as it was under SQLite — hashing happens in
  application code (`backend/src/lib/auth.ts`), completely independent of which database stores
  the result.
- Or from a terminal: `psql "postgres://sarms:your-password@localhost:5432/sarms"` and
  `SELECT username, password_hash FROM users LIMIT 5;`.

You can delete rows directly in the GUI too, but prefer the app's own **Delete** button on the
Accounts page where possible — it's the one that checks for linked data first and gives you a
clear message instead of a raw foreign-key error.

## What changed after that (database migration to PostgreSQL)

- **The database engine changed from SQLite to PostgreSQL.** This was a deliberate trade: SQLite
  was zero-setup and perfect for local development, but a single file isn't what you'd want
  behind a live, always-on system handling 1,000+ students and bulk mark uploads from multiple
  people at once. Postgres is a real client-server database built for exactly that, and it's what
  every mainstream hosting platform expects.
- **Every database call in the backend was rewritten** from `node:sqlite`'s synchronous API to
  the async `pg` driver — this touched every route file, but the request/response shape of every
  API endpoint is unchanged, so the frontend needed no changes at all.
- **Nothing about password hashing changed.** Bcrypt hashing happens in `backend/src/lib/auth.ts`,
  entirely independent of the database engine — this migration doesn't touch it.
- **Setup is one extra step**: you now need a Postgres server to point `DATABASE_URL` at (see
  **Getting started** above), instead of SARMS creating a database file for you automatically.
  Everything else — `npm run seed`, `npm run dev`, the demo accounts — works exactly as before.

## What changed after that (bulk lecturer assignment & course units)

- **Bulk-assign lecturers from an Excel sheet, with one-click Accept/Reject.** On the Course
  Offerings page, the Super Admin can now upload a spreadsheet of "what a lecturer is capable of
  teaching" — one row per Lecturer Username / Course Code / Academic Year / Semester. Nothing is
  assigned automatically: every valid row lands in a **Pending assignment requests** list below the
  upload, and each row gets a single **Assign** button (creates the real course offering — exactly
  what the manual "Create an offering" form does) or **Reject** (discards it) — no confirmation
  dialogs, no extra steps. A row with a typo'd username, an unknown course code, or a clash with an
  offering that already exists is reported individually at upload time so it never reaches the
  queue in the first place.
- **Bulk-add course units from an Excel sheet.** On the Course Units page, upload a spreadsheet
  (Code, Name, Programme, Category, Component Type, credits) and each valid row is created
  immediately — same row-by-row error reporting as every other bulk import in SARMS. Level and
  Semester are optional columns: leave them blank and SARMS reads them straight from the course
  code using your numbering convention (e.g. **IT2223** → the first digit after the subject prefix
  is the Level, the next digit is the Semester → Level 2, Semester 2). If a code doesn't follow
  that pattern, just fill in Level/Semester explicitly for that row instead.

Still open, on purpose — these need your input before they can be built correctly:

- The **ESE marks scale** (currently hardcoded 0–100 for both theory and practical in five places,
  including the tested grading engine) — waiting on the handbook figure for the practical
  component (200 vs 400).
- The exact **contact details for the footer** and the **Dean's real welcome message** — currently
  placeholders.
- Deeper **Departments & Programmes UX** questions (beyond edit/delete) once you've had a chance
  to say more about what "not clear" meant.

## Deploying SARMS

SARMS is three independent pieces to put online: the **database** (Postgres), the **backend**
(Node/Express API), and the **frontend** (a static React build). None of them need to live on the
same host — that's what makes a free or near-free deployment possible.

### 1. The database — pick a host that won't expire

Two Postgres hosts have a genuinely durable free tier (as opposed to a trial that quietly deletes
your data):

- **[Neon](https://neon.tech)** — free tier scales to zero when idle and resumes instantly (no
  sleep delay on the database itself), doesn't expire, 0.5 GB storage. Good default choice.
- **[Supabase](https://supabase.com)** — free tier pauses a project after a week of no activity at
  all (one click to resume), doesn't expire, 500 MB storage.

Avoid Render's free Postgres for anything you want to keep — as of writing it **auto-deletes 30
days after creation**, which is fine for a throwaway test but not for real student data. Either
Neon or Supabase gives you a `DATABASE_URL` connection string the moment you create a project —
paste it into the backend's environment variables (below) and run `npm run db:migrate` once
against it.

### 2. The backend — any Node host, pointed at that database

**[Render](https://render.com)** is the simplest option: connect this project's GitHub repo, point
it at `backend/`, set the build command to `npm install && npm run build` and the start command to
`npm start`, and set these environment variables (mirroring `backend/.env`):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the connection string from Neon/Supabase |
| `JWT_SECRET` | a long random string (not the dev default) |
| `JWT_EXPIRES_IN` | `8h` (or whatever session length you want) |
| `FRONTEND_URL` | your deployed frontend's URL, once you have it (locks down CORS to just that origin) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | only if you want real forgot-password emails — see **Email delivery** above |

Render's free web-service tier requires no credit card, but it **sleeps after 15 minutes of no
traffic** and takes roughly a minute to wake back up on the next request — noticeable, but not
data loss, and completely fine for a project being evaluated or used by a class rather than the
whole university at once. **Railway** is the other common option; its free monthly credit is too
small to stay online continuously, so treat it as a "pay a few dollars a month" host rather than a
free one. Either way, once `npm run build` runs, start the server with `npm start` (not `npm run
dev`) — the `dev` script is for local development only.

### 3. The frontend — any static host

Build it with `npm run build` inside `frontend/` (produces `frontend/dist/`), set `VITE_API_URL`
to your backend's deployed URL before building (e.g. `VITE_API_URL=https://sarms-backend.onrender.com
npm run build`), and deploy the `dist/` folder to any static host — Render's free Static Site,
Netlify, Vercel, or Cloudflare Pages all work and are free for a project this size. Because
`frontend/src/api/client.ts` reads `VITE_API_URL` at build time, requests go straight to the
backend's real URL instead of assuming everything lives on one domain — no proxy or rewrite rules
needed. Remember React Router needs its "unknown routes fall back to `index.html`" setting turned
on (every one of these static hosts has this as a one-line config option, sometimes on by default).

### When you outgrow the free tiers

The moment SARMS is handling real, everyday use — not just a demo — the two things worth paying
for are: removing the backend's 15-minute sleep (Render's cheapest paid web-service tier is
usually a few dollars a month and runs continuously), and, if 500 MB–1 GB of Postgres storage
starts feeling tight after a few years of results data, a paid Postgres tier from the same
provider. Nothing about the application code changes either way — this is purely a hosting-plan
upgrade.

## Notes on scope

This is a complete, working reference implementation of the workflow and business rules in the
proposal, built to demonstrate the architecture end-to-end — not a production deployment. A few
things worth knowing if you extend it:

- Every business rule (role permissions, lifecycle gating, correction-request timing, release's
  simultaneous revocation) is enforced **server-side** in the route handlers — the frontend never
  trusts client-side state for authorization.
- Course offerings submit and release **atomically**: a lecturer submits final marks for every
  enrolled student in one action, and the Chairman releases a course offering's results only once
  every enrolled student's result has reached HOD-approved.
- The Examination Branch's certificate PDF and the Lecturer/HOD/Dean/Chairman result-sheet PDF
  are both generated fresh from the database on each request — nothing is cached.
