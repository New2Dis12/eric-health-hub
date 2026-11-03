# Sprint 1 — Setup, verification and rollback

This change stays in the existing Next.js repository and Vercel project. The PR does not provision resources or change credentials automatically. Owner-authorized external setup progress is tracked in STATUS; existing production records and integrations remain untouched. `feature/stunna-sprint-1` has Vercel Git deployment disabled in `vercel.json`; retain that entry while reviewing. Nothing migrates during build, startup or provider/MCP requests.

## Minimal owner setup before an approved release

1. Provision one private PostgreSQL database (Neon proposed, standard PostgreSQL supported) and a **distinct restricted runtime login** named `stunna_runtime`. Keep its password and both connection URLs in the provider/environment secret settings. The migration owner must be a different role. Runtime must have NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT, no owner-role membership, and must not own the schema/tables. Use a pooled runtime URL for Vercel and a direct owner URL for migrations. Require verified TLS; remote TLS overrides in URLs are stripped and certificate verification is enforced.
2. In the **existing Auth0 tenant**, configure an existing suitable Regular Web Application client for the website with authorization-code login. Add `https://eric-health-hub.vercel.app/auth/callback` to Allowed Callback URLs and `https://eric-health-hub.vercel.app` to Allowed Logout URLs. Keep the existing MCP application's settings, audience and scopes untouched. Set `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, a cryptographically random 32-byte hex `AUTH0_SECRET` (generate securely, e.g. `openssl rand -hex 32`), and exact `APP_BASE_URL` on the **existing Vercel project**, only when authorizing release. Reuse `AUTH0_DOMAIN` and `AUTH0_ALLOWED_SUB`. If no existing client supports confidential web login, stop for owner configuration; this PR creates no duplicate application. For local HTTP development only, use `APP_BASE_URL=http://localhost:3000` and explicitly register its callback/logout URLs.
3. From a trusted operator environment, with `DATABASE_MIGRATION_URL` supplied securely, run `pnpm db:migrate`. Apply `db/runtime-grants.sql` as the migration owner. Configure Vercel `DATABASE_URL` with the restricted role. **Do not put the migration-owner URL in Vercel.** Keep `STUNNA_ENABLED=false` until the auth audit and synthetic smoke test pass; then set it to `true` only as part of the approved release. Never paste secrets into chat, PRs, logs or shell history.

