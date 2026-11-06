-- Development rollback only; drops pinned snapshot evidence. Never run for routine recovery.
DROP TRIGGER immutable_session_prescription ON stunna.actual_sessions;
DROP FUNCTION stunna.keep_session_prescription();
ALTER TABLE stunna.actual_sessions DROP COLUMN prescription_snapshot, DROP COLUMN prescription_revision;
