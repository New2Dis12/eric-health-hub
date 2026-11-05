-- Older evidence needs explicit review before it is presented as comparable.
ALTER TABLE stunna.exercise_benchmarks
  ADD COLUMN verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','unverified')),
  ADD COLUMN comparison_context text NOT NULL DEFAULT '' CHECK (length(comparison_context) <= 400),
  ADD COLUMN source_reference text CHECK (length(btrim(source_reference)) BETWEEN 1 AND 400);

-- Authored weekly structure and progression guidance, separate from dated plans.
CREATE TABLE stunna.block_context_revisions (
  athlete_id uuid NOT NULL,
  block_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  context jsonb NOT NULL CHECK (jsonb_typeof(context)='object' AND octet_length(context::text) <= 12000),
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 1 AND 500),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, block_id, revision),
  FOREIGN KEY (athlete_id, block_id) REFERENCES stunna.training_blocks(athlete_id,id)
);
ALTER TABLE stunna.block_context_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stunna.block_context_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY athlete_ownership ON stunna.block_context_revisions
  USING (athlete_id IN (SELECT id FROM stunna.athletes))
  WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes));
