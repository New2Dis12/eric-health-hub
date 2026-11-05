# Stunna Intelligence Engine — Current Status

**As of:** 2026-11-05
**Sprint 2:** Squash-merged and released with Stunna disabled. Final iPhone interface approved; final checks and bounded Production functional verification passed. Sprint 3 is plan-only, pending owner review.
**Review:** [PR #7](https://github.com/New2Dis12/eric-health-hub/pull/7).
**Sprint 1 production:** PR #6 was squash-merged and Vercel deployment `dpl_62ywMnN3hzybcUJgpyZtxz3vJfQz` was verified READY. Production Auth0 login/callback/logout, signed-out denial, Garmin original FIT/dynamics/native laps and Oura passed. Production Stunna is disabled and production training data remains unconnected. The detailed release record from the Sprint 1 branch is preserved below.

## Sprint 2 Production release — 2026-11-05 (Chicago)

Owner approved the final protected iPhone Preview, PR #7 squash merge and normal Production deployment with `STUNNA_ENABLED=false`. PR #7 merged into `main` as `3c579fd2ffb621791fe0f0849aca334d98882f27`. The existing Vercel project automatically built that exact commit as READY Production deployment `dpl_E2bjsX5rQakjhk5DmryW8DMKTzd3` and assigned `eric-health-hub.vercel.app`. [Release deployment](https://vercel.com/stunna4/eric-health-hub/E2bjsX5rQakjhk5DmryW8DMKTzd3).

| Final check | Result |
|---|---|
| PR review | No merge conflicts, unresolved review threads or material security blocker found. No further UX changes. |
| Automated verification | All 58 tests passed, zero failures/skips. `npm run typecheck`, `npm run build` and diff whitespace checks passed on final application code; subsequent changes are documentation only. Includes legacy health tools, token refresh, Auth0/CSRF, RLS/isolation, migrations and shared prescription reads. |
| Production configuration | `STUNNA_ENABLED=false`; no Production `DATABASE_URL`. Environment IDs, types, scopes and update timestamps match the pre-release snapshot. No Production database migration, provider-credential change, Auth0 scope expansion or personal-record import. |
| Auth0 login/callback | PASS. Production Sign in reached the existing Default App and tenant with callback `https://eric-health-hub.vercel.app/auth/callback`. Owner completed secure Google authentication; browser returned to Production with Sign out and connected Oura visible. No credentials were read or committed. |
| Auth0 logout and private homepage | PASS. Sign out returned to the private sign-in screen. Anonymous homepage contained no health values. Logout uses `https://eric-health-hub.vercel.app` as its post-logout destination. |
| Disabled training | PASS. `/app` and `/api/training` returned 404; Stunna link absent on the signed-in Health Hub. No production training database is required or contacted. |
| Unauthorized provider/MCP access | PASS. Signed-out Oura test/authorize returned 401. Garmin diagnostic returned 404 without its diagnostic secret. Anonymous `/mcp` returned 401 with bearer challenge. Public privacy/terms returned 200. |
| Existing authenticated MCP tools | PASS. Existing Health Hub v2 Garmin listing and Oura summary tools responded. All four Oura summary fields were populated; browser also showed Oura connected/API success. |
| Garmin original FIT | PASS. Bounded original FIT download/decode returned 12 samples with timestamps, heart rate, speed/pace, cadence and distance. Power was absent in this source and stayed null. |
| Running dynamics and native laps | PASS. Ground contact time, vertical oscillation, balance and vertical ratio populated; two native laps returned. Independent continuation returned two more samples and one more native lap. No activity identifiers or personal values are included here. |

**Release assessment:** GO for the approved disabled-feature release. Health Hub v2 remains operational within the checks above. No critical functional failure or rollback occurred. Stunna activation remains NO-GO pending its separate database, backup, scope/parity and owner-approval gates.

### Remaining limitations and recovery

- Hosted `get_training_context` discovery/call parity remains blocked by test-token configuration requiring explicit `training.read`. The owner approved deferral for this release. Local browser/API shared-reader parity and tool scope/flag tests pass; complete the real hosted test before activation. Do not expand Production Auth0 grants to resolve it now.
- The owner approved the final iPhone layout. The read-only browser acceptance console harness has not been reported as run; do not conflate visual approval with that automated hosted result.
- Vercel runtime error-log retrieval returned 403; no independent runtime error scan can be claimed. No CLI credential fallback is configured. Deployment metadata, direct HTTP/browser checks and live tools provide the recorded functional coverage.
- A callback requested without any OAuth transaction/code returned the Auth0 SDK's 500 response and did not authenticate. The genuine signed-in callback passed. Consider friendlier malformed-callback error handling separately; it is not a regression introduced by Sprint 2.
- Production training remains unconnected and unmigrated. Before activation, prepare a clean database, restricted runtime role, reviewed migrations/grants/FORCE RLS, durable private backups and an isolated restore drill. Real-record import and activation require separate approval.
- Rollback candidate is the preceding verified Sprint 1 deployment `dpl_62ywMnN3hzybcUJgpyZtxz3vJfQz`. Stop on a critical regression and request owner approval before rollback. Preserve existing credentials/tokens and additive schema; do not run destructive down migrations for application recovery.

### Sprint 3 readiness

[Sprint 3 implementation plan](SPRINT_3_PLAN.md) is prepared for review only. It covers actual strength sets/reps/loads/RPE, ordered interval actuals, confirmed adjustments, reliable save/resume, audited corrections and idempotent completion, plus shared app/MCP reads and logging. Preserve the approved calendar/inline overviews, immutable prescriptions, one coaching conversation, existing methodology and one PostgreSQL truth. No Sprint 3 application, migration or scope implementation has begun.

This post-release documentation is published to main so the next sprint sees the complete handoff. Its normal Git-triggered build, if created, contains identical application code to the release above; verify the resulting deployment metadata rather than treating it as a new feature release. The earlier Sprint 2 Preview and unmerged checkpoints below are historical.

## Sprint 2 — Stunna Workout Interface

- Private, responsive `/app` in the existing Health Hub, with Today, week calendar, day/week navigation, ordered exercises, prescriptions, rest, prior comparable performance and explicit empty/missing states.
- Migration `002_prescriptions` adds append-only approved prescription snapshots with reasons, athlete display preferences, and reviewed prior-performance benchmarks. Stable exercise keys link comparisons. Session order follows saved times and exercise order follows the snapshot array. The existing Sprint 1 planned-session revision remains independent of the approved prescription revision.
- The browser and read-only `get_training_context` MCP tool use the same server service. The tool requires the allowlisted subject, `training.read` and `STUNNA_ENABLED=true`. Existing Oura and Garmin tool grants remain independent. The page requires an authorized Auth0 browser session. The server limits results to one week and the first eight workouts on the selected date, with an explicit overflow indicator.
- Production configuration and integrations were preserved. The branch is excluded from Vercel Git deployments. Sprint 3 set entry and RPE logging, a plan approval editor, and real Markdown import are deferred.

## Sprint 2 verification

| Check | Result |
|---|---|
| `pnpm test` | 58 passed, 0 failed, 0 skipped. Covers corrected revisions, previous performance, timezone/calendar behavior, cross-subject RLS, read-only permissions, migration down/up and MCP scope/flag discovery. |
| `pnpm typecheck` and `pnpm build` | Passed. `/app` is server-rendered on demand. |
| Built-app HTTP smoke | Disabled `/app` and training returned 404. Enabled signed-out `/app` showed only the private sign-in screen, training returned 401, and MCP retained 401. |
| Hosted Neon development checks | Applied both migrations and ledger entries to `sprint-2-development` (`br-patient-cell-bcl0go17`) in the existing project. The restricted runtime saw 3 scheduled workouts, 3 revisions, 2 benchmarks and 1 preference row for the synthetic subject. Revision 2 had the corrected 40 lb target. All 3 new tables enforce FORCE RLS with read-only runtime grants. An unrelated subject saw zero rows. |

Hosted browser login and ChatGPT discovery for Sprint 2 await an approved protected Preview. The isolated database contains only synthetic fixtures. The demonstration and approval steps are in [Sprint 2 operations](SPRINT_2_OPERATIONS.md).

## Methodology review and protected Preview checkpoint

Reviewed the four privately supplied methodology references without importing their records. [Model assessment](SPRINT_2_MODEL_REVIEW.md) documents the fit and scope boundaries. The model now supports typed target ranges, target RPE, warm-ups, ordered repeated interval blocks, optional exercises, equipment conventions, conditional alternatives, and versioned weekly guidance. Migration 003 preserves the applied migration 002 checksum and defaults prior evidence to unverified until explicitly reviewed.

Hosted restricted-role checks on the same Sprint 2 development branch passed. The synthetic subject has six dated workouts, including two on the combined training day, seven prescription revisions and one block-context revision. Four new read-only tables enforce FORCE RLS; an unrelated subject saw zero prescriptions and weekly guidance. Added a separate synthetic fixture for the authorized browser identity so the signed-in Preview can read demo content. No supplied personal prescriptions or health history were imported.

Preview config is scoped to `feature/stunna-sprint-2` in the existing Vercel project. The existing Default App and tenant are reused. Nine entries were prepared, including a fresh session secret, the isolated runtime database URL, Stunna enabled only for Preview, and vendor-token isolation. The owner has saved the Default App client secret as a Preview-only branch Secret and reported registering the exact Preview callback/logout URLs. Existing Production entries and the Sprint 1 Preview entries were not edited. Production Stunna stays false.

The Preview remains under Vercel Authentication. Hosted browser and MCP acceptance remain pending until callback/client-secret configuration and a scoped test token are available. The local build initially encountered a corrupt Turbopack cache; a clean rebuild passed. Subsequent model changes are covered by the final checks reported with the Preview.

## Approved Sprint 2 Preview deployment

Protected Preview: https://eric-health-hub-git-feature-stunna-sprint-2-stunna4.vercel.app/app

Initial Vercel deployment `dpl_91Tngocs3ZdY9LCXVNdCmtrJd3jj` was superseded by refreshed protected Preview `dpl_FBYmXCx3q6u2DnjCehugZyfGx3i9`, READY on source commit `19e7e98f0d73f41d076fd8986cd9aab28c3ff4eb`. Application code matches tested `de72fa6`; intervening changes are documentation only. The existing project uses Vercel Authentication for Preview deployments, and the exact branch alias is assigned. Production remains READY deployment `dpl_62ywMnN3hzybcUJgpyZtxz3vJfQz` at the Sprint 1 commit. Existing Production environment metadata was re-read and is unchanged, including `STUNNA_ENABLED=false`. Sprint 1 Preview entries were also preserved.

Final local verification passed 58 tests, typecheck, and build. Hosted restricted runtime verified the two-workout combined day, seven synthetic prescription versions, one methodology revision and four read-only FORCE RLS tables per subject. An unrelated subject saw zero prescriptions and guidance. All fixtures are synthetic. The supplied four files were used only to evaluate the model.

The owner reported saving the Preview Auth0 settings. Metadata showed the newly added `AUTH0_CLIENT_SECRET` was scoped to all Preview branches. Its scope was narrowed to `feature/stunna-sprint-2` without reading or replacing its value. Re-read metadata confirms type sensitive/Secret, target Preview only and the exact branch. The Production client-secret entry and all other Production environment metadata remain unchanged.

The approved Preview was refreshed so it receives that secret. The exact branch alias resolves to the new READY deployment. Callback/logout registration is owner-reported saved; real login/callback/logout and signed-in page acceptance still require the owner's browser session. No protected share link or deployment-protection bypass was created.

A syntax-checked, read-only [browser acceptance script](../../scripts/browser-sprint-2-acceptance.js) exercises five dated pages, expected workout titles/counts, approved revisions, strength and interval targets, missing prescriptions and selected calendar state. It prints only pass/fail with synthetic dates. Its hosted result remains pending. Hosted MCP parity still requires a scoped test token. PR #7 remains open and unmerged.

iPhone review routes after configuration:
- `/app?date=2026-11-04` — strength, approved correction and previous evidence.
- `/app?date=2026-11-05` — ordered run plus strength, work/recovery segments, rep/RPE ranges and an authored substitution.
- `/app?date=2026-11-06` — distance-based rowing, seconds/500m and strokes/min.
- `/app?date=2026-11-07` — explicit missing prescription.
- `/app?date=2026-11-08` — cycling watts and rpm.

Hosted MCP discovery/call also awaits an authorized test token with `training.read`; no existing Production MCP grant or client setting was changed. Keep PR #7 unmerged until signed-in app/MCP parity and owner iPhone review pass. Weekly recurrence materialization, coaching proposal/approval decisions, automatic recovery adjustments and actual-set logging remain future work. See [the model assessment](SPRINT_2_MODEL_REVIEW.md).

## Calendar and inline Workout Overviews

The final owner-requested UX is Calendar → Workout Overview → Start Workout, with Calendar and Workout Overview on the same screen. `/app` defaults to Today, and selecting a date immediately renders every scheduled workout's overview below the calendar. The intermediate card and workout-selection navigation were removed. Older URLs carrying a workout parameter still display that date's overviews.

The existing calendar, dark green/lime design and clock-free presentation are retained. Each overview shows objective, saved rationale, duration estimate, intended intensity, major exercises/interval structure and adjustment/substitution rules. Prescribed details and previous performance remain collapsed by default. Each workout has an independent disabled Start Workout action at the bottom, with a unique accessible status description.

This refinement changes presentation only. The existing shared service and authored overview metadata remain the source of truth, and database records were not changed. Browser authentication and the Stunna flag still guard the route. All 58 tests, typecheck and build passed. The read-only browser acceptance script now checks Today, calendar selection, all inline overviews, collapsed details, absence of card navigation/clock times/data entry, and independent disabled Start Workout controls across six synthetic workouts.

The refreshed protected Preview is READY: [open Stunna](https://eric-health-hub-git-feature-stunna-sprint-2-stunna4.vercel.app/app). Deployment `dpl_jbjZ3MFLQzexpptsnVFtUxj2jBBT` serves application commit `2415b5bdfaf17651d4b03dceb7b6f686397198ea` and owns the Sprint 2 branch alias. Signed-in visual acceptance of this final inline layout and the read-only browser script remain pending owner review; deployment readiness does not establish those results. PR #7 remains open and unmerged.

After refresh, Production still serves Sprint 1 deployment `dpl_62ywMnN3hzybcUJgpyZtxz3vJfQz` at commit `c6d11c3fcba9651ac40420a6f197866e08ee2a92`. Production environment IDs/scopes/update timestamps match the pre-refinement snapshot, and `STUNNA_ENABLED=false`. No database, credential, provider integration or Production deployment change was made.

## Final Sprint 2 release review — 2026-11-05

The owner completed the protected iPhone Preview review and approved the final interface and squash merge of PR #7, with normal Production deployment and `STUNNA_ENABLED=false`. No further UX changes were made. Final application source `2415b5bdfaf17651d4b03dceb7b6f686397198ea` and documentation head `035d73f04b04976a2fa553af4263e78c9acff17f` passed all 58 tests, typecheck and production build in the release review. GitHub reported mergeable with no unresolved review threads. The focused review found no material security blocker: training routes/tool remain flag-gated, browser and bearer authorization remain separate, database access is subject-scoped, and legacy health-tool behavior has regression coverage.

Production metadata was checked before merge: Stunna is false; no Production DATABASE_URL exists; browser-auth variables are present; existing health/provider/MCP environment entries are unchanged. No Production database migration, personal-record import, scope expansion or Stunna activation is authorized.

Owner visual approval is recorded; the console browser acceptance harness was not reported as executed. Hosted `get_training_context` discovery/call parity remains blocked by an authorized test token with explicit `training.read`. Local browser/API principal parity tests pass. The owner expressly approved deferring hosted parity until before activation, so this limitation does not block the disabled-feature release. Earlier unmerged/pending-review checkpoints below are historical.

Merge commit and resulting Production deployment and functional checks will be recorded after the release. Sprint 3 is plan-only until owner review; it must retain one ChatGPT coaching conversation, one Stunna app and one shared PostgreSQL truth, preserving the existing methodology and prescribed-versus-actual separation.

## Sprint 1 release history

The following checkpoints preserve the Sprint 1 acceptance, recovery, configuration and production verification record. Pre-release notes describe the state at those checkpoints.

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
- Owner approved protected Preview-only deployment; it is now READY and its branch URL matches APP_BASE_URL. Stunna is enabled only for this Preview. Live Health Hub v2 regressions passed. After a Vercel tool-access 403, the owner completed protected browser login and ran the guarded synthetic acceptance script successfully. No merge, promotion or production deployment is authorized. See the current release-readiness review below; merge/deployment remain unapproved.

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
- No known unresolved automated-test failures. **Preview acceptance PASS within the recorded coverage. GO recommendation for a separately approved release with Stunna disabled; production preparation is now complete as documented below.** If provider-managed snapshot/PITR is the chosen production recovery method, verify that method separately. Merge and production deployment each require the owner's separate approval.

## Pre-release readiness review (2026-11-04, historical)

**Recommendation: GO for PR #6 release with `STUNNA_ENABLED=false`, subject to separate owner approval for merge and production deployment. NO-GO for activating production Stunna.** This is release readiness, not a claim that production login has already been tested.

- Re-read Vercel metadata without decrypting secrets. Production has `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` (sensitive, Production only), a fresh `AUTH0_SECRET` (sensitive, Production only), `APP_BASE_URL=https://eric-health-hub.vercel.app`, and `STUNNA_ENABLED=false`. Existing `AUTH0_DOMAIN` and `AUTH0_ALLOWED_SUB` remain present. No Production `DATABASE_URL` is configured.
- The owner confirmed saving the production callback `https://eric-health-hub.vercel.app/auth/callback` and logout `https://eric-health-hub.vercel.app` on the existing Default App while retaining Preview URLs. Auth0 URL registration is owner-confirmed, not independently inspected through an Auth0 management connector.
- The owner copied the existing Default App client secret directly into the Production Vercel Secret. Its presence/type/scope were verified without reading its value. Correct credential value and production callback/logout operation require post-deployment verification.
- Existing production MCP/identity, Garmin, Oura and Upstash environment entries retain their recorded IDs/scopes; their update timestamps predate this preparation. No Preview-only blank Upstash or Garmin-disable override was copied. No provider secret was read or changed.
- Production still resolves to READY deployment `dpl_EpDV7NVJpJYkYDkeWNK3t8H3bHrX`. PR #6 remains open/unmerged, based on unchanged main `3d204e7749e7033305f349eba3d0d3a4b4e62be2`.
- Compared the current PR source with tested application commit `be29d231b973493be07b63990aebfb800ce7f91b`. Only STATUS and two browser test scripts differ. Application code is unchanged, so the recorded 49 tests, typecheck, build and hosted acceptance still cover this release source. No application tests were rerun for these documentation-only updates.

### Final release checklist

- [x] Existing project/domain and browser application reused.
- [x] Production browser variable metadata verified, secrets kept private.
- [x] Exact production callback/logout URLs owner-confirmed saved.
- [x] Production Stunna explicitly false; no production training database connected.
- [x] Local tests/typecheck/build and hosted Preview auth, CSRF, persistence, isolation and logical restore passed within documented limits.
- [x] Existing Health Hub v2 live regression checks passed during Preview acceptance.
- [x] Known-good production deployment and rollback procedure recorded.
- [x] Owner explicitly approved merge and resulting Production deployment. Feature-branch Git deployment is disabled, but main deployment is not disabled; merging must be treated as potentially deploying.
- [x] Verified production login/callback/logout, signed-out private API denial, disabled training, public legal routes and MCP OAuth challenge. Bounded Oura/Garmin FIT/dynamics/laps regression checks passed through the existing read-only tools.
- [ ] If release verification fails, stop and report; request approval before reverting to the recorded deployment.

Intentional production changes remain browser login protection on the website/Oura browser routes and added Auth0 authorization for the Garmin diagnostic endpoint alongside its existing diagnostic secret. Existing MCP tool names and provider implementations remain unchanged.

The original CSRF fetch script was an agent test-design error: Chrome retained the legitimate Preview Origin and returned input-validation 400. The corrected form probe demonstrated actual origin rejection. A different real Auth0 account and provider snapshot/PITR remain outside hosted test coverage; wrong-account encrypted sessions passed locally and hosted runtime cross-subject isolation passed. These limitations do not enable production training; that separate activation remains blocked below.

## Production preparation checkpoint (owner-authorized, no deployment)

The preceding release-readiness review records the state before this preparation step. On 2026-11-03 the owner authorized Production configuration preparation, explicitly keeping `STUNNA_ENABLED=false` and requiring separate merge/deployment approval.

- Verified `eric-health-hub.vercel.app` is the existing project's verified production domain. The live rollback target remains READY deployment `dpl_EpDV7NVJpJYkYDkeWNK3t8H3bHrX`.
- Added Production-only `APP_BASE_URL=https://eric-health-hub.vercel.app`, `STUNNA_ENABLED=false`, and the existing Default App's public `AUTH0_CLIENT_ID`.
- Generated a fresh 32-byte production-only `AUTH0_SECRET`, stored as a sensitive/Secret variable. It was not copied from Preview, printed, or committed.
- Re-read metadata and verified every previously existing environment entry retained its ID, scope and update timestamp. No MCP, Garmin, Oura or Upstash entry was edited. Neither Preview's blank Upstash token nor its Garmin-disable override was copied.
- Completed (owner-confirmed): owner registered the production callback `https://eric-health-hub.vercel.app/auth/callback` and logout `https://eric-health-hub.vercel.app` on the existing Default App, retaining Preview URLs. There is no Auth0 management connector available; dashboard confirmation was supplied by the owner.
- Completed (metadata verified 2026-11-04): owner copied that same Default App's existing client secret directly from Auth0 into a Production-only Vercel Secret named `AUTH0_CLIENT_SECRET`. No secret should pass through chat or GitHub; no client-secret rotation is needed. The sensitive Preview value is not read back or reused through tooling.
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

The two owner setup steps and metadata verification are complete. The final checklist above is ready for separate merge/deployment approval. Configuration changes alone do not authorize release.

## Production release verification (2026-11-04, Chicago)

Owner approved the Sprint 1 foundation release with Stunna disabled. GitHub squash-merged PR #6 into main at `c6d11c3fcba9651ac40420a6f197866e08ee2a92`. Vercel built that exact commit as Production deployment `dpl_62ywMnN3hzybcUJgpyZtxz3vJfQz`, reported READY, and assigned the production domain. [Deployment details](https://vercel.com/stunna4/eric-health-hub/62ywMnN3hzybcUJgpyZtxz3vJfQz).

| Check | Result |
|---|---|
| Production environment | `STUNNA_ENABLED=false`, required browser-auth keys present, no Production `DATABASE_URL` |
| Auth0 login/callback/logout | PASS. Login redirected to Auth0 with the exact production callback URL. Owner confirmed return to Health Hub with Sign out visible and return to the private sign-in screen after logout. |
| Unauthorized requests | PASS. Signed-out homepage showed Private Health Hub. Oura test and authorize endpoints returned 401. Garmin diagnostic endpoint returned 404 without its diagnostic secret. |
| Disabled training | PASS. `GET /api/training` returned 404. |
| MCP and public pages | PASS. Anonymous `/mcp` returned a bearer challenge with 401. Privacy and terms returned 200. |
| Garmin listing and original FIT | PASS. Existing tool returned five activities and a bounded 12-sample FIT page. Heart rate, pace, cadence and distance were populated. The sample contained no recorded power values. |
| Garmin running dynamics and native laps | PASS. Ground contact time, vertical oscillation, ground contact time balance and vertical ratio populated. Two native laps and separate continuation requests for samples and laps passed. |
| Oura | PASS. Existing tool returned all four populated summary fields. |

The Health Hub v2 connector requested reauthentication on the initial calls and accepted it. The retry passed. Vercel runtime log access returned 403, so observability was limited to deployment metadata and direct functional checks. No critical functional check failed. No provider configuration or credentials were edited during release, no production training database was connected or migrated, and no rollback was performed.

Before Stunna activation, complete the clean production database, restricted runtime role, migration/grant verification, durable backups and restore drill described above. Activation and Sprint 2 each require separate authorization. The rollback target remains `dpl_EpDV7NVJpJYkYDkeWNK3t8H3bHrX`. Request owner approval before invoking rollback.

This post-release record is committed on the deployment-disabled Sprint 1 branch to avoid a second production build from a documentation-only push to main.

## Handoff after Sprint 2 review

Review the protected Preview first. Production activation requires separate approval, a clean production database with restricted credentials and verified grants/RLS, durable private backups and a tested production recovery method. Sprint 3 may add the player and actual set logging against stable prescription/exercise identities after authorization. Review real training sources before any separately authorized import.
