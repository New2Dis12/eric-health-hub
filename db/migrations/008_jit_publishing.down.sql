-- Rollback is blocked if date-only placeholders or API-approved revisions exist.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM stunna.planned_sessions WHERE planned_on IS NOT NULL)
    OR EXISTS(SELECT 1 FROM stunna.prescription_revisions WHERE source='api' OR approval_note IS NOT NULL) THEN
    RAISE EXCEPTION 'Export or remove new date-only plans and API approvals before rollback';
  END IF;
END $$;
-- Undo the extra append-only grant when the runtime role exists.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='stunna_runtime') THEN
    REVOKE INSERT ON stunna.prescription_revisions, stunna.block_context_revisions FROM stunna_runtime;
  END IF;
END $$;
DROP INDEX IF EXISTS stunna.planned_sessions_athlete_id_planned_on_id_idx;
ALTER TABLE stunna.prescription_revisions DROP COLUMN approval_note;
ALTER TABLE stunna.prescription_revisions DROP CONSTRAINT prescription_revisions_source_check;
ALTER TABLE stunna.prescription_revisions ADD CONSTRAINT prescription_revisions_source_check
  CHECK (source IN ('manual','reviewed_import','synthetic'));
ALTER TABLE stunna.planned_sessions DROP CONSTRAINT planned_session_date_or_instant;
ALTER TABLE stunna.planned_sessions DROP COLUMN planned_on;
ALTER TABLE stunna.planned_sessions ALTER COLUMN scheduled_at SET NOT NULL;
