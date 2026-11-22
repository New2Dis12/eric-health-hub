# Paired FIT evidence for one saved workout

The first activity uses the existing owner confirmation. To attach a second, use the candidate’s own evidence revision (zero for a new link) and confirm both activity IDs. The command pins the current partner evidence UUID. FIT file-ID manufacturer and explicit list manufacturer identify recording origin. Unknown or inconsistent origins cannot form a pair. Existing evidence without origin metadata can be refreshed by confirming its original ID. No background matching or historical backfill runs.

The two single-sport recordings must match the pinned workout modality. Their shared UTC window must cover at least 90% of the longer recording, including at least that much time inside the completed Stunna session. This conservative threshold may reject true pairs with large clock offsets or partial recordings. The original link and workout stay available for inspection.

Readback retains both source envelopes. The reconciled summary chooses one source per available metric. It reports differences, the contributing activity and evidence revision, and formulas for calculated values. Lap sample means use a half-open UTC window and the measured samples present in that window. Sampling every 30 seconds, the 120-sample limit and the 20-lap limit preclude exact prescribed interval estimates. Large MCP results expose both summaries and allow one source’s detail to be requested by evidence ID.

## Separately approved rollout

Before any hosted change, verify the target and deployed commit, migration ledger/checksums, owner-only access, runtime role restrictions, existing constraints and counts by provider. Obtain a restorable backup and verify restoration on an isolated database. Rehearse migration 010 and single/paired reads and writes in a separately authorized Protected Preview. Check for long transactions and lock holders on source_links. Use a bounded lock timeout and the existing transactional migrator in a maintenance window. A timeout requires rollback and a new window.

To pause new pairs while retaining single-source operations and paired readback, set STUNNA_PAIRED_EVIDENCE_DISABLED=true only under separate environment and release approval. Leave migration 010 in place when pairs exist. The down migration restores the original uniqueness constraint only when all rows satisfy it, and otherwise aborts without changing any source identity. Never delete, move or combine rows to make rollback succeed. Preserve both source histories before considering an older application version.
