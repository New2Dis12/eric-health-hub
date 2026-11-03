# Stunna Intelligence Engine — Architecture (Sprint 0)

Status: design proposal, not yet implemented. Extends existing public GitHub repository `New2Dis12/eric-health-hub`, current Next.js/Vercel deployment, Auth0-based MCP access, Garmin FIT decoder, Oura integration and Upstash Redis. No parallel app or new Vercel project.

## Context / trust boundaries

```text
                           EXISTING VERCEL NEXT.JS APP
 ChatGPT Stunna HQ          +--------------------------------------------+
     | Auth0 bearer token  | /mcp  -> read/write training tools          |
     +-------------------->|         -> server-side business logic      |
                           |               |                            |
 iPhone browser            | /app  -> private UI/route handlers          |
     | authenticated cookie|          |    |                            |
     +-------------------->|          +----+ shared service layer       |
                           +-----------------+--------------------------+
                                             |
                    +------------------------+-----------------------+
                    |                        |                       |
              PostgreSQL                Upstash Redis           Data providers
        plans/sessions/metrics       existing OAuth tokens,     Garmin FIT / Oura
        preferences/decisions         locks, short-lived cache  (Peloton: partial)
```

**Important:** ChatGPT is a UI, not the durable store. The web app is another UI, not another coaching brain. Both use the same service layer and database. No external provider token is passed to the browser or to ChatGPT.

## Existing implementation verified in `main`

- `app/mcp/route.ts` checks Auth0 bearer scopes and only creates MCP tools for authorized callers.
- `lib/auth0.ts` currently recognizes `oura.read` and `garmin.read`, verifies audience/issuer/signature and the allowed subject.
- `lib/mcp-server.ts` exposes `get_oura_summary` and `get_garmin_activities`; Garmin supports on-demand FIT telemetry and native lap data.
- `lib/oura-tokens.ts` stores existing Oura tokens in Upstash Redis; preserve refresh coordination.
- `app/page.tsx` invokes `getOuraTestResultFromStore()` and presents Oura values; no page-level Auth0 session guard is visible in that file. `app/api/oura/authorize/route.ts` and the callback likewise lack an obvious application login guard. **Security gate:** verify effective route protection and close any unauthenticated health-data visibility or OAuth connection path before enabling the Stunna dashboard or persistent training writes.
- The repository is **public**. Never put private workout/weight data, screenshots, OAuth credentials, exported records, or production database secrets into commits, tests, PR bodies, CI logs or public issues.

## Recommended storage (provision only after approval)

- **Neon PostgreSQL (proposed)** as primary durable source of truth: relational training plans, workouts, sets, body metrics, notes, program decisions, coaching preferences, analytics summaries and auditing.
- **Existing Upstash Redis** retains current OAuth tokens and short-lived caching/locks. Do not make Redis the system of record for mutable workout plans.
- **Object storage** only if retaining screenshots is necessary; prefer extracting confirmed workout metrics and not storing image files indefinitely. Never store screenshots in the public repository.
- **Google Drive** optional for periodic human-readable exports/backups, not the source of truth or an obligatory weekly handoff. Backups should be private, access controlled and restore-tested.

A new vendor account/database has *not* yet been provisioned; actual pricing and quotas require confirmation at provision time. The simplest MVP should fit personal-use tiers, but compute, storage, execution time and paid model/API calls are not guaranteed free forever.

## Authentication and authorization

1. **MCP/ChatGPT:** Keep current Auth0 resource audience and allowed-sub restriction. Introduce explicit least-privilege `training.read` and `training.write` scopes through a reviewed auth change. Verify ChatGPT connector tool discovery/reauthorization after adding tools; the current client may cache tool schemas.
2. **Web app:** Add an Auth0-backed web session and enforce authorization server-side on every dashboard page and data-mutation endpoint (not merely by hiding UI elements). Verify both logged-out and signed-in access.
3. Require signed-in identity to match the authorized user; never accept a client-provided user_id as authority. Ensure CSRF protection / origin checks for cookie-authenticated mutations and server-side input validation.
4. Protect tokens and databases with server environment variables; no service keys or private workout information in client bundles, public GitHub, logs or analytics.
5. Writes should use typed, bounded input schemas; audit who/what/when/source; separate user-approved plan changes from automatic data capture.

## Core domain model (proposed)

