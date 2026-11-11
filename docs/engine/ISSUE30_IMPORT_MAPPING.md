# Issue #30 private historical source mapping contract (development only)

No private Markdown files were available to this worker. **No real-data dry-run or coverage claims.** The coordinator performs a separate private read-only mapping and records only category counts publicly.

| Source class | Target category | Representation |
| --- | --- | --- |
| profile | profile | structured athlete attributes; otherwise deferred |
| block_prescriptions | plan | prescribed, never workout actual |
| baselines | benchmark | historical benchmark evidence |
| training_log | workout / recovery | confirmed workout only becomes session; recovery never does |
| body_composition | measurement / bia_estimate / nutrition | BIA always estimated; date-only supported |
| wearable_rules | wearable_rule | provenance/authority rule |
| events_benchmarks | event / benchmark | event is not completed workout |
| coaching_handoff | coaching / profile | guidance is not performance |
| sync_manifest | unknown | file version/authority manifest; unmapped material deferred |

The private adapter accepts both explicitly normalized source-record-ID-keyed batches and a
**strict marked Markdown dialect** through `normalizeHistoricalMarkdown`. Each record is
delimited by `<!-- stunna-record: stable-logical-id -->` and has `- category:`,
`- occurredOn:`, `- modality:`, `- completion:`, `- precision:` and
`- provenance:` fields when it is a workout. Native Markdown strength tables with columns `exercise | sets | reps | load | unit | basis | rpe | verification` are parsed with unknown numeric cells retained as null. Optional `- logicalRecordId:`
joins corroborating workouts across sources; explicit `- strength:` and
`- metrics:` fields contain JSON arrays conforming to the published observation
schemas. Nonworkout `- attr.name:` fields map typed structured attributes.
Unmarked or incomplete material is enumerated as unmapped/deferred rather than
interpreted as an actual workout. No date/time, completion, or measurement is
inferred. The checksum is SHA-256 of the private source Markdown; no private
source text, checksum or personal record may be committed to public GitHub.
`inspectMarkdownStructure` provides structural counts only. A private
coordinator must map real source formats into this explicit dialect, or retain
unmapped categories and counts; this source PR does not claim private coverage. The private coordinator must supply stable logical record IDs (shared across sources only for the same actual session), file checksum/version, source authority, explicit completion evidence, modality and original units. Unknown values remain null. Unmapped categories are retained as `unknown` with `deferred` representation and counted for owner review. The worker cannot assert that the nine private files are completely mapped without access.

`createHistoricalService.importHistory` is deliberately not exposed by an HTTP or MCP write endpoint. It requires training.write and an explicit private authorization argument, and is validated only with synthetic PGlite fixtures. No hosted import is authorized. Read-only `GET /api/training/history` and `get_historical_training` are athlete-scoped, bounded and feature-flagged. Historical evidence is append-only; file-version and record-revision history survive corrections. Missing logical IDs in later full-file snapshots are counted as `missingFromSnapshot` and retained for private review, never deleted. `db/migrations/008_historical_import.down.sql` refuses to drop populated history. Apply no hosted SQL under Issue #30 development approval.

Cross-source precedence uses the highest declared authority, breaking ties by lexical source key. Every source keeps independent immutable evidence revisions, including its own modality, time precision and original start time. The legacy training list excludes historical rows so its existing live-session shape and pagination remain unchanged.
