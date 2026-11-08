-- Refuse rollback if execution history exists. Preserve append-only user data.
ALTER TABLE stunna.session_entries ADD CONSTRAINT session_entries_legacy_kind_check
  CHECK (kind IN ('strength_set','interval','exercise_note','workout_note'));
DROP TRIGGER session_entry_execution_occurrence ON stunna.session_entries;
DROP FUNCTION stunna.check_execution_occurrence();
ALTER TABLE stunna.session_entries DROP CONSTRAINT session_entries_execution_check_value;
ALTER TABLE stunna.session_entries DROP CONSTRAINT session_entries_kind_check;
ALTER TABLE stunna.session_entries RENAME CONSTRAINT session_entries_legacy_kind_check TO session_entries_kind_check;