**Neon runtime-role requirement:** create restricted application roles with SQL, not the Neon Console/CLI/management create-role API. Management-created roles receive `neon_superuser` membership and BYPASSRLS by default; those credentials must never be used as `DATABASE_URL`. Use a securely generated password through a trusted operator channel, apply the repository grants, and verify all role attributes and memberships. See [Neon database access](https://neon.com/docs/manage/database-access). Keep the migration owner privileged and separate.

Only a separately approved preview/deployment can validate the actual Auth0 client configuration and managed database. Do not import real health records until that gate passes. No paid plan or service account has been created.

## Security boundaries and intentional behavior changes

- `/` checks the encrypted Auth0 browser session and exact allowlisted subject **before** accessing Oura/Redis. Anonymous and wrong-account requests receive a generic sign-in surface with no data. The page is dynamic; no personal homepage is prerendered.
- Auth0 SDK owns state, nonce, PKCE, code exchange and encrypted session cookies. Cookies are HttpOnly, SameSite=Lax, Secure on HTTPS, with an eight-hour absolute session limit. The application also checks session creation time on each read. Rolling sessions are disabled, so only `/auth/*` needs the SDK proxy. Only login/logout/callback are mounted; access-token/profile/connect and other auxiliary endpoints are unavailable. Auth errors return generic, uncached responses.
- Oura connect and callback require the authorized browser session; the existing Oura state check, callback URI, token exchange and Upstash token keys/refresh locks remain. Oura callback requires the initiating browser still to be signed in; if it expired, sign in and restart connection.
- `/api/oura/test` requires authorized browser identity or existing `oura.read` bearer permission. `/api/garmin/test` retains its test-secret check **and additionally requires** authorized browser identity or `garmin.read` bearer permission. Existing diagnostics using only the test secret must add Auth0 authorization. This affects that diagnostic route, not Garmin MCP/authentication/FIT.
- `/api/training` is disabled by default. When enabled, encrypted browser sessions authorize the allowlisted owner. Cookie-authenticated POST also requires an exact `Origin` matching configured `APP_BASE_URL`; missing/cross-site origins fail. Trusted origin is never derived from Host headers. Bearer requests require a signed Auth0 RS256 token, original MCP audience, matching issuer/subject and explicit `training.read` or `training.write` scope. Invalid bearer credentials never fall back to cookies; existing health scopes grant no training access. Add these permissions on the existing Auth0 API only if testing external training API clients; the browser path needs no new API grant. No training MCP tools or new connector permissions are registered in Sprint 1.
- Shared server functions repeat subject and scope checks; caller-supplied athlete IDs are rejected. Parameterized SQL uses owner predicates and PostgreSQL FORCE RLS with transaction-local identity. The runtime rejects superuser, BYPASSRLS and table-owner connections. Restricted grants make audits, measurements, plans and idempotency records append-only. Provider tokens never enter training storage.
- Inputs use strict bounded schemas, valid units, timestamps with offsets and IANA timezone names. JSON request bodies are capped at 16 KiB by streamed bytes. History is bounded to 1–100 records **per collection**, with deterministic sorting, offset 0–10,000 and a continuation hint. Offset pagination is intended for Sprint 1 diagnostics; stable cursor-based history is a later improvement.
- Internal failures return generic 503 responses without driver text, SQL, bound health values or credentials. Private JSON responses are no-store and vary by Cookie/Authorization.

## Models and write semantics

Versioned migration `001_foundation` creates `stunna.athletes`, `training_blocks`, `planned_sessions`, `actual_sessions`, `body_measurements`, `audit_events`, and ancillary `write_requests`. IDs are UUIDs; instants use timestamptz, block dates use date, scheduling/measurements preserve explicit timezone names. Prescribed and actual values occupy separate tables. No seed data or personal records are included.

`lib/training/service.ts` is the shared, server-only entry point for future web/MCP callers. Initial operations are deliberately narrow: create a block, create a planned session within its block dates, or atomically record a measurement and/or an actual session. Blocks/plans are initial creation only; exercise prescriptions and plan revision/approval workflows belong to later sprints.

Each write requires a UUID `idempotencyKey` and a bounded `reason`. An exact retry returns the original IDs/revision without a second audit or insert. Reusing the key with different validated content or source returns 409. A transaction-local athlete row lock serializes concurrent requests; optimistic `expectedRevision` is 0 for a new actual session and the current revision for corrections. Unique planned/actual linkage prevents duplicate completion. Completed sessions keep their original start/completion timestamps and cannot reopen; notes/RPE corrections require the current revision and are audited. Measurement corrections are intentionally not exposed yet; do not submit a second measurement as a replacement.

Record inserts, audit events and idempotency results commit together. Audit stores actor, reason, source, entity ID and before/after revision numbers, not prior health-value snapshots. Athlete creation is incidental to the first successful write and is rolled back on failure. No background matching, imports, scheduling or analytics run in Sprint 1.

## Synthetic smoke test (after release approval)

Run on an approved private environment with synthetic records only; do not copy returned health data into public logs.

1. Anonymous: homepage shows no metrics; Oura test/connect/callback and training read/write deny access. Public privacy/terms and OAuth resource metadata remain available. MCP still responds with its existing OAuth challenge. With `STUNNA_ENABLED=false`, training returns 404.
2. Browser: log in through `/auth/login` with the allowlisted account. Confirm HttpOnly/Secure/SameSite cookies, no browser-accessible bearer endpoint and correct sign-out. A different account, expired/tampered cookie or unmatched callback state must not gain access. Verify private responses cannot be cached.
3. With Stunna enabled, use the browser console on the exact application origin to POST JSON to `/api/training` with `credentials:'same-origin'`. `fetch` supplies Origin on same-origin POST. All examples below are **synthetic**:

```json
{
  "operation": "create_block",
  "idempotencyKey": "11111111-1111-4111-8111-111111111111",
  "reason": "Synthetic acceptance check",
  "block": {
    "title": "Synthetic test block", "goal": "Persistence verification",
    "startsOn": "2026-01-01", "endsOn": "2026-01-31", "source": "manual"
  }
}
```

Use the returned `blockId` in a `create_planned_session` command with a **new** idempotency UUID:

```json
{
  "operation": "create_planned_session",
  "idempotencyKey": "22222222-2222-4222-8222-222222222222",
  "reason": "Synthetic acceptance check",
  "plan": {
    "blockId": "REPLACE_WITH_RETURNED_UUID", "scheduledAt": "2026-01-02T12:00:00Z",
    "timeZone": "UTC", "kind": "run", "purpose": "Synthetic check", "source": "manual"
  }
}
```

Use the returned planned session UUID to save a measurement and session **in one POST**:

```json
{
  "operation": "record_observation",
  "idempotencyKey": "33333333-3333-4333-8333-333333333333",
  "reason": "Synthetic acceptance check",
  "measurement": { "kind": "weight", "value": 100, "unit": "kg", "measuredAt": "2026-01-02T12:00:00Z", "timeZone": "UTC" },
  "session": { "plannedSessionId": "REPLACE_WITH_RETURNED_UUID", "expectedRevision": 0, "startedAt": "2026-01-02T12:00:00Z", "completedAt": null, "status": "in_progress", "notes": "Synthetic only", "rpe": 5 }
}
```

4. `GET /api/training?limit=50&offset=0` returns the saved records. Repeat the exact POST: IDs and revision stay the same. Change content with the same key: 409. Attempt a stale revision, invalid unit, missing Origin or another athlete's ID: deny. Invalid session plus measurement must leave neither new record. Check audit and idempotency rows through a private operator connection. Remove synthetic data via the owner connection or discard the dedicated test database; there is intentionally no public destructive API.
5. API: if external API testing is needed, grant explicit training permissions to an authorized client on the existing Auth0 API and repeat with a bearer token. A read-only token must not write. Do not alter the existing ChatGPT MCP client's grants or require reconnection for Sprint 1.
6. Health Hub v2: privately confirm Oura summary, Garmin activity listing, FIT sample fields/pagination, running dynamics and native lap pagination through the existing connector. Also confirm Garmin cached-token/401 retry and Oura refresh behavior. No new Auth0 browser or PostgreSQL variable should be required by `/mcp`. Record only pass/fail and non-sensitive counts in STATUS.

## Validation and remaining release gates

`pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm build`. Tests use generated JWT keys, Auth0 SDK encrypted cookies/protocol fixtures, synthetic FIT data and PostgreSQL-in-WASM (PGlite), including the real SQL migration, runtime grants, RLS, transactions and rollback. PGlite serializes transactions; concurrent calls exercise idempotency/revisions but do not replace a managed PostgreSQL load/concurrency test. Hosted pooling/TLS, actual Auth0 tenant settings and live provider smoke tests remain owner-gated. See STATUS for final results.

## Rollback and recovery

- **Before merge:** close the PR/abandon the branch. Production code, Vercel environment, Auth0 grants and Upstash were not changed.
- **Stunna-only issue after an approved release:** set `STUNNA_ENABLED=false` and redeploy the existing project **with owner approval**. This disables training API access but retains browser/provider protections and existing MCP. Do not remove authentication to recover training access.
- **Application regression:** after owner approval, revert the Sprint 1 commit or promote the prior known-good Vercel deployment. PostgreSQL tables are additive and may remain; no migration is needed to run the previous MCP code. A full code rollback restores the old unauthenticated website exposure, so restrict website access during that recovery and follow with the auth-only fix. Never rotate/delete Garmin/Oura/Upstash tokens as a rollback step.
- **Schema rollback is last resort:** first take a private provider snapshot/export, verify restorability in a separate private database and stop all Stunna writes. On an owner-authorized maintenance connection only, run `STUNNA_ALLOW_DESTRUCTIVE_ROLLBACK=true pnpm db:rollback` with `DATABASE_MIGRATION_URL` supplied securely. This deletes all training/audit/idempotency records for the latest migration; it does not touch Upstash or provider tokens. The migration runner checks applied checksums, locks migration execution and runs changes transactionally. A failed migration rolls back rather than leaving a partial schema. Runtime grants must be reapplied after recreating the schema.
- **Restore:** restore the provider snapshot into a private replacement database/branch; run current migrations as owner, reapply restricted runtime grants, verify RLS and synthetic read/write plus record counts, then switch only the training `DATABASE_URL` through the existing project after approval. Keep exports encrypted/private, document the snapshot time and check missing writes since the snapshot. Never commit backups or health records. Snapshot creation/retention and a hosted restore drill are release prerequisites, not features provisioned by this PR.
