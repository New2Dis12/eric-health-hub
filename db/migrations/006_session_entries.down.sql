-- Destructive development rollback only; never routine recovery of confirmed data.
DROP TABLE stunna.session_entries;
DROP FUNCTION stunna.check_entry_occurrence();
