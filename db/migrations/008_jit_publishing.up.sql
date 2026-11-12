-- Source-only migration. Date-only intent is not a fabricated scheduled start time.
ALTER TABLE stunna.planned_sessions ALTER COLUMN scheduled_at DROP NOT NULL;
ALTER TABLE stunna.planned_sessions ADD COLUMN planned_on date;
ALTER TABLE stunna.planned_sessions ADD CONSTRAINT planned_session_date_or_instant
  CHECK ((planned_on IS NULL) <> (scheduled_at IS NULL));
CREATE INDEX ON stunna.planned_sessions(athlete_id, planned_on, id) WHERE planned_on IS NOT NULL;

-- Existing approved revisions remain immutable and retain truthful null approval provenance.
ALTER TABLE stunna.prescription_revisions DROP CONSTRAINT prescription_revisions_source_check;
ALTER TABLE stunna.prescription_revisions ADD CONSTRAINT prescription_revisions_source_check
  CHECK (source IN ('manual','reviewed_import','synthetic','api'));
ALTER TABLE stunna.prescription_revisions ADD COLUMN approval_note text
  CHECK (approval_note IS NULL OR length(btrim(approval_note)) BETWEEN 10 AND 500);
-- No UPDATE/DELETE grant or table-owner access to the runtime role; use db/runtime-grants.sql.
