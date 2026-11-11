-- Source only: development migration, NOT authorized for hosted execution.
-- Preserve strict live player constraints while representing date-only, unplanned history.
ALTER TABLE stunna.actual_sessions
  ALTER COLUMN planned_session_id DROP NOT NULL,
  ALTER COLUMN started_at DROP NOT NULL,
  ADD COLUMN is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN historical_on date,
  ADD COLUMN historical_modality text,
  ADD COLUMN historical_precision text;
ALTER TABLE stunna.actual_sessions DROP CONSTRAINT actual_sessions_check1;
ALTER TABLE stunna.actual_sessions DROP CONSTRAINT actual_sessions_source_check;
ALTER TABLE stunna.actual_sessions ADD CONSTRAINT actual_sessions_source_check
 CHECK (source IN ('manual','api','reviewed_import'));
ALTER TABLE stunna.actual_sessions ADD CONSTRAINT actual_sessions_live_or_historical CHECK (
  (NOT is_historical AND source IN ('manual','api') AND planned_session_id IS NOT NULL AND started_at IS NOT NULL
   AND historical_on IS NULL AND historical_modality IS NULL AND historical_precision IS NULL
   AND (status='completed')=(completed_at IS NOT NULL))
  OR
  (is_historical AND source='reviewed_import' AND planned_session_id IS NULL
   AND historical_on IS NOT NULL AND status='completed' AND completed_at IS NULL
   AND historical_modality IS NOT NULL AND historical_precision IS NOT NULL
   AND historical_modality IN ('strength','run','bike','swim','row','ski','mobility','other')
   AND historical_precision IN ('date','exact')
   AND ((historical_precision='date' AND started_at IS NULL)
        OR (historical_precision='exact' AND started_at IS NOT NULL)))
);
CREATE INDEX actual_sessions_history_page ON stunna.actual_sessions
  (athlete_id,historical_on DESC,id DESC) WHERE is_historical;
-- A file/version is immutable. Later versions append new evidence, never erase older provenance.
CREATE TABLE stunna.historical_import_files (
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 120),
  file_version integer NOT NULL CHECK (file_version > 0),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  authority integer NOT NULL CHECK (authority BETWEEN 1 AND 100),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(athlete_id,source_key,file_version),
  UNIQUE(athlete_id,source_key,checksum)
);
CREATE TABLE stunna.historical_evidence (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  source_key text NOT NULL,
  source_record_id text NOT NULL CHECK (length(source_record_id) BETWEEN 1 AND 150),
  logical_record_id text CHECK (length(logical_record_id) BETWEEN 1 AND 150),
  source_version integer NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  category text NOT NULL CHECK (category IN
    ('workout','measurement','bia_estimate','recovery','plan','benchmark',
     'profile','event','coaching','wearable_rule','nutrition','unknown')),
  representation text NOT NULL CHECK (representation IN ('represented','optional_unknowns','deferred')),
  provenance text NOT NULL CHECK (provenance IN ('measured','reported','estimated','prescribed','unknown')),
  session_id uuid,
  observed_on date,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16000),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(athlete_id,source_key,source_version)
    REFERENCES stunna.historical_import_files(athlete_id,source_key,file_version),
  FOREIGN KEY(athlete_id,session_id) REFERENCES stunna.actual_sessions(athlete_id,id),
  UNIQUE(athlete_id,source_key,source_record_id,revision),
  CHECK ((category='workout' AND representation<>'deferred')=(session_id IS NOT NULL)),
  CHECK (category<>'bia_estimate' OR provenance='estimated'),
  CHECK (category<>'recovery' OR session_id IS NULL)
);
CREATE INDEX historical_evidence_latest ON stunna.historical_evidence
  (athlete_id,source_key,source_record_id,revision DESC);
CREATE INDEX historical_evidence_logical ON stunna.historical_evidence
  (athlete_id,logical_record_id) WHERE logical_record_id IS NOT NULL;
CREATE INDEX historical_evidence_session ON stunna.historical_evidence
  (athlete_id,session_id,revision DESC) WHERE session_id IS NOT NULL;
ALTER TABLE stunna.historical_import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE stunna.historical_import_files FORCE ROW LEVEL SECURITY;
CREATE POLICY athlete_ownership ON stunna.historical_import_files
  USING (athlete_id IN (SELECT id FROM stunna.athletes))
  WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes));
ALTER TABLE stunna.historical_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE stunna.historical_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY athlete_ownership ON stunna.historical_evidence
  USING (athlete_id IN (SELECT id FROM stunna.athletes))
  WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes));
-- Runtime role receives only INSERT/SELECT on append-only provenance tables
-- and narrowly scoped historical session fields (see db/runtime-grants.sql).
