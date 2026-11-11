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

The private adapter accepts explicitly normalized, source-record-ID-keyed values, not arbitrary raw Markdown guessed into workout rows. `inspectMarkdownStructure` reports structural heading counts and supported classes without revealing text. The private coordinator must supply stable logical record IDs, file checksum/version, source authority, explicit completion evidence, modality and original units. Unknown values remain null. Unmapped categories are retained as `unknown` with `deferred` representation and counted for owner review. The worker cannot assert that the nine private files are completely mapped without access.

`createHistoricalService.importHistory` is deliberately not exposed by an HTTP or MCP write endpoint. It requires training.write and an explicit private authorization argument, and is validated only with synthetic PGlite fixtures. No hosted import is authorized. Read-only `GET /api/training/history` and `get_historical_training` are athlete-scoped, bounded and feature-flagged. Historical evidence is append-only; file-version and record-revision history survive corrections. Missing logical IDs in later full-file snapshots are counted as `missingFromSnapshot` and retained for private review, never deleted. `db/migrations/008_historical_import.down.sql` refuses to drop populated history. Apply no hosted SQL under Issue #30 development approval.
