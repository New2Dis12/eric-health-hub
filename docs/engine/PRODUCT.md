# Stunna Intelligence Engine — Product Contract (Sprint 0)

Status: proposed product contract for review. This repository is public: do not commit personal health records, workout logs, access tokens, screenshots, or identifying measurements.

## Product vision

One persistent, data-driven training operating system supporting **three connected experiences**: (1) individual workout execution and analysis, (2) conversational weekly coaching, and (3) training-block assessment. Its purpose is to eliminate repeated prompting, reentering data, inconsistent presentation, and manual Markdown handoffs.

**Primary interfaces**
- **ChatGPT — Stunna HQ:** one primary conversation in the existing Getting Back to Stunna Project for coaching, plan questions, workout interpretation, recovery discussion, and weekly/block closeout. Fresh conversations must be equally capable because durable facts are retrieved from the backend.
- **Stunna web app:** mobile-first workout player and progress dashboard *inside the existing Health Hub Next.js application*. Display today's prescribed session; check off sets; enter/revise actual weights, reps, RPE, workout-level notes, weight/waist measurements; view training calendar/history/trends. Do not duplicate the ChatGPT coaching chatbot in the app for MVP.
- **Shared backend:** the only authoritative record of prescriptions, completed workouts, user feedback, verified source data, preferences and approved program changes.

## User journeys and acceptance contracts

### A. Before training: "What's my workout today?"
1. ChatGPT or the app reads today's *persisted* workout prescription (not a regenerated guess).
2. Show day/week/block purpose, ordered exercises or intervals, sets/reps/time, target intensity, prescribed weight or speed, rest periods, previous comparable session, and any approved modifications.
3. Use a stable presentation template across chats/weeks; avoid unrequested changes of wording or structure.
4. If the prescription or prior performance is unavailable, explicitly identify missing data. Never manufacture a load, speed, exercise, recovery status or historical comparison.
5. Any modification to the authorized plan must be explicitly proposed and approved, then persisted with a reason.

### B. During training: app workout player
1. Open the prescribed session from a home-screen shortcut; show the current exercise and next exercise.
2. Mark a set complete, record actual weight/reps/RPE, and add short exercise- or session-level notes. Prefill *prescriptions* from the saved plan, but distinguish prescribed from actual values.
3. Autosave after each confirmed input, and restore an in-progress session after reload.
4. Permit corrected entries, rest periods, skipped sets and exercises without overwriting the original prescription.
5. A completed session is finalized once; repeated submissions should be idempotent. User can still make explicitly audited corrections afterward.
6. Optional weight or waist check-in uses the same authenticated account and database.

### C. After training: "Done"
1. Find candidate recent Garmin activities using existing authorization and on-demand FIT retrieval; match to the planned session using time, type and user confirmation when ambiguous.
2. Ingest recorded evidence (HR, pace, laps, running dynamics, etc.) with availability and quality flags; do not insist on uploading FIT files manually.
3. For strength, rely on logged sets and subjective RPE; for Peloton, accept a screenshot or manually entered metrics until a supported completed-workout integration is verified. Avoid double-counting a Peloton session recorded by Garmin too.
4. Generate useful comparison to prior similar workouts, distinguish measurement from inference, and record a versioned analytics result with source/activity IDs.
5. Ask only for missing *material* information. "Done" must not imply the activity was matched or saved when retrieval fails.
6. Show a reliable completion status: saved / awaiting Garmin match / needs input / failed, with an understandable retry action.

### D. Weekly closeout: one conversation, no file choreography
1. On request (e.g. "Let's review the week"), query the saved plan, completion/adherence, workout findings, recovery, body-composition trend, coaching decisions and unresolved inputs.
2. Lead an actual conversation: highlight accomplishments, concerns, and one or two decisions requiring user judgment. Keep discussion distinct from logging.
3. Propose next-week progression, consolidation or recovery **with reasoning and uncertainties**.
4. Persist approved changes to next week's prescriptions and coaching-decision history; leave pending ideas as proposals.
5. No required local Markdown downloads, duplicate uploads or separate body-composition/analysis chats.

### E. Block review
1. Compare baseline and target outcomes against evidence across the prescribed block.
2. Separate endurance, strength, body composition, training adherence and durability.
3. Present evidence strength, confounders and missing data; never rely on a fabricated composite "readiness" score.
4. Draft the next block for approval; preserve provenance and change history.

## Communication contract

- **Workout prescription:** Objective → ordered actionable work → previous verified benchmark → why this dose → what feedback to collect.
- **After-action review:** What was prescribed vs done → measured results → comparison against a valid baseline → qualitative interpretation → relevant next action.
- **Weekly closeout:** Completed vs planned → meaningful adaptations/limitations → recovery/body trend → decision discussion → approved next-week plan.
- Always label planned, actual, measured, derived, subjective, and recommended values. No false precision.
- Keep gym-time answers concise; provide depth when analyzing or reviewing.
- User corrections and format preferences persist independently of any ChatGPT conversation.

## Responsibilities

| Component | Owns |
|---|---|
| Existing Garmin/Oura integrations | Fetch verified vendor data and detailed Garmin FIT records |
| Stunna backend/analytics | Typed data, normalization, deduplication, calculations, source quality, versioned metrics |
| Training state/database | Authoritative plan, exercise/set entries, measurements, feedback, preferences, decisions |
| ChatGPT | Interpret, explain, converse, propose programming; call authenticated read/write MCP tools |
| Stunna web app | Workout player, logging controls, calendar, charts, optional screenshot intake |

## Non-goals for initial release

No second Vercel project, custom native iOS app, new Garmin connection, duplicate coaching chatbot, full offline app, proprietary overall fitness score, manual FIT uploads, ingestion of every historical record before daily use works, or automatic unapproved rewriting of an entire training block.

## MVP gate

A successful minimal end-to-end demo:
1. Today's existing prescription is shown identically in the app and read from ChatGPT.
2. During workout, actual set data and RPE are saved in the app and retained after reload.
3. ChatGPT retrieves exactly those logged values in the same or a fresh conversation.
4. "Workout complete" triggers Garmin retrieval where appropriate, with clear matching/status and without duplicate session records.
5. A weight check-in entered through ChatGPT appears in the app.
6. Approved next-week change is persisted and appears in the next prescription.
7. No sensitive records are exposed to an unauthenticated visitor.

## Open decisions to validate during implementation

- Confirm the canonical source and migration process for the existing Getting Back to Stunna Markdown program, baselines and exercise history; migrate with review, never infer absent data.
- Verify secure mobile web session implementation against current Auth0 tenant/client configuration.
- Decide whether workout set autosaving should be optimistic or confirmation-based after a prototype.
- Confirm whether screenshot storage is required: structured extracted metrics may suffice, reducing retention of sensitive files.
- Validate actual vendor capabilities and authorized data paths before promising automated Peloton completion retrieval.
