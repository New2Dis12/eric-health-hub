-- Destructive review-only rollback: back up historical records before using.
-- Refuse rollback while imported history exists; never silently discard it.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM stunna.historical_evidence) OR
    EXISTS (SELECT 1 FROM stunna.historical_import_files) OR
    EXISTS (SELECT 1 FROM stunna.actual_sessions WHERE is_historical) THEN
   RAISE EXCEPTION 'Historical records exist: export/reconcile before rollback';
 END IF;
END $$;
DROP TABLE stunna.historical_evidence;
DROP TABLE stunna.historical_import_files;
DROP INDEX stunna.actual_sessions_history_page;
ALTER TABLE stunna.actual_sessions DROP CONSTRAINT actual_sessions_live_or_historical;
ALTER TABLE stunna.actual_sessions DROP COLUMN historical_precision,
 DROP COLUMN historical_modality, DROP COLUMN historical_on, DROP COLUMN is_historical;
ALTER TABLE stunna.actual_sessions ALTER COLUMN started_at SET NOT NULL,
 ALTER COLUMN planned_session_id SET NOT NULL;
ALTER TABLE stunna.actual_sessions ADD CONSTRAINT actual_sessions_check1
 CHECK ((status='completed')=(completed_at IS NOT NULL));

ALTER TABLE stunna.actual_sessions DROP CONSTRAINT actual_sessions_source_check;
ALTER TABLE stunna.actual_sessions ADD CONSTRAINT actual_sessions_source_check CHECK (source IN ('manual','api'));