| Entity | Purpose / selected fields |
|---|---|
| Athlete | Authorized identity, locale/time zone, training and presentation preferences |
| TrainingBlock | Goal, dates, phase, status, approved revision |
| TrainingWeek | Date boundaries, focus, recovery assumptions, block relationship |
| PlannedSession | Scheduled time, type, purpose, status, revision |
| ExercisePrescription | Ordered exercise/interval, weight/speed targets, sets/reps/duration/rest, rationale |
| ActualSession | Planned-session link, started/completed time, state, user feedback, revision |
| ActualSet | Exercise, set order, actual weight/reps, RPE, completion/skipped reason |
| ExternalActivity | Provider, immutable external ID, timestamp, match confidence and duplicate state |
| DerivedMetric | Algorithm version, calculation window, units, value, quality/coverage, source |
| BodyMeasurement | Type, numeric value, unit, measured-at, provenance, revision |
| RecoverySnapshot | Date, vendor-derived HRV/RHR/sleep/readiness with source/time and gap flags |
| CoachingDecision | Proposal, rationale, evidence links, status pending/approved/rejected, effective date |
| AuditEvent | Mutation actor, reason, timestamp, before/after identifiers (no secrets) |

Design relational constraints for **uniqueness** on vendor/activity IDs, actual-session finalization, and set event idempotency keys. Use stable IDs and timestamp+timezone conventions. Distinguish planned vs actual fields. Migrations are versioned and reversible where practical.

## API / service boundaries

- Internal server functions own validation, authorization, persistence, audit and derived analytics. MCP tools and website route handlers call the **same** functions.
- Initial MCP tools to design, not yet registered:
  - `get_training_context` — current block/week/today, verified prescriptions and presentation rules.
  - `get_training_history` — bounded workout sessions, logged sets, feedback, comparison metadata.
  - `log_body_measurement` — authenticated, idempotent write to body metrics.
  - `record_workout_feedback` — notes, actual sets, RPE, skipped work; bounded partial updates.
  - `complete_workout` — mark completed, find and match Garmin activity, enqueue or perform safe analysis with progress status.
  - `get_weekly_review` — calculated summary and known gaps.
  - `propose_plan_change` / `approve_plan_change` — explicit approval required for changed programming.
- Prefer stable, typed response schemas and pagination over huge raw FIT payloads. Keep the existing `get_garmin_activities` interface backward compatible.

## Garmin, Oura, Peloton

- Garmin: existing auth/token cache + FIT decoder; retrieve on demand, normalize units/cadence, preserve native lap timestamps with explicit source-anomaly flags, link via provider activity ID and avoid storing redundant raw FIT blobs by default.
- Oura: expand from latest-summary to historical daily trends as provider scopes and retention allow; avoid treating a score as a diagnosis or rule for automatic programming.
- Peloton: currently available class catalog/scheduling does **not** provide verified completed-workout detail. Use screenshot/manual metrics only when needed; optional authorized sync after investigation. Deduplicate Peloton + Garmin views of the same effort.
- Existing project Markdown: one-time reviewed import for the authoritative starting block, sessions, exercises, baselines and preferences. Archive as migration sources; never require manually re-uploading docs each Sunday.

## Operational requirements / release safety

- **Authentication and privacy gate before user data:** test unauthenticated browser, routes, MCP read and write attempts; verify scope enforcement and secure cookies.
- **State integrity:** idempotent writes, atomic updates for sets/plan revisions, no phantom completion, transparent retrieval errors, conflict handling and audit history.
- **Analytics:** deterministic unit tests with fixtures, source coverage/quality flags, explicit distinctions among measured/derived/subjective/suggested data.
- **Deployment:** feature branch -> PR -> tests/typecheck/build -> real-data smoke test when authorized -> human approval -> merge/deploy. Do not modify production credentials in PR.
- **Recovery:** encrypted/private backups or managed snapshots, exportable plans and logs, documented restore procedure.
- **Limitations:** serverless time budgets may require resumable tasks for heavy history ingestion; do not promise continuous background syncing without scheduled infrastructure.

## Decisions not yet implemented

Provision Postgres; select schema migration/query library; determine screenshot handling; implement web login protection; extend Auth0 and MCP scopes; address stale ChatGPT tool schemas; select matching policy for simultaneous Garmin/Peloton recordings. Each belongs to an explicit sprint rather than speculative implementation.
