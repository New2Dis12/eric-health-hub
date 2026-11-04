# Stunna Intelligence Engine — Current Status

**As of:** 2026-11-03
**Status:** Sprint 1 implementation ready for review; hosted configuration and live acceptance remain blocked on owner setup/approval.
**Branch:** `feature/stunna-sprint-1`, based on `main` commit `3d204e7` (merged Sprint 0 docs).
**PR:** [#6 — Sprint 1 secure persistence](https://github.com/New2Dis12/eric-health-hub/pull/6) — open, unmerged.
**Production:** untouched. No merge, deployment, change to the existing Auth0 MCP client/API configuration, provider-token change, training import or real personal-data write was performed. The owner separately configured the unused Default App for browser login. Separate owner-authorized Neon setup is recorded below.

## External setup progress (2026-11-03)

- Connected Neon and confirmed no pre-existing projects. Created one training PostgreSQL 17 project on the existing Neon Free organization in AWS us-east-1; no Vercel project or replacement identity provider was created.
- Created isolated `sprint-1-acceptance` database branch. Main remains an empty baseline; migration `001_foundation` and its exact SHA-256 checksum were applied transactionally only to the acceptance branch.
- Created a separate SQL-defined `stunna_runtime` login. Verified NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT and no administrator/owner memberships. A preliminary unused API-created role was replaced before schema setup because Neon management-created roles are privileged by default.
- Applied the repository runtime grants. All seven training/ancillary tables enforce FORCE RLS, are owned by the separate migration owner, and deny runtime DELETE. No training rows or real health records were inserted.
- Created a baseline snapshot of the empty main branch. Neon snapshots of child branches are unsupported; a restore drill and acceptance-schema recovery verification remain pending. Current project recovery history is six hours; long-term backup policy remains a release decision.
- Runtime acceptance credentials were generated and retained privately in ignored local configuration, mode 0600. No secret values or connection strings were added to chat or GitHub. The restricted database URL and a fresh browser-session secret are now stored as sensitive Vercel variables scoped only to PR #6 Preview; no migration-owner URL was uploaded.
- Connected the existing Vercel project and added seven variables scoped only to `feature/stunna-sprint-1` Preview: restricted DATABASE_URL, new AUTH0_SECRET, existing tenant domain, planned branch APP_BASE_URL, disabled Stunna/Garmin flags, and an empty branch-specific Upstash write-token override. This prevents the acceptance preview from reading or refreshing the production token store. All original variable IDs/settings and the current production deployment remain unchanged. No deployment was created.
- Owner converted the existing unused Auth0 Default App to a Regular Web Application and reported saving the exact Preview callback/logout URLs. Both MCP applications remain unchanged. Public client ID is configured; the owner copied the client secret and authorized User ID directly from Auth0 into branch-specific sensitive Vercel entries. Metadata confirms both placeholders were updated; their contents and validity have not been read or verified by the agent.
- Pre-preview checkpoint: all ten required branch-specific entries exist and target Preview only. No deployment exists for this Git branch, the production deployment is unchanged, all seven database tables enforce FORCE RLS, the runtime remains restricted, the acceptance database has zero athlete/session/measurement rows, and the baseline snapshot exists.
- **Next gate: owner approval for a protected Preview deployment only.** With that approval, enable Stunna only for this isolated Preview branch, deploy PR #6 in the existing Vercel project, verify the generated branch alias, and run synthetic persistence/authentication, recovery and existing Health Hub v2 regression checks. Owner sign-in may be needed for a real Auth0 browser test. No merge, promotion or production deployment is authorized. Current merge recommendation remains **NO-GO pending those checks**.

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

Database integration uses PostgreSQL-in-WASM (PGlite), actual migrations/runtime grants/RLS and service SQL. Tests prove atomic browser/API measurement+session persistence, exact replay, conflict handling, forced rollback after audit failure, cross-athlete denial and up/down/up migration execution. PGlite serializes transactions; hosted connection pooling, verified TLS and real simultaneous PostgreSQL connection behavior still need the release smoke test. Hosted Auth0/provider configuration was not contacted or changed. The subsequent Neon setup verification above inspected schema/role settings only; it is not hosted application acceptance.

## Production impact to review

1. **Intentional access change:** website data and Oura connect/callback require Auth0 browser login after deployment. Until browser config is present, they fail closed; MCP remains independent and operational.
2. **Diagnostic compatibility change:** `/api/garmin/test` now needs Auth0 browser identity or `garmin.read` bearer authorization **in addition to** `x-garmin-test-secret`. Secret-only diagnostic callers need updating. This does not alter Garmin MCP, token cache, FIT, laps or running dynamics.
3. **Additive dependencies/migration:** Auth0 SDK and pg enter the existing app; PostgreSQL is initialized lazily only for enabled training requests. Migrations never execute during build/startup. Existing provider data and Upstash are not migrated.
4. **Release guard:** no Vercel project or integration created. Branch Git deployment is disabled in `vercel.json`. Human approval is still required before any preview, production deployment or merge.
5. **Rollback:** disable Stunna independently while retaining authentication; code rollback leaves additive training tables intact. Full rollback restores the old website exposure, so restrict website access during recovery. Destructive schema rollback needs a private snapshot and explicit operator flag; it never touches provider tokens.

## Outstanding owner prerequisites / acceptance limits

- PostgreSQL acceptance branch/schema/runtime grants are prepared. Configure its restricted URL only in the intended Preview branch environment, verify actual pooled/TLS app access, and complete private backup/restore checks. Keep the empty main database untouched until the production release sequence is approved.
- Browser configuration is owner-reported complete using the existing Default App and ten PR-scoped Preview variables. Real Auth0 login, correct subject, credential validity, callback/logout behavior and generated hostname remain to be verified on the approved preview. Keep the MCP client/audience/grants and Garmin/Oura/Upstash credentials intact; no duplicate application was created.
- After explicit approval for a private preview/deployment, complete the runbook's synthetic login/read/write/RLS test with the actual services and the existing Health Hub v2 connector smoke test. No real training import until auth audit passes. Live production health records have not been read for this implementation.
- `training.read`/`training.write` permissions are enforced in the new API verifier but not provisioned in Auth0. Browser sessions work without them. Add grants only for an explicitly authorized external training API test; do not modify the existing ChatGPT MCP client in Sprint 1.
- No known unresolved automated-test failures. Hosted end-to-end acceptance remains unverified: Neon schema setup is complete for the isolated branch, but configuration metadata is checked, but actual Auth0/Preview behavior, deployment approval and application checks are still pending.

## Sprint 2 handoff

Do not infer existing prescriptions or import personal training Markdown into GitHub. After Sprint 1 review and hosted auth/database acceptance, implement Sprint 2: review/import the authoritative current block, schedule, exercise/interval targets, baselines, preferences and correction history into private PostgreSQL; add the mobile Today/calendar surfaces and a scoped read-only `get_training_context` MCP tool using the shared service layer. Preserve existing MCP tools and health integrations. No set-player logging, Garmin auto-matching, analytics or coaching plan-approval workflow was implemented early.

The Sprint 1 block/planned-session models are minimal and append-only. Add exercise prescription/preferences/approved-revision entities through a new migration. Actual-session correction currently covers notes/RPE only after completion; measurements have no correction endpoint yet. Audit records track actor/reason/source/entity/revisions, not old health-value snapshots. Offset history is bounded and intended as a diagnostic foundation; design cursor pagination before large history use. Never treat an in-progress session as a verified completed workout or infer missing exercise targets.

Suggested next prompt:

> Implement Sprint 2 of Stunna Intelligence Engine in `New2Dis12/eric-health-hub` using the current engine docs and Sprint 1 services. First verify Sprint 1 has been approved and its hosted auth/database acceptance is complete; report any remaining blocker before importing data. Review the authoritative training sources, add versioned private prescription/preferences storage and mobile Today/calendar views, then expose scoped read-only `get_training_context` without changing existing Health Hub v2 tools. Test, typecheck, build, update STATUS, and open an unmerged PR. Do not deploy without approval.
