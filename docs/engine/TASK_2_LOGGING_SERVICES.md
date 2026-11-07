# Task 2: actual-result services (synthetic/local)

This slice adds no UI or MCP tool. All actuals are explicitly confirmed user reports, never filled from prescriptions or treated as verified sensor data. Use existing authenticated TrainingService.write with operation `log_workout`; clients can call POST `/api/training/results`. The existing training API also accepts the shared command. Both routes require Stunna enabled, authorized subject, training.write and same-origin cookies or a scoped bearer. Invalid bearer cannot fall back to cookies. Existing session Start/Resume and context reads are unchanged.

## Command contract

The strict envelope is `operation`, UUID `idempotencyKey`, bounded nonempty `reason`, UUID `sessionId`, positive `expectedSessionRevision`, nonnegative `expectedItemRevision` (0 for a new item), and `item`:

| kind | Identity | Values |
|---|---|---|
| strength_set | pinned exercise occurrenceId + setOrdinal (1..prescribed sets, at most50) | actual: reps integer0..500 or null, load null or {value0..2000,unit kg/lb,basis total/per_hand/added/bodyweight}, rpe0..10 or null, source user_reported |
| interval | pinned warmup/interval occurrenceId | actual: metrics (at most8 unique metric names), rpe0..10 or null, source user_reported |
| exercise_note | pinned exercise occurrenceId | notes string, including empty, at most4000 characters |
| workout_note | session | notes string, including empty, at most4000 characters |

Every interval metric contains `metric`, `value` (nullable; zero is valid) and original `unit`. Duration uses s; distance m/km/mi; speed m/s/km/h/mph; pace sec/km or sec/mi; power W; rowing_split sec/500m; stroke_rate spm; cycling_cadence rpm. Pace applies to run/ski, rowing metrics only row, cycling cadence only bike. Only pinned run/row/bike/ski segments accept interval results. Limits: duration/pace/split86400, distance1000000, speed200, power5000, stroke/cadence300. No derived conversions or missing values are silently stored. Segment order, phase and repetition identities stay in the immutable snapshot.

Response after committed write: entryId, itemRevision, actualSessionId, sessionRevision. Exact key replay returns the original receipt even after later edits; re-read for current truth. Different key payload or stale session/item revision returns409. Athletes are locked by the existing shared transaction; entries, session revision/notes, audit and receipt commit or roll back together. Finalized and unpinned sessions reject new logging. No finalize/skip/add/substitute command is added.

## Reads and audit history

TrainingService.results(principal, sessionId, history=false, limit=50, offset=0) and GET `/api/training/results?session=UUID&history=false&limit=50&offset=0` return sessionId, sessionRevision, status, notes, notesRevision, entries and nextOffset. Limit1..100; offset0..10000. Reads are authenticated training.read, private/no-store and transactionally consistent with a session share lock. Current entries are latest strength/interval/exercise-note values. **Overall notes come only from actual_sessions.notes**; notesRevision is the latest logging revision. Overall-note revision records appear only in history. Legacy record_observation remains supported and may update authoritative notes/session revision; callers must always read current notes, not replay a historical note entry.

History=true pages immutable append-only entries with exact old/new values, actor, browser/api source, user_reported provenance, reason and recorded time. First overall-note logging captures the prior session note even for legacy notes. This history is audit evidence, not a second authoritative current overall-note store. Items are identified by exact pinned UUID, kind and set ordinal, never mutable exercise names or array positions. Cross-session/athlete references fail service checks, composite FK and FORCE RLS. Runtime has only SELECT/INSERT on the new table, no UPDATE/DELETE/DDL. Original migration001–005 bytes/checksums remain intact.

## Deployment and recovery gates

Migration006 and conditional runtime grants are SOURCE ONLY. No hosted migration, database provisioning, Preview/Production deployment, Auth0/provider change or personal data is included. Hosted resources/credentials are unnecessary for local PGlite validation. Applying006/grants to the existing isolated development DB, protected Preview testing, hosted MCP parity and release need separate approval. Production stays disabled/unconnected. Runtime grants must be applied with the migration in any future authorized setup.

Contain a release problem through authorized application/flag rollback while retaining confirmed history. The down migration destroys result history and is only for explicitly authorized disposable development reset; never routine recovery. PGlite serializes transaction execution; queued concurrent promises test optimistic conflict behavior, not multiprocess hosted PostgreSQL contention. Local encrypted-cookie HTTP tests exercise real auth/Origin handling but are not mobile browser or hosted parity acceptance. Shared connector identity/lease fencing remains cooperative workflow control.
