-- SOURCE ONLY. Apply to an isolated hosted database only after separate approval.
-- Append-only revisions: old values and actor/reason survive every correction.
CREATE TABLE stunna.session_entries (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL,
  session_id uuid NOT NULL,
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('strength_set','interval','exercise_note','workout_note')),
  occurrence_id uuid,
  set_ordinal integer NOT NULL CHECK (set_ordinal BETWEEN 0 AND 50),
  revision integer NOT NULL CHECK (revision > 0),
  session_revision integer NOT NULL CHECK (session_revision > 1),
  value jsonb NOT NULL CHECK (jsonb_typeof(value)='object' AND octet_length(value::text)<=16000),
  before_value jsonb CHECK (before_value IS NULL OR (jsonb_typeof(before_value)='object' AND octet_length(before_value::text)<=16000)),
  actor_sub text NOT NULL CHECK (actor_sub=current_setting('stunna.subject',true)),
  source text NOT NULL CHECK (source IN ('browser','api')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (athlete_id,session_id) REFERENCES stunna.actual_sessions(athlete_id,id),
  UNIQUE(athlete_id,session_id,item_key,revision),
  UNIQUE(athlete_id,session_id,session_revision),
  CHECK ((kind='workout_note')=(occurrence_id IS NULL)),
  CHECK ((kind='strength_set')=(set_ordinal>0)),
  CHECK (kind NOT IN ('exercise_note','workout_note') OR (value ? 'notes' AND jsonb_typeof(value->'notes')='string' AND length(value->>'notes')<=4000)),
  CHECK (kind NOT IN ('strength_set','interval') OR value->>'source'='user_reported')
);
CREATE INDEX ON stunna.session_entries(athlete_id,session_id,session_revision);
ALTER TABLE stunna.session_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stunna.session_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY athlete_ownership ON stunna.session_entries
  USING (athlete_id IN (SELECT id FROM stunna.athletes))
  WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes));
-- Resolve occurrence identity against the immutable saved snapshot, not mutable plan.
CREATE FUNCTION stunna.check_entry_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved jsonb; saved_status text; occurrence jsonb; exercise jsonb; segment jsonb; metric jsonb;
BEGIN
  SELECT prescription_snapshot,status INTO saved,saved_status FROM stunna.actual_sessions
    WHERE athlete_id=NEW.athlete_id AND id=NEW.session_id;
  IF saved IS NULL OR saved_status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'Pinned active session required' USING ERRCODE='23514';
  END IF;
  IF NEW.occurrence_id IS NOT NULL THEN
    SELECT o INTO occurrence FROM jsonb_array_elements(saved->'occurrences') o WHERE o->>'id'=NEW.occurrence_id::text;
    IF occurrence IS NULL OR (NEW.kind IN ('strength_set','exercise_note') AND occurrence->>'type'<>'exercise')
      OR (NEW.kind='interval' AND occurrence->>'type' NOT IN ('warmup','interval')) THEN
      RAISE EXCEPTION 'Invalid pinned occurrence' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.item_key <> NEW.kind || ':' || coalesce(NEW.occurrence_id::text,'session') || ':' || NEW.set_ordinal::text THEN
    RAISE EXCEPTION 'Invalid entry identity' USING ERRCODE='23514';
  END IF;
  exercise := saved->'exercises'->((occurrence->>'exercise')::integer);
  IF NEW.kind='strength_set' THEN
    IF (exercise->>'sets') IS NULL OR NEW.set_ordinal > (exercise->>'sets')::integer OR
      NOT (NEW.value ?& ARRAY['reps','load','rpe','source']) OR
      NEW.value->>'source' IS DISTINCT FROM 'user_reported' OR
      (NEW.value->>'reps' IS NOT NULL AND ((NEW.value->>'reps')::numeric NOT BETWEEN 0 AND 500 OR (NEW.value->>'reps')::numeric <> trunc((NEW.value->>'reps')::numeric))) OR
      (NEW.value->>'rpe' IS NOT NULL AND (NEW.value->>'rpe')::numeric NOT BETWEEN 0 AND 10) OR
      (NEW.value->'load'<>'null'::jsonb AND (jsonb_typeof(NEW.value->'load')<>'object' OR
        NOT ((NEW.value->'load') ?& ARRAY['value','unit','basis']) OR
        NEW.value->'load'->>'unit' NOT IN ('kg','lb') OR
        NEW.value->'load'->>'basis' NOT IN ('total','per_hand','added','bodyweight') OR
        (NEW.value->'load'->>'value')::numeric NOT BETWEEN 0 AND 2000)) THEN
      RAISE EXCEPTION 'Invalid actual set' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.kind='interval' THEN
    segment := CASE WHEN occurrence->>'type'='warmup' THEN exercise->'warmups'->((occurrence->>'segment')::integer)
      ELSE exercise->'intervalBlocks'->((occurrence->>'block')::integer)->'segments'->((occurrence->>'segment')::integer) END;
    IF segment IS NULL OR segment->>'modality' NOT IN ('run','row','bike','ski') OR
      NEW.value->>'source' IS DISTINCT FROM 'user_reported' OR
      NOT (NEW.value ?& ARRAY['metrics','rpe','source']) OR (NEW.value->>'rpe' IS NOT NULL AND (NEW.value->>'rpe')::numeric NOT BETWEEN 0 AND 10) OR jsonb_typeof(NEW.value->'metrics') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.value->'metrics')>8 THEN
      RAISE EXCEPTION 'Invalid actual interval' USING ERRCODE='23514';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT m->>'metric') FROM jsonb_array_elements(NEW.value->'metrics') m) THEN
      RAISE EXCEPTION 'Duplicate actual metric' USING ERRCODE='23514';
    END IF;
    FOR metric IN SELECT * FROM jsonb_array_elements(NEW.value->'metrics') LOOP
      IF NOT (metric ?& ARRAY['metric','unit','value']) OR
        NOT (CASE metric->>'metric'
          WHEN 'duration' THEN metric->>'unit'='s'
          WHEN 'distance' THEN metric->>'unit' IN ('m','km','mi')
          WHEN 'speed' THEN metric->>'unit' IN ('m/s','km/h','mph')
          WHEN 'pace' THEN metric->>'unit' IN ('sec/km','sec/mi') AND segment->>'modality' IN ('run','ski')
          WHEN 'power' THEN metric->>'unit'='W'
          WHEN 'rowing_split' THEN metric->>'unit'='sec/500m' AND segment->>'modality'='row'
          WHEN 'stroke_rate' THEN metric->>'unit'='spm' AND segment->>'modality'='row'
          WHEN 'cycling_cadence' THEN metric->>'unit'='rpm' AND segment->>'modality'='bike'
          ELSE false END) OR
        (metric->>'value' IS NOT NULL AND (metric->>'value')::numeric NOT BETWEEN 0 AND CASE metric->>'metric' WHEN 'duration' THEN 86400 WHEN 'distance' THEN 1000000 WHEN 'speed' THEN 200 WHEN 'pace' THEN 86400 WHEN 'power' THEN 5000 WHEN 'rowing_split' THEN 86400 ELSE 300 END) THEN
        RAISE EXCEPTION 'Invalid actual metric' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_entry_occurrence BEFORE INSERT ON stunna.session_entries
  FOR EACH ROW EXECUTE FUNCTION stunna.check_entry_occurrence();
