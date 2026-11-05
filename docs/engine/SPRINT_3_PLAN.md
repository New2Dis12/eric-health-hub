# Sprint 3 — Interactive workout player implementation plan

Status: proposed for owner review on 2026-11-05. No implementation is authorized by this plan. Sprint 2 is released with Production Stunna disabled. No production database, imports, scope changes or activation are part of this plan's preparation.

## Experience and boundaries

Preserve the approved `/app` weekly calendar and inline workout overviews. Each Start Workout action will open that workout's player, or resume its existing session. Combined days keep separate sessions. The player is a concise execution interface, while the existing ChatGPT coaching conversation remains the place for interpretation and programming decisions. Both use shared server services and PostgreSQL. Do not add a chatbot or recreate multi-chat/Markdown handoffs.

Show prescribed values alongside clearly labeled Actual inputs. Never treat a prescription, previous performance or prefilled suggestion as a completed result. Keep unknown values null and explicit. Do not change the saved training methodology, generate new targets, or promote manual entries to verified baselines automatically.

## Proposed delivery sequence

1. **Persistence contract and migration.** Reuse Sprint 1 actual sessions, audit and idempotency primitives. Pin the exact approved prescription revision and immutable snapshot at session start. Add stable execution identities for exercise, warm-up, interval block, repeat and segment occurrences; array position alone must not identify a result across revisions. Link child records to athlete + actual session with composite constraints, FORCE RLS and minimum runtime grants. Leave existing migration checksums and prescription runtime read-only access unchanged.
2. **Shared logging services.** Add typed, bounded commands for start/resume, confirm or correct set/interval results, skip/add/substitute work, save notes and finalize. Every write authenticates the subject server-side, checks `training.write`, uses same-origin protection for cookies, records audit provenance and applies idempotency plus optimistic revisions. Add bounded session/history reads requiring `training.read`. Reuse these services in app and MCP adapters.
3. **Strength player.** Show current exercise/set and upcoming work, prescribed sets/reps/load convention/RPE/rest and relevant previous evidence. Record actual reps, load with unit and total/per-hand/added/bodyweight convention, optional RPE and notes. Keep planned, completed, skipped and added work distinct. Allow warm-ups and optional exercises without forcing invented results. Saving a confirmed entry must persist immediately; show Saving, Saved, Failed or Conflict accurately. Rest timing may be an optional foreground aid, never evidence that a set was performed.
4. **Interval player.** Expand ordered warm-ups, repetitions, work/recovery, transitions and cooldowns into stable occurrences. Record completion/skips and optional actual duration, distance, pace/speed, watts, rowing split/500 m, stroke rate and cycling cadence using compatible units. Preserve work/recovery order and explicit missing metrics. Display derived conversions only with labels; do not overwrite recorded units or infer sensor measurements.
5. **Adjustments and completion.** Save actual substitutions, changed loads/reps/dose, skipped or added work and reasons separately from the approved prescription. Recovery-based changes are user-confirmed choices, not automatic decisions. Allow session notes, optional session RPE and deliberate completion after reviewing unrecorded work. Missing metrics remain missing; unrecorded items require an explicit disposition rather than silent completion. Repeated Complete requests return the same finalized session. Post-completion corrections require a reason and audit trail. Automatic Garmin matching/analysis remains Sprint 4.
6. **ChatGPT parity and optional check-ins.** Add read tools for bounded actual workout history and scoped logging adapters using the same services. Retain existing health tools and `get_training_context` names/behavior. Reuse existing weight/waist measurement validation and persistence for the roadmap's check-in path; corrections must preserve history. No production Auth0 scope expansion is authorized. Provision an explicitly approved Preview-only test-token path before claiming hosted read/write MCP parity.

## Data and reliability decisions

| Concern | Proposed contract |
|---|---|
| Plan versus execution | Immutable approved snapshot pinned at Start; actual rows never edit prescriptions. Later approved plan revisions are visible as a separate change, not silently applied to an in-progress workout. |
| Identity | Stable session and execution-item IDs with snapshot references, exercise key, item type and occurrence; substitution/addition retains its relationship to the original item. |
| Actual records | Separate bounded typed set and interval results, explicit completed/skipped state, nullable metrics, source, timestamps and revision. Manual values are user reported. |
| Resume | Reload reads the server's saved session and results. One actual session per planned workout is retained by the existing unique constraint. Multiple same-day workouts remain independent. |
| Concurrent tabs/app and ChatGPT | Expected revisions prevent lost updates; exact idempotent retries return the original response. Conflict UI reloads confirmed server state without discarding an unsaved draft silently. |
| Failed saves | Preserve an in-memory unsaved draft and show retry; never show Saved/Completed before commit. Warn before leaving unsaved work where possible. No persistent sensitive browser storage or full offline sync in this sprint. |
| Finalization | Validate state and unresolved items atomically, finalize once, audit corrections. Completion does not imply Garmin evidence, verified benchmarks or successful coaching analysis. |
| Units and missing data | Validate metric/unit pairs and bounds; retain null versus zero and prescribed versus actual. No implicit kg/lb, pace/speed or total/per-hand conversion. |

Full offline operation, background timers, automatic sensor capture, Garmin activity matching, wearable ingestion, analytics, recurring schedule generation, coaching proposal/approval workflows and real Markdown imports remain outside Sprint 3 implementation scope unless separately approved.

## Acceptance gates

- Synthetic strength workout: record multiple sets with different actual weights/reps/RPE; reload and resume exactly; previous prescriptions remain unchanged.
- Combined day: independently start/resume/complete run and strength sessions without cross-linking entries.
- Running, rowing and cycling: ordered repetitions and recovery survive reload; actual metric units, missing values and skips are preserved.
- Adjustment: substitute, skip and add work with a reason; compare planned versus actual and inspect audited correction history.
- Completion: retry/concurrent Complete creates no duplicates; stale revisions conflict; failed audit or database transaction rolls back all related writes.
- App → MCP and MCP → app: exact actual results and weight/waist check-ins agree through real hosted authenticated tools, including correction and resume. Complete deferred hosted `get_training_context` parity too.
- Security: signed-out/wrong-subject requests, missing write scopes, invalid bearer fallback, CSRF origins, malformed/oversized inputs, cross-athlete foreign keys and runtime write permissions are tested. No secrets or health data in public artifacts.
- iPhone review: practical numeric inputs, clear load conventions, visible save status, accessible controls, stable navigation and explicit completion review.
- Regression: full tests, typecheck and build; existing Oura refresh/Upstash, Auth0, MCP, Garmin listing/original FIT/dynamics/native laps remain intact.

## Rollout and approval

After plan review, implement on a new feature branch from current main and open a review PR. Use only the existing isolated Neon development branch and synthetic fixtures, with additive migrations and branch-scoped Preview settings. Keep Stunna and player disabled in Production; do not connect or migrate a production training database. Request approval for the protected Preview and any needed test-client scope configuration before hosted tests. Release and activation remain separate decisions. Rollback is application/feature-flag containment with approval, preserving additive tables and confirmed records; never use destructive down migrations for routine recovery.

Recommended owner decision: approve this scope and confirmation-based save/resume contract before coding. Production database provisioning, backups/restore verification, personal-record import and Stunna activation remain independent prerequisites for real daily use.
