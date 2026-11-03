# Stunna Intelligence Engine — Current Status

**As of:** 2026-11-02
**Status:** Sprint 0 proposal in review (documentation-only branch: `docs/stunna-intelligence-sprint-0`)
**Current production behavior:** existing Health Hub app + Garmin/Oura read-only MCP are operational, subject to the known tool-schema cache and security review. **No Stunna database, private training app, logging tools, or autonomous weekly updates have been implemented yet.**

## What this kickoff branch contains

- [PRODUCT.md](PRODUCT.md) — one ChatGPT coaching interface + app workout player/dashboard + unified weekly closeouts.
- [ARCHITECTURE.md](ARCHITECTURE.md) — one Vercel project, existing Auth0 and Upstash, proposed PostgreSQL system of record, shared authenticated read/write service layer.
- [ROADMAP.md](ROADMAP.md) — scope-based Sprints 0–7 with acceptance tests and priorities.
- This file — current state and next action.

## What has NOT happened

- No external database or Auth0 web client provisioned.
- No personal training data migrated, inserted, altered, or shared.
- No working web dashboard or write MCP tools implemented.
- No production deployment or merge.
- No paid service subscriptions or separate AI API integration initiated.

## Verified repository baseline and risks

- Existing `app/mcp/route.ts` validates Auth0 token; current read scopes `oura.read` and `garmin.read`.
- Existing `lib/mcp-server.ts` exposes Oura summary and Garmin activity FIT analysis, preserving current integration.
- `app/page.tsx` retrieves Oura metrics on the homepage. `app/api/oura/authorize/route.ts` offers an OAuth initiation path. Need verify and implement server-side login protection for dashboard, health-data display, OAuth connect and every private API path. **Do not log private training data until gated.**
- Current `get_garmin_activities` tool schema advertised in some ChatGPT contexts may lag the server's full FIT parameters; later integration tests must verify tool visibility and authorization.
- Known native Garmin lap anomaly in Oct 27 activity needs quality flag/investigation before relying on final-lap end timestamps in detailed comparisons.
- Repository is public. Documentation should remain abstract; live personal measurements and screenshots belong only in authenticated storage.

## Decision log

- **Selected:** ChatGPT remains the primary conversational coach (one Stunna HQ thread); the mobile web app acts as workout player, logging surface and dashboard.
- **Selected:** shared durable database prevents forgetting across long or new conversations and removes manual weekly Markdown handoffs.
- **Selected:** prescribed vs actual fields are separate; user-approved programming changes are recorded, not silently overwritten.
- **Selected:** same repository, same deployed Next.js app, existing Garmin/Oura integrations; no extra app/project required.
- **Proposed:** Neon-hosted PostgreSQL as relational system of record; provider/account provisioning and exact configuration await implementation.
- **Deferred:** native phone app, embedded app chatbot, background sync and expanded Peloton automation.

## Next implementation sprint: Sprint 1 — Secure persistence foundation

Scope:
1. Audit effective external routes for unauthenticated Oura/private data exposure and OAuth connection access; create Auth0 web-session protection using existing tenant/config where possible. Keep MCP bearer authorization intact.
2. Design minimal SQL schema/migrations: athlete, current plan/session, body measurement, actual session and revision/audit log. Keep source provenance and idempotency rules.
3. Wire a PostgreSQL connection through server-only environment variables and authenticated services; create a minimal private test read/write endpoint; validate anonymous denial and authorized behavior.
4. Verify `pnpm test`, `pnpm typecheck`, and `pnpm build` (or repo equivalent).
5. Open focused PR; **do not merge or deploy** until owner reviews protection and end-to-end tests.

Owner input only when necessary: approve/create PostgreSQL instance and any required Auth0 web-app client or callback configuration. Never paste secrets into ChatGPT/GitHub; configure securely via platform environment settings.

### Suggested next Work prompt

> Implement Sprint 1 of Stunna Intelligence Engine according to `docs/engine/{PRODUCT,ARCHITECTURE,ROADMAP,STATUS}.md` in `New2Dis12/eric-health-hub`. Prioritize securing the Oura home page and private browser/API routes, maintaining existing MCP/Auth0 and Garmin/Oura behavior, then introduce the minimal durable training schema and authenticated services. Keep one repo/Vercel project; use the existing Auth0 tenant and Upstash. Add tests and open an unmerged PR. If external provisioning is required, implement/test as far as possible and give me the single minimal setup action needed. Update STATUS.md with what passed and what remains blocked.

## What review of Sprint 0 needs to confirm

Does PRODUCT.md correctly reflect daily prescribed workout format, logging responsibilities, weekly conversational closeout and approval boundaries? If yes, merge docs PR and begin Sprint 1. If not, edit the product contract before building.
