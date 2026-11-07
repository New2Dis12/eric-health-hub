-- Additive proposal; local synthetic validation only. Not applied to hosted DBs.
ALTER TABLE stunna.actual_sessions
  ADD COLUMN prescription_revision integer,
  ADD COLUMN prescription_snapshot jsonb,
  ADD CONSTRAINT session_prescription_pair CHECK ((prescription_revision IS NULL) = (prescription_snapshot IS NULL)),
  ADD CONSTRAINT session_snapshot_object CHECK (prescription_snapshot IS NULL OR
    (jsonb_typeof(prescription_snapshot)='object' AND octet_length(prescription_snapshot::text)<=1000000)),
  ADD CONSTRAINT session_prescription_owner FOREIGN KEY (athlete_id,planned_session_id,prescription_revision)
    REFERENCES stunna.prescription_revisions(athlete_id,planned_session_id,revision);
-- Legacy rows remain explicitly unpinned. Never backfill invented prescriptions.
CREATE FUNCTION stunna.keep_session_prescription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.prescription_revision IS DISTINCT FROM OLD.prescription_revision
    OR NEW.prescription_snapshot IS DISTINCT FROM OLD.prescription_snapshot THEN
    RAISE EXCEPTION 'Session prescription is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_session_prescription BEFORE UPDATE ON stunna.actual_sessions
  FOR EACH ROW EXECUTE FUNCTION stunna.keep_session_prescription();
