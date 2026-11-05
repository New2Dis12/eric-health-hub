# Sprint 2 methodology fit review

Reviewed the four supplied current-block, performance-baseline, data-authority and coaching-handoff files as private reference material. Their personal prescriptions, history and measurements were excluded from repository fixtures and the development database. The athlete profile, full training log and nutrition file remain unreviewed. Real import needs those sources and a separate authorization.

The architecture is one ongoing ChatGPT coaching conversation and one mobile app reading the same PostgreSQL state. Markdown is an eventual reviewed migration source. Old chat-routing, lab handoffs, synchronization manifests and ongoing manual file maintenance are excluded from the application workflow. Source-authority rules remain applicable to evidence inside the shared backend.

| Requirement | Model and current interface |
|---|---|
| Multiple sessions per day | Separate dated sessions, ordered by scheduled time and stable ID. The synthetic combined day contains a run followed by strength. |
| Strength dose | Existing sets/reps/load plus typed rep and target-RPE ranges, explicit per-hand/total/added/bodyweight load convention, warm-ups and authored adjustment conditions. |
| Running, rowing and cycling intervals | Ordered blocks, repeat counts and ordered warm-up/work/recovery/transition/cooldown segments. Segments carry modality, duration and typed target ranges. Strength doses can appear inside mixed-modal segments. |
| Pace, distance, watts, split and stroke rate | Unit-validated targets distinguish seconds/km, seconds/mile, seconds/500m, watts, distance, rowing spm and cycling rpm. Unknown targets use null ranges. No conversion of class-average evidence into a threshold target. |
| Optional work and substitutions | Optional markers, equipment requirements and conditional alternative identity/equipment are persisted and displayed. Conditions are authored instructions that require human judgment. |
| Weekly structure and dated adjustments | Immutable approved block-context revisions store recurring weekly slots and progression guidance. Dated approved prescriptions remain authoritative for execution. Automatic recurrence materialization and conflict resolution are deferred. |
| Plan, actuals, baselines and decisions | Dated prescriptions, Sprint 1 actual sessions and reviewed benchmarks remain separate tables. A benchmark must be explicitly verified, predate the selected day and match its comparison context. Conditions are not logged decisions. A separate proposal/approval decision workflow belongs to later sprints. |
| History, provenance and unknowns | Approved snapshots retain revision, reason and source. Block guidance has its own revision. Exercise source references and benchmark source references preserve provenance. Partial evidence retains nulls. No actual set entries are inferred from a plan. |

## Corrections made before Preview

The original four-unit scalar target was a merge blocker for the stated methodology. Its compatible extension now supports typed ranges and structured ordered segments. The old schema also lacked a verification state and comparison context for prior evidence. Migration 003 adds these, defaults older evidence to unverified, and stores versioned block context. The runtime can only read these tables and RLS remains enforced. The already-applied migration 002 checksum remains intact.

The synthetic examples demonstrate the representation. They are not a recreation of the athlete's program. The model leaves unreported targets explicit. It does not automatically evaluate recovery, choose equipment alternatives, approve progression, synthesize coaching decisions, or log sets.

## Remaining work before real import or activation

Review the remaining methodology sources and approve an explicit field/source mapping. Preserve modality, equipment/load conventions, scope of evidence (interval versus whole-session), verification caveats and dated corrections. Stable exercise keys and comparison contexts must distinguish noncomparable variants. A source-reconciliation/import service and full coaching decision ledger are future work, along with Sprint 3 actual-set logging. Production activation still requires its isolated database and a verified durable backup policy.

Keep PR #7 unmerged until the protected Preview shows the same saved prescription through the app and authenticated MCP, including richer segments, and the owner completes iPhone review.
