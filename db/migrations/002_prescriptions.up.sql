-- Approved revisions are complete snapshots. Array order is prescription order.
CREATE TABLE stunna.prescription_revisions (
  athlete_id uuid NOT NULL,
  planned_session_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  exercises jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(exercises) = 'array' THEN jsonb_array_length(exercises) BETWEEN 1 AND 24 ELSE false END
    AND octet_length(exercises::text) <= 20000
  ),
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 1 AND 500),
  source text NOT NULL CHECK (source IN ('manual','reviewed_import','synthetic')),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, planned_session_id, revision),
  FOREIGN KEY (athlete_id, planned_session_id) REFERENCES stunna.planned_sessions(athlete_id, id)
);

CREATE TABLE stunna.training_preferences (
  athlete_id uuid PRIMARY KEY REFERENCES stunna.athletes(id),
  show_previous boolean NOT NULL DEFAULT true,
  training_focus text CHECK (length(btrim(training_focus)) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reviewed historical evidence only. Sprint 3 owns actual set entry.
CREATE TABLE stunna.exercise_benchmarks (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  exercise_key text NOT NULL CHECK (exercise_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  performed_at timestamptz NOT NULL,
  performance jsonb NOT NULL CHECK (jsonb_typeof(performance) = 'object' AND octet_length(performance::text) <= 2000),
  source text NOT NULL CHECK (source IN ('reviewed_import','synthetic'))
);
CREATE INDEX ON stunna.exercise_benchmarks (athlete_id, exercise_key, performed_at DESC, id DESC);

DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prescription_revisions','training_preferences','exercise_benchmarks'] LOOP
    EXECUTE format('ALTER TABLE stunna.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE stunna.%I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('CREATE POLICY athlete_ownership ON stunna.%I USING (athlete_id IN (SELECT id FROM stunna.athletes)) WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes))', tab);
  END LOOP;
END $$;
