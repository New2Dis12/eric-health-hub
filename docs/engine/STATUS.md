# Stunna Intelligence Engine — Current Status

**As of:** 2026-11-03
**Status:** Preview acceptance PASS within recorded coverage. Owner authorized production release preparation, with Stunna disabled and no merge/deployment. Four Production entries are now staged; production Auth0 client secret and URL registration remain pending. **NO-GO for merge/deploy until preparation is complete and separately approved.**
**Branch:** `feature/stunna-sprint-1`, based on `main` commit `3d204e7` (merged Sprint 0 docs).
**PR:** [#6 — Sprint 1 secure persistence](https://github.com/New2Dis12/eric-health-hub/pull/6) — open, unmerged.
**Production:** live deployment unchanged. Owner-authorized release preparation added four new Production environment entries only. No merge, production deployment, change to existing Auth0 MCP client/API configuration, provider-token change, training import or real personal-data write was performed. A separate protected Preview was deployed with explicit owner approval. The owner separately configured the unused Default App for browser login. Separate owner-authorized Neon setup is recorded below.

## External setup progress (2026-11-03)

- Connected Neon and confirmed no pre-existing projects. Created one training PostgreSQL 17 project on the existing Neon Free organization in AWS us-east-1; no Vercel project or replacement identity provider was created.
- Created isolated `sprint-1-acceptance` database branch. Main remains an empty baseline; migration `001_foundation` and its exact SHA-256 checksum were applied transactionally only to the acceptance branch.
- Created a separate SQL-defined `stunna_runtime` login. Verified NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT and no administrator/owner memberships. A preliminary unused API-created role was replaced before schema setup because Neon management-created roles are privileged by default.
- Applied the repository runtime grants. All seven training/ancillary tables enforce FORCE RLS, are owned by the separate migration owner, and deny runtime DELETE. No records were inserted during schema setup. Subsequent hosted acceptance inserted synthetic training fixtures only.
- Created a baseline snapshot of the empty main branch. Neon snapshots of child branches are unsupported; a later logical export/restore drill passed for the complete acceptance schema and synthetic records (details below). Provider snapshot/PITR recovery remains unverified. Current project recovery history is six hours; long-term backup policy remains a release decision.
- Runtime acceptance credentials were generated and retained privately in ignored local configuration, mode 0600. No secret values or connection strings were added to chat or GitHub. The restricted database URL and a fresh browser-session secret are now stored as sensitive Vercel variables scoped only to PR #6 Preview; no migration-owner URL was uploaded.
- Connected the existing Vercel project and added seven variables scoped only to `feature/stunna-sprint-1` Preview: restricted DATABASE_URL, new AUTH0_SECRET, existing tenant domain, planned branch APP_BASE_URL, disabled Stunna/Garmin flags, and an empty branch-specific Upstash write-token override. This prevents the acceptance preview from reading or refreshing the production token store. All original variable IDs/settings and the current production deployment remain unchanged. No deployment was created at that setup step.
- Owner converted the existing unused Auth0 Default App to a Regular Web Application and reported saving the exact Preview callback/logout URLs. Both MCP applications remain unchanged. Public client ID is configured; the owner copied the client secret and authorized User ID directly from Auth0 into branch-specific sensitive Vercel entries. Metadata confirms both placeholders were updated; their secret contents were not read. Subsequent owner-assisted login and authenticated API access verified the browser configuration.
- Historical pre-preview checkpoint: all ten required branch-specific entries exist and target Preview only. No deployment exists for this Git branch, the production deployment is unchanged, all seven database tables enforce FORCE RLS, the runtime remains restricted, the acceptance database has zero athlete/session/measurement rows, and the baseline snapshot exists.
- Owner approved protected Preview-only deployment; it is now READY and its branch URL matches APP_BASE_URL. Stunna is enabled only for this Preview. Live Health Hub v2 regressions passed. After a Vercel tool-access 403, the owner completed protected browser login and ran the guarded synthetic acceptance script successfully. No merge, promotion or production deployment is authorized. See the checkpoint below; merge remains **NO-GO**.

## Hosted acceptance checkpoint — owner-assisted browser checks passed

Owner approved protected Preview-only deployment and tests, with no merge/production changes. Deployed application source is `be29d231b973493be07b63990aebfb800ce7f91b`, deployment `dpl_3tEW5bpZMRKQvuPum1q9gqRsfzJr`. The existing project's protected Preview is https://eric-health-hub-git-feature-stunna-sprint-1-stunna4.vercel.app . `STUNNA_ENABLED=true` is scoped to that branch's Preview. The later commit adding `scripts/browser-preview-acceptance.js` changes only the test harness, not deployed application behavior. This status update does not deploy anything.

| Hosted check | Result |
|---|---|
| Preview build / correct application commit / branch URL | PASS |
| Existing production deployment and settings preserved | PASS at deployment checkpoint |
| Existing Health Hub v2 Oura summary | PASS — live tool returned expected summary schema |
| Existing Garmin listing and original FIT telemetry | PASS — original FIT available, bounded decoded telemetry returned |
| Running dynamics | PASS — GCT, vertical oscillation, GCT balance and vertical ratio populated across 12 samples |
| Native Garmin laps / independent pagination | PASS — native laps and separate sample/lap continuation offsets returned |
| Protected Preview access by agent connection | UNAVAILABLE — Vercel tool returned 403 before application access |
| Real Auth0 login/callback and authenticated read | PASS — owner signed in and reported HTTP 200 with initially empty history |
| Synthetic persistence browser suite | PASS — owner screenshot shows final PASS for all scripted assertions |
| Invalid bearer GET/POST despite valid browser session | PASS — both returned expected 401 |
| Browser logout and signed-out API denial | PASS — owner confirmed sign-out and subsequent /api/training response {"error":"Unauthorized"} |
| Independent database/audit verification | PASS — synthetic counts and session revision history verified read-only |
| Hosted runtime cross-subject denial | PASS — restricted runtime saw zero rows in all seven tables, INSERT denied and UPDATE touched zero rows |
| Different real Auth0 account login | NOT RUN — local encrypted wrong-account session regression passed |
| Hosted negative CSRF test | PASS — signed-in form probe returned Invalid request origin; owner confirmed Network HTTP 403 and Origin: null |
| Hosted logical recovery / restore drill | PASS — fresh database, exact seven-table/ledger comparison, restored grants/RLS and runtime read/write/rollback |
| Provider snapshot/PITR restore | NOT RUN — child-branch snapshots unavailable; logical restore tested instead |

The synthetic browser suite verified atomic session-plus-measurement writes, exact replay, conflicting idempotency keys, stale revisions, missing-plan rollback, invalid units, concurrent duplicate completion, audited correction, completed-session protection and no-store responses. Final history had one block, one plan, one session and one measurement, with session revision 3. Independent Neon aggregate verification found one athlete, six audit events and five idempotency records. Actual-session audit transitions were null→1→2→3, once each. Only synthetic fixtures were written.

The red browser-console 409/404/400/401 responses are intentional negative tests and were asserted by the script before its final PASS. The Preview's Oura token-storage error is expected from the branch-only empty Upstash token override, which isolates this Preview from production provider tokens. Existing live Oura was checked separately. Do not reconnect Oura or copy production tokens into the Preview to remove that message. The sampled FIT had no power values, so only the nullable power column was verified.

The earlier Vercel protected-fetch connection failed at `read_protection_bypass` with 403. A later retry was rejected by automatic approval review because the fetch tool creates/reuses a share link lasting up to 23 hours. No share link was created, no protection setting was changed, and the safer owner-assisted browser path remains in use. The initial fetch/no-referrer CSRF probe returned 400 Invalid training command. The owner inspected Network and confirmed Chrome retained the exact valid Preview Origin. This was an ineffective test setup, not evidence of a CSRF vulnerability or a hosted rejection pass. Replaced the probe with an invalid text/plain form submission under no-referrer policy; the owner returned Invalid request origin and confirmed Origin: null and HTTP 403 in Network. JavaScript syntax validation passed. Local browser execution was unavailable because the browser binary download failed. Hosted CSRF rejection is now verified. The invalid text/plain probe cannot create training records.

Earlier SQL SET ROLE and direct-network limitations were resolved by the Neon connector's explicit `role_name: stunna_runtime` option. Tests connected directly as the existing restricted role without changing its grants. The unauthorized identity read zero rows from every table, a foreign-athlete INSERT raised insufficient_privilege, and an UPDATE affected zero rows. The original acceptance counts remained unchanged.

## Hosted recovery drill (2026-11-03, Chicago)

- Exported one consistent SQL statement's JSON view of all seven acceptance tables and the migration ledger at 2026-11-04T03:01:17Z (2026-11-03 21:01:17 CST). The private export stayed in transient tool memory and was not posted in chat or committed.
- Created `sprint-1-recovery-drill` (`br-green-heart-bc6ghc9o`) from the acceptance branch within the existing Neon project. Created a separate **empty** database `stunna_recovery` on that branch. The branch clone alone was not counted as a restore.
- Recreated the schema from the exact repository migration and transactionally restored exported rows into the empty database, including audit events, idempotency results and the migration ledger. Reapplied repository runtime grants. Migration checksum matched `bdd093446f714a831a4a1a5bbb9d1c3f14bb50d61999a09b4a3ecc3c821a8862`.
- Compared every restored row/value in all seven tables and the ledger against the private export. All eight comparisons matched exactly. Counts were 1 athlete/block/plan/session/measurement, 6 audit events and 5 idempotency records.
- Verified all seven restored tables have FORCE RLS, migration-owner ownership, runtime SELECT/INSERT and no runtime DELETE. The runtime retained NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE/NOINHERIT and zero memberships.
- As the restricted runtime, verified authorized readback and a synthetic measurement INSERT/readback/rollback probe. No probe row remained. Changed to an unauthorized subject and confirmed zero rows. A separate transaction confirmed subject state cleared and no rows were visible without identity.
- Rechecked original acceptance counts and revision 3, and confirmed the main database still has no training schema. Production domain still resolves to `dpl_EpDV7NVJpJYkYDkeWNK3t8H3bHrX`.
- Retained the private recovery branch/database for review. No database URL was switched and no deployment was created. A custom suspend-timeout request was rejected by the Free plan; branch creation succeeded with default settings. An initial multi-command prepared-statement attempt rolled back; splitting the same migration into statements restored successfully.

**Recovery limits:** this was a logical export/schema/data restore, not provider snapshot/PITR, an automated scheduled backup, or an application deployment pointed at the restored database. Private durable backup scheduling/retention and production release configuration still need a release decision. Child-branch provider snapshots remain unavailable. Do not treat the empty-main snapshot as a backup of acceptance records.

**Acceptance conclusion:** the owner-assisted hosted CSRF check passed. No unresolved application failure was found in the completed Preview checks. A second real Auth0 account has not been exercised on Preview; local encrypted wrong-account tests and hosted database cross-subject tests passed. Keep production and the empty main database untouched. Do not rerun the create-fixture script against the now-populated acceptance branch. No merge or production deployment is authorized.

## Completed in Sprint 1

- Read PRODUCT, ARCHITECTURE, ROADMAP and STATUS on `main` before implementation.
- Added Auth0 SDK browser login with encrypted HttpOnly/Secure/SameSite cookies, PKCE/state/nonce verification, exact allowlisted subject, absolute session expiry and generic failure responses. Only `/auth/login`, `/auth/logout`, `/auth/callback` are mounted; the SDK does not intercept `/mcp` or provider routes.
- Gated homepage data retrieval before Oura/Redis access. Protected Oura test/connect/callback and Garmin diagnostic route. Public legal pages and OAuth metadata remain public.
- Added PostgreSQL server-only pooled runtime connection with verified remote TLS, restricted-role checks, transaction-local identity and FORCE row-level security.
- Added typed athlete, training block, planned session, actual session, body measurement and change-audit models. Versioned SQL migration and guarded rollback include migration checksums/transaction lock; runtime grants separate owner and application privileges. No data seeded.
- Added shared authorized read/write services and `/api/training` GET/POST, disabled unless `STUNNA_ENABLED=true`. Strict input validation, streamed 16 KiB body limit, bounded history, explicit units/timezones, atomic measurement+session+audit writes, idempotent retries, optimistic revision conflicts and unique finalization are covered.
- Kept existing MCP tool names, schemas, Auth0 bearer behavior, Garmin/FIT implementation, Oura data/refresh implementation and Upstash keys unchanged. Added synthetic regressions for those boundaries.
- Added [SPRINT_1_OPERATIONS.md](SPRINT_1_OPERATIONS.md) and `.env.example` with minimum owner setup, synthetic acceptance checks, grants, backup/restore and rollback instructions. Removed the pre-existing build option that skipped TypeScript errors. Added this branch to Vercel's Git deployment-disabled list.

## Verification results

| Check | Result |
|---|---|
| Baseline `pnpm test` / typecheck | 28 existing tests passed; typecheck passed before changes |
| Frozen dependency install | Passed; dependency lock updated for Auth0 SDK, pg, types and PGlite |
| Final `pnpm test` | **49 passed, 0 failed, 0 skipped** |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed, including TypeScript validation; homepage/private APIs remain dynamic |
| Built-app local HTTP smoke | Passed: anonymous homepage sign-in surface, Oura private routes and training GET/POST denied, all MCP methods retain OAuth challenge, browser token endpoint 404, public legal/metadata routes 200 |
| Diff whitespace / sensitive-content review | Passed; fixtures are generated/synthetic, no live credentials or health records |

Security coverage includes encrypted valid/wrong-account/expired/tampered cookies, real simulated Auth0 code callback, PKCE and secure-cookie flags, anonymous provider-route denial before network access, JWT signature/issuer/audience/expiry/subject checks, separate read/write training scopes, CSRF origin denial, invalid input and bounded bodies. Existing MCP scope and tool discovery pass with browser and database configuration absent.

Database integration uses PostgreSQL-in-WASM (PGlite), actual migrations/runtime grants/RLS and service SQL. Tests prove atomic browser/API measurement+session persistence, exact replay, conflict handling, forced rollback after audit failure, cross-athlete denial and up/down/up migration execution. PGlite serializes transactions. Subsequent owner-assisted hosted acceptance exercised pooled application persistence and concurrent duplicate requests, and real Auth0 login/logout. Those hosted results are recorded separately above. Hosted runtime cross-subject isolation and logical recovery now passed. Hosted negative CSRF passed. A different real Auth0 account and provider snapshot/PITR remain unverified.

## Production impact to review

1. **Intentional access change:** website data and Oura connect/callback require Auth0 browser login after deployment. Until browser config is present, they fail closed; MCP remains independent and operational.
2. **Diagnostic compatibility change:** `/api/garmin/test` now needs Auth0 browser identity or `garmin.read` bearer authorization **in addition to** `x-garmin-test-secret`. Secret-only diagnostic callers need updating. This does not alter Garmin MCP, token cache, FIT, laps or running dynamics.
3. **Additive dependencies/migration:** Auth0 SDK and pg enter the existing app; PostgreSQL is initialized lazily only for enabled training requests. Migrations never execute during build/startup. Existing provider data and Upstash are not migrated.
4. **Release guard:** no Vercel project or integration created. Branch Git deployment is disabled in `vercel.json`. Human approval is still required before any preview, production deployment or merge.
5. **Rollback:** disable Stunna independently while retaining authentication; code rollback leaves additive training tables intact. Full rollback restores the old website exposure, so restrict website access during recovery. Destructive schema rollback needs a private snapshot and explicit operator flag; it never touches provider tokens.

## Outstanding owner prerequisites / acceptance limits

- Hosted runtime cross-subject RLS and owner-assisted negative CSRF checks passed. Different-real-Auth0-account denial remains covered locally only.
- Logical recovery verification passed with exact restored schema/data/ledger and restricted runtime checks. Establish durable private backup scheduling/retention before production release. Provider snapshot/PITR recovery was not tested.
- Browser Auth0 and restricted pooled PostgreSQL access work on the approved Preview. Production browser URLs/environment configuration and any production training database setup require a separate approved release plan. Website access fails closed if browser configuration is absent after release.
- Existing Health Hub v2 live read-only regressions passed. Provider access is intentionally isolated in Preview. Existing MCP client/audience/grants and Garmin/Oura/Upstash credentials remain unchanged.
- `training.read`/`training.write` scopes are enforced but not provisioned for external clients. Browser sessions do not require these bearer grants. Do not modify existing ChatGPT MCP clients for a training test.
- No known unresolved automated-test failures. **Preview acceptance PASS within the recorded coverage. Immediate merge NO-GO because production browser authentication is not configured.** If provider-managed snapshot/PITR is the chosen production recovery method, verify that method separately. Merge and production deployment each require the owner's separate approval.

## Final release-readiness review

A read-only Vercel environment metadata review on 2026-11-03 confirmed `hiddenProductionEnvCount=0`. The existing production `AUTH0_DOMAIN` and `AUTH0_ALLOWED_SUB` entries are present. Four required browser variables exist only on the PR Preview branch and are absent from Production: `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, and `APP_BASE_URL`. No values were decrypted or changed. Production callback/logout registration on the existing browser application is also unverified.

The application requires those four values to initialize browser authentication. Deploying the PR as currently configured would prevent website login and authenticated Oura browser flows. Existing MCP configuration is independent and its tools remain unchanged. `vercel.json` disables Git deployment for this feature branch but does not disable `main`, so a merge must not be assumed to be deployment-free.

**Recommendation:** keep PR #6 open. Before an approved merge, prepare production browser configuration and its exact callback/logout URLs, or explicitly hold automatic production deployment under an approved release plan. Production training activation additionally requires its own restricted database, migrations/grants and durable backup policy; the synthetic acceptance database must not become production. Stunna can remain disabled while those training-release prerequisites are prepared. Do not copy the Preview's blank Upstash override or Garmin-disable setting into Production. No merge, deployment, production environment change or production database write was performed.

The initial CSRF fetch script was an agent test-design error: Chrome retained the legitimate Preview Origin and returned input-validation 400. The corrected form probe demonstrated actual origin rejection. Only scripts and acceptance documentation changed after the tested application source commit. Existing application test/typecheck/build results remain valid for that unchanged source; corrected script syntax was checked separately.

## Production preparation checkpoint (owner-authorized, no deployment)

The preceding release-readiness review records the state before this preparation step. On 2026-11-03 the owner authorized Production configuration preparation, explicitly keeping `STUNNA_ENABLED=false` and requiring separate merge/deployment approval.

- Verified `eric-health-hub.vercel.app` is the existing project's verified production domain. The live rollback target remains READY deployment `dpl_EpDV7NVJpJYkYDkeWNK3t8H3bHrX`.
- Added Production-only `APP_BASE_URL=https://eric-health-hub.vercel.app`, `STUNNA_ENABLED=false`, and the existing Default App's public `AUTH0_CLIENT_ID`.
- Generated a fresh 32-byte production-only `AUTH0_SECRET`, stored as a sensitive/Secret variable. It was not copied from Preview, printed, or committed.
- Re-read metadata and verified every previously existing environment entry retained its ID, scope and update timestamp. No MCP, Garmin, Oura or Upstash entry was edited. Neither Preview's blank Upstash token nor its Garmin-disable override was copied.
- Still pending: owner registers the production callback `https://eric-health-hub.vercel.app/auth/callback` and logout `https://eric-health-hub.vercel.app` on the existing Default App, retaining Preview URLs. There is no Auth0 management connector available; dashboard confirmation is required.
- Still pending: owner copies that same Default App's existing client secret directly from Auth0 into a Production-only Vercel Secret named `AUTH0_CLIENT_SECRET`. No secret should pass through chat or GitHub; no client-secret rotation is needed. The sensitive Preview value is not read back or reused through tooling.
- Production Auth0 domain and allowed subject retain their pre-existing values. Hosted production login cannot be verified before a separately approved deployment. URL/settings and environment metadata can be reviewed beforehand.

### Reviewed rollback plan

Before release, retain the current deployment ID above and record the new deployment ID. A failed approved release should be rolled back to the retained known-good deployment only with the owner's rollback approval. This preserves the existing vendor/MCP implementation. The old version restores its former unauthenticated website exposure, so protect website access during that recovery without blocking MCP. Do not delete or rotate provider tokens. No database rollback is needed for an auth-only release while Stunna is false.

A training-only problem after future activation can be contained by setting Stunna false and redeploying with approval, retaining browser auth and additive tables. Do not run destructive schema rollback during ordinary application recovery.

### Required before production Stunna activation

1. Use the existing Neon project with a clean production database/branch, isolated from the synthetic acceptance and recovery branches. The existing empty main branch is a candidate, but no migration or production data write has been authorized/performed in this preparation step.
2. Create a distinct migration owner and SQL-created restricted production runtime login, with a fresh production credential. Apply the exact versioned migration/checksum and runtime grants. Verify FORCE RLS, no runtime ownership/BYPASSRLS/admin memberships and verified TLS. Store only the pooled runtime URL as a Production Secret; never place migration-owner credentials in Vercel.
3. Establish durable private backup retention and a recovery objective. The current six-hour history and empty-main baseline snapshot do not constitute a production backup policy. Select a supported provider backup/PITR plan or scheduled encrypted logical exports, approve any paid change separately, and test the chosen method in an isolated restore destination including schema, grants, audit/idempotency records and exact counts.
4. Complete production-configured synthetic persistence/isolation and recovery validation under explicit approval, then approve Stunna activation separately. Keep production Stunna false and production DATABASE_URL absent until that plan is approved. Do not import health/training records during setup.
5. Preserve existing MCP/provider configuration and repeat bounded Health Hub v2 regression checks after any separately approved release.

Final release checklist and separate merge/deployment approval request will follow after the two owner steps above and metadata verification. Configuration changes alone do not authorize release.

## Sprint 2 handoff

Do not infer existing prescriptions or import personal training Markdown into GitHub. After Sprint 1 review and hosted auth/database acceptance, implement Sprint 2: review/import the authoritative current block, schedule, exercise/interval targets, baselines, preferences and correction history into private PostgreSQL; add the mobile Today/calendar surfaces and a scoped read-only `get_training_context` MCP tool using the shared service layer. Preserve existing MCP tools and health integrations. No set-player logging, Garmin auto-matching, analytics or coaching plan-approval workflow was implemented early.

The Sprint 1 block/planned-session models are minimal and append-only. Add exercise prescription/preferences/approved-revision entities through a new migration. Actual-session correction currently covers notes/RPE only after completion; measurements have no correction endpoint yet. Audit records track actor/reason/source/entity/revisions, not old health-value snapshots. Offset history is bounded and intended as a diagnostic foundation; design cursor pagination before large history use. Never treat an in-progress session as a verified completed workout or infer missing exercise targets.

Suggested next prompt:

> Implement Sprint 2 of Stunna Intelligence Engine in `New2Dis12/eric-health-hub` using the current engine docs and Sprint 1 services. First verify Sprint 1 has been approved and its hosted auth/database acceptance is complete; report any remaining blocker before importing data. Review the authoritative training sources, add versioned private prescription/preferences storage and mobile Today/calendar views, then expose scoped read-only `get_training_context` without changing existing Health Hub v2 tools. Test, typecheck, build, update STATUS, and open an unmerged PR. Do not deploy without approval.
