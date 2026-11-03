# Stunna Intelligence Engine — Sprint Roadmap

Updated: 2026-11-02. Scope-based sprints, **not** fixed two-week calendar promises. Current intent: one cohesive branch/PR per sprint, or split large scopes into smaller PRs. Every sprint must deliver something reviewable and preserve operational Garmin/Oura integrations.

See [PRODUCT.md](PRODUCT.md) for user-experience contract, [ARCHITECTURE.md](ARCHITECTURE.md) for trust boundaries and storage, [STATUS.md](STATUS.md) for actual progress.

## North-star acceptance test

The user opens the existing Stunna app on a phone, sees today's *correct* program, logs sets/weights/RPE/notes, taps Complete, and then asks ChatGPT in Stunna HQ to analyze the session. ChatGPT sees the exact recorded sets, matched Garmin telemetry where available, and historical context **without uploads, re-prompting, reentering details, or file handoffs**. After a conversational weekly review, approved adjustments show up in next week's prescribed workouts.

## Sprints

### Sprint 0 — Product foundation (current)
**Scope:** agree on daily workout + logging + conversational closeout contract; authoritative storage decisions; source provenance and security architecture; prioritized backlog; explicit release gates.

**Deliverables:** `docs/engine/PRODUCT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `STATUS.md`. No production code/config, providers or data changed.

**Acceptance:** docs clearly answer who the coach is, what the app does, what is stored where, how updates cross interfaces, what requires approval, and what the next build PR changes. Open a review PR; no merge/deploy.

### Sprint 1 — Secure persistence foundation
**Scope:** protect private web pages and API routes, verify Auth0 authorized subject/session behavior, wire a new PostgreSQL instance for relational records, implement and migrate a minimal schema (athlete, block, planned session, actual session, body measurement, change audit). Provide authenticated server read/write services and focused tests. Retain Upstash for existing token storage.

**Acceptance:** an anonymous visitor cannot read Oura or Stunna data or mutate records; authenticated browser/API can write/read a test measurement and session atomically; typed schema/migrations and rollback documented; secrets remain server-only; no Garmin/Oura regressions. **External blocker:** owner must approve/provision database and any needed Auth0 client configuration before production integration. No real personal data until auth audit passes.

### Sprint 2 — Real prescriptions + app home
**Scope:** review/import the authoritative Getting Back to Stunna current block, schedule, exercise/interval targets, baselines, preferences and correction history. Mobile-first app login, "Today" page, training calendar, exercise ordering, prior comparable values; integrate read-only MCP tool `get_training_context`.

**Acceptance:** the app and ChatGPT retrieve the same saved plan with consistent units and formatting; known corrections survive a new chat; missing prescriptions are not silently guessed; private pages require auth. No dependency on weekly Markdown maintenance.

### Sprint 3 — Interactive workout player + one-place logging
**Scope:** show session step-by-step; check off/skip sets; log actual weights, reps, RPE and notes; resume partially logged session; save weight/waist check-ins. Expose scoped MCP logging/read tools so ChatGPT and the app share entries. Create end-to-end reconciliation tests.

**Acceptance:** log sets in app -> ChatGPT reads exact sets; log weight via ChatGPT -> app displays measurement; reload app -> in-progress state survives; revisions audited; repeated submit does not double count. **First tangible daily-use milestone**.

### Sprint 4 — "Workout complete" automation
**Scope:** on explicit completion, discover candidate recent Garmin activities, match the correct activity, download/decode FIT on server, summarize prescribed-versus-actual, handle absent data with transparent status/retry; link workouts; deduplicate overlapping wearable/Peloton representations. Flag or investigate known native FIT lap-end timestamp anomalies and sample-coverage limitations. Accept Peloton screenshot/manual metrics as needed without inventing a completed-activity integration.

**Acceptance:** completion from app triggers safe Garmin analysis; activity links to only one session; ChatGPT retrieves the outcome in fresh thread; unmatched/failed work visible and recoverable; existing FIT detail tool remains backward compatible.

### Sprint 5 — Conversational weekly closeout + approved changes
**Scope:** compare completed versus prescribed training, exercise/pace progression, subjective feedback, adherence, recovery/weight snapshots where available. Generate stable weekly summary, pending decisions, and approved revised next-week prescriptions through separate propose/approve operations.

**Acceptance:** user says "review my week" in primary Stunna HQ chat, discusses highlights and plan, approves a change, and sees updated prescription in app; no Markdown download/reupload. No automatic major programming changes without approval.

### Sprint 6 — Advanced training intelligence
**Scope:** validated running analytics (comparable-effort HR/pace, interval consistency, GCT, cadence, vertical oscillation), Oura historical trends, body-composition trends and strength progression. Add quality coverage, versioned algorithms, confidence notes, meaningful comparisons, and coach-facing explanations.

**Acceptance:** metrics are reproducible by fixtures and source IDs; reports reject misleading cross-workout comparisons; clearly mark missing sensors/uncertain conclusions; no proprietary pseudo-scientific composite score needed.

### Sprint 7 — Rich dashboard + block-level intelligence
**Scope:** mobile visual analytics for planned vs done, running/strength/body/recovery charts; block objectives and before/after analysis; optional private exports, failure monitoring and owner-approved recurring summaries. Investigate any additional authorized Peloton completion ingestion as separate exploratory work.

**Acceptance:** user can inspect trends and planned workouts without conversing, while ChatGPT references identical authoritative state. Can export/recover all personal records. UI remains practical on iPhone.

## Prioritization / risk controls

1. **P0: security** — current home route in `main` renders Oura metrics without an explicit page-level Auth0 check; verify all access paths and protect before sensitive data writes.
2. **P0: durable memory** — a training database, not chat context or README/Markdown files, must be the source of truth.
3. **P0: unchanged existing integrations** — keep Garmin FIT (including native lap and running dynamics), Oura token refresh, Auth0 MCP, and current Vercel project working.
4. **P1: logging UX** — app should be *more convenient* than typing sets into ChatGPT. The app is a workout player, not a competing assistant.
5. **P1: coach presentation stability** — templates/preferences and approved correction history persist; both interfaces use the same plan.
6. **P1: auditability** — preserve actual-vs-prescribed, data-source identity and modification provenance.
7. **P2: performance trends, visual polish, optional automation** — ship only after the daily path works.

## Definition of done for every implementation sprint

- Review exact scope + out-of-scope, identify data-model/migration changes and security impacts.
- Create branch/PR in existing repository; never auto merge or deploy.
- Include automated tests (unit, auth/permission, integration where feasible), typecheck and build.
- Show a real end-to-end demo or explain clearly why a prerequisite blocks it.
- Document external setup steps only when unavoidable, with minimal owner burden.
- Update `STATUS.md` with completed work, PR link, unresolved defects, next sprint prompt.
- Never disclose private data or credentials in a public GitHub artifact.

## Backlog explicitly deferred from MVP

Dedicated native iOS app; embedded second AI chatbot with separate API billing; custom fitness readiness score; full offline sync; continuous real-time workout telemetry; always-on background monitoring; large retrospective FIT warehouse; unsupported Peloton activity extraction; autonomous week/block redesign without user approval.
