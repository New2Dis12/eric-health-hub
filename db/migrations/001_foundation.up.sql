CREATE SCHEMA stunna;

CREATE TABLE stunna.athletes (
  id uuid PRIMARY KEY,
  auth0_sub text NOT NULL UNIQUE CHECK (length(auth0_sub) BETWEEN 1 AND 255),
  time_zone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stunna.training_blocks (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  goal text NOT NULL CHECK (length(goal) BETWEEN 1 AND 2000),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source text NOT NULL CHECK (source IN ('manual', 'reviewed_import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, id)
);
CREATE TABLE stunna.planned_sessions (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  block_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('strength','run','bike','swim','mobility','other')),
  purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 2000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source text NOT NULL CHECK (source IN ('manual', 'reviewed_import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, id),
  FOREIGN KEY (athlete_id, block_id) REFERENCES stunna.training_blocks(athlete_id, id)
);
CREATE TABLE stunna.actual_sessions (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  planned_session_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz CHECK (completed_at >= started_at),
  status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  rpe double precision CHECK (rpe BETWEEN 0 AND 10),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source text NOT NULL CHECK (source IN ('manual', 'api')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, planned_session_id),
  UNIQUE (athlete_id, id),
  FOREIGN KEY (athlete_id, planned_session_id) REFERENCES stunna.planned_sessions(athlete_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE TABLE stunna.body_measurements (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  kind text NOT NULL CHECK (kind IN ('weight', 'waist')),
  value double precision NOT NULL CHECK (value > 0 AND value <= 2000),
  unit text NOT NULL,
  measured_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'api')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'weight' AND unit IN ('kg','lb')) OR (kind = 'waist' AND unit IN ('cm','in')))
);
CREATE TABLE stunna.audit_events (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  actor_sub text NOT NULL,
  operation text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before_revision integer,
  after_revision integer NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  source text NOT NULL CHECK (source IN ('browser','api')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
-- The response snapshot makes an exact retry stable even after a later correction.
CREATE TABLE stunna.write_requests (
  athlete_id uuid NOT NULL REFERENCES stunna.athletes(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, idempotency_key)
);
CREATE INDEX ON stunna.planned_sessions (athlete_id, scheduled_at, id);
CREATE INDEX ON stunna.actual_sessions (athlete_id, started_at, id);
CREATE INDEX ON stunna.body_measurements (athlete_id, measured_at, id);
CREATE INDEX ON stunna.audit_events (athlete_id, occurred_at, id);

ALTER TABLE stunna.athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stunna.athletes FORCE ROW LEVEL SECURITY;
CREATE POLICY athlete_identity ON stunna.athletes
  USING (auth0_sub = current_setting('stunna.subject', true))
  WITH CHECK (auth0_sub = current_setting('stunna.subject', true));

DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['training_blocks','planned_sessions','actual_sessions','body_measurements','audit_events','write_requests'] LOOP
    EXECUTE format('ALTER TABLE stunna.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE stunna.%I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('CREATE POLICY athlete_ownership ON stunna.%I USING (athlete_id IN (SELECT id FROM stunna.athletes)) WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes))', tab);
  END LOOP;
END $$;
-- Audit history and measurements are append-only. The runtime role must not own tables.
-- Grant only SELECT/INSERT on those tables (see the setup runbook).
