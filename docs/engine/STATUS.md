# Stunna Intelligence Engine — Current Status

**As of:** 2026-11-03
**Status:** Protected Preview browser login/logout and synthetic persistence acceptance passed with owner assistance. Live Health Hub v2 checks passed. Hosted cross-account/CSRF and recovery verification remain incomplete. **NO-GO for merge.**
**Branch:** `feature/stunna-sprint-1`, based on `main` commit `3d204e7` (merged Sprint 0 docs).
**PR:** [#6 — Sprint 1 secure persistence](https://github.com/New2Dis12/eric-health-hub/pull/6) — open, unmerged.
**Production:** untouched. No merge, production deployment, change to the existing Auth0 MCP client/API configuration, provider-token change, training import or real personal-data write was performed. A separate protected Preview was deployed with explicit owner approval. The owner separately configured the unused Default App for browser login. Separate owner-authorized Neon setup is recorded below.

## External setup progress (2026-11-03)

- Connected Neon and confirmed no pre-existing projects. Created one training PostgreSQL 17 project on the existing Neon Free organization in AWS us-east-1; no Vercel project or replacement identity provider was created.
- Created isolated `sprint-1-acceptance` database branch. Main remains an empty baseline; migration `001_foundation` and its exact SHA-256 checksum were applied transactionally only to the acceptance branch.
- Created a separate SQL-defined `stunna_runtime` login. Verified NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT and no administrator/owner memberships. A preliminary unused API-created role was replaced before schema setup because Neon management-created roles are privileged by default.
- Applied the repository runtime grants. All seven training/ancillary tables enforce FORCE RLS, are owned by the separate migration owner, and deny runtime DELETE. No records were inserted during schema setup. Subsequent hosted acceptance inserted synthetic training fixtures only.
- Created a baseline snapshot of the empty main branch. Neon snapshots of child branches are unsupported; a restore drill and acceptance-schema recovery verification remain pending. Current project recovery history is six hours; long-term backup policy remains a release decision.
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
| Hosted alternate-account / runtime cross-subject denial | UNVERIFIED — local regression passed, hosted verification blocked |
| Hosted negative CSRF test | NOT RUN — local regression passed |
| Hosted recovery / restore drill | NOT RUN — release gate remains open |

The synthetic browser suite verified atomic session-plus-measurement writes, exact replay, conflicting idempotency keys, stale revisions, missing-plan rollback, invalid units, concurrent duplicate completion, audited correction, completed-session protection and no-store responses. Final history had one block, one plan, one session and one measurement, with session revision 3. Independent Neon aggregate verification found one athlete, six audit events and five idempotency records. Actual-session audit transitions were null→1→2→3, once each. Only synthetic fixtures were written.

The red browser-console 409/404/400/401 responses are intentional negative tests and were asserted by the script before its final PASS. The Preview's Oura token-storage error is expected from the branch-only empty Upstash token override, which isolates this Preview from production provider tokens. Existing live Oura was checked separately. Do not reconnect Oura or copy production tokens into the Preview to remove that message. The sampled FIT had no power values, so only the nullable power column was verified.

The Vercel protected-fetch connection remains blocked at `read_protection_bypass` with 403. Owner-assisted browser tests proceeded without weakening protection. The owner-role SQL connection cannot SET ROLE to the runtime role under its existing membership settings. A separate direct restricted-runtime read-only check could not connect from the agent environment (DNS EAI_AGAIN). Neither limitation is evidence of failed application isolation, and neither is counted as a hosted isolation pass. Role grants were not changed for the test.

**Remaining acceptance work:** verify hosted unauthorized-account/runtime RLS denial and negative CSRF behavior, then complete a private recovery drill restoring schema and synthetic records into an isolated destination. Keep production and the empty main database untouched. Do not rerun the create-fixture script against the now-populated acceptance branch. No merge or production deployment is authorized.

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

Database integration uses PostgreSQL-in-WASM (PGlite), actual migrations/runtime grants/RLS and service SQL. Tests prove atomic browser/API measurement+session persistence, exact replay, conflict handling, forced rollback after audit failure, cross-athlete denial and up/down/up migration execution. PGlite serializes transactions. Subsequent owner-assisted hosted acceptance exercised pooled application persistence and concurrent duplicate requests, and real Auth0 login/logout. Those hosted results are recorded separately above. Hosted alternate-account/runtime isolation, negative CSRF and recovery checks remain pending.

## Production impact to review

1. **Intentional access change:** website data and Oura connect/callback require Auth0 browser login after deployment. Until browser config is present, they fail closed; MCP remains independent and operational.
2. **Diagnostic compatibility change:** `/api/garmin/test` now needs Auth0 browser identity or `garmin.read` bearer authorization **in addition to** `x-garmin-test-secret`. Secret-only diagnostic callers need updating. This does not alter Garmin MCP, token cache, FIT, laps or running dynamics.
3. **Additive dependencies/migration:** Auth0 SDK and pg enter the existing app; PostgreSQL is initialized lazily only for enabled training requests. Migrations never execute during build/startup. Existing provider data and Upstash are not migrated.
4. **Release guard:** no Vercel project or integration created. Branch Git deployment is disabled in `vercel.json`. Human approval is still required before any preview, production deployment or merge.
5. **Rollback:** disable Stunna independently while retaining authentication; code rollback leaves additive training tables intact. Full rollback restores the old website exposure, so restrict website access during recovery. Destructive schema rollback needs a private snapshot and explicit operator flag; it never touches provider tokens.

## Outstanding owner prerequisites / acceptance limits

- Complete hosted alternate-account/runtime RLS and negative CSRF checks. Local tests cover these cases, but hosted evidence is still required.
- Complete private backup/restore verification with schema, grants, RLS and synthetic record counts. The empty-main snapshot alone does not prove recovery of acceptance training data. Confirm a suitable retention policy before release.
- Browser Auth0 and restricted pooled PostgreSQL access work on the approved Preview. Production browser URLs/environment configuration and any production training database setup require a separate approved release plan. Website access fails closed if browser configuration is absent after release.
- Existing Health Hub v2 live read-only regressions passed. Provider access is intentionally isolated in Preview. Existing MCP client/audience/grants and Garmin/Oura/Upstash credentials remain unchanged.
- `training.read`/`training.write` scopes are enforced but not provisioned for external clients. Browser sessions do not require these bearer grants. Do not modify existing ChatGPT MCP clients for a training test.
- No known unresolved automated-test failures. **NO-GO for merge** until remaining acceptance/recovery gates pass and production readiness is reviewed. Merge and production deployment each require the owner's separate approval.

## Sprint 2 handoff

Do not infer existing prescriptions or import personal training Markdown into GitHub. After Sprint 1 review and hosted auth/database acceptance, implement Sprint 2: review/import the authoritative current block, schedule, exercise/interval targets, baselines, preferences and correction history into private PostgreSQL; add the mobile Today/calendar surfaces and a scoped read-only `get_training_context` MCP tool using the shared service layer. Preserve existing MCP tools and health integrations. No set-player logging, Garmin auto-matching, analytics or coaching plan-approval workflow was implemented early.

The Sprint 1 block/planned-session models are minimal and append-only. Add exercise prescription/preferences/approved-revision entities through a new migration. Actual-session correction currently covers notes/RPE only after completion; measurements have no correction endpoint yet. Audit records track actor/reason/source/entity/revisions, not old health-value snapshots. Offset history is bounded and intended as a diagnostic foundation; design cursor pagination before large history use. Never treat an in-progress session as a verified completed workout or infer missing exercise targets.

Suggested next prompt:

> Implement Sprint 2 of Stunna Intelligence Engine in `New2Dis12/eric-health-hub` using the current engine docs and Sprint 1 services. First verify Sprint 1 has been approved and its hosted auth/database acceptance is complete; report any remaining blocker before importing data. Review the authoritative training sources, add versioned private prescription/preferences storage and mobile Today/calendar views, then expose scoped read-only `get_training_context` without changing existing Health Hub v2 tools. Test, typecheck, build, update STATUS, and open an unmerged PR. Do not deploy without approval.
