-- Source only. Hosted application requires separate approval.
ALTER TABLE stunna.session_entries DROP CONSTRAINT session_entries_kind_check;
ALTER TABLE stunna.session_entries ADD CONSTRAINT session_entries_kind_check
  CHECK (kind IN ('strength_set','interval','exercise_note','workout_note','execution_check'));
ALTER TABLE stunna.session_entries ADD CONSTRAINT session_entries_execution_check_value
  CHECK (kind <> 'execution_check' OR (
    coalesce(jsonb_typeof(value->'checked') = 'boolean', false)
    AND value - 'checked' = '{}'::jsonb
    AND (before_value IS NULL OR (
      coalesce(jsonb_typeof(before_value->'checked') = 'boolean', false)
      AND before_value - 'checked' = '{}'::jsonb
    ))
  ));

-- The existing trigger still enforces active pinned session and entry identity.
CREATE FUNCTION stunna.check_execution_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb; occurrence jsonb; exercise jsonb; block jsonb; segment jsonb;
BEGIN
  SELECT prescription_snapshot INTO snapshot FROM stunna.actual_sessions
    WHERE athlete_id = NEW.athlete_id AND id = NEW.session_id AND status = 'in_progress';
  SELECT o INTO occurrence FROM jsonb_array_elements(snapshot->'occurrences') o
    WHERE o->>'id' = NEW.occurrence_id::text;
  exercise := snapshot->'exercises'->((occurrence->>'exercise')::integer);
  IF coalesce(jsonb_array_length(exercise->'intervalBlocks'), 0) > 0 THEN
    IF occurrence->>'type' = 'warmup' THEN
      segment := exercise->'warmups'->((occurrence->>'segment')::integer);
    ELSIF occurrence->>'type' = 'interval' THEN
      block := exercise->'intervalBlocks'->((occurrence->>'block')::integer);
      IF (occurrence->>'repeat')::integer >= 0 AND
         (occurrence->>'repeat')::integer < (block->>'repeat')::integer THEN
        segment := block->'segments'->((occurrence->>'segment')::integer);
      END IF;
    END IF;
  END IF;
  IF jsonb_typeof(segment) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Expected pinned interval protocol segment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_entry_execution_occurrence BEFORE INSERT ON stunna.session_entries
  FOR EACH ROW WHEN (NEW.kind = 'execution_check') EXECUTE FUNCTION stunna.check_execution_occurrence();
