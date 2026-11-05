-- Development only. Run as owner in a transaction after verifying the branch.
-- SET LOCAL stunna.allow_synthetic_seed = 'on';
-- Optionally SET LOCAL stunna.fixture_subject and stunna.fixture_date.
DO $$
DECLARE
  subject text := coalesce(nullif(current_setting('stunna.fixture_subject', true), ''), 'auth0|stunna-sprint2-synthetic');
  day date := coalesce(nullif(current_setting('stunna.fixture_date', true), '')::date, timezone('America/Chicago', now())::date);
  athlete uuid := gen_random_uuid();
  block uuid := gen_random_uuid();
  strength uuid := gen_random_uuid();
  run uuid := gen_random_uuid();
  strength_items jsonb := '[
    {"key":"goblet-squat","name":"Goblet squat","sets":3,"reps":8,"durationSeconds":null,"target":{"value":40,"unit":"lb"},"restSeconds":90,"notes":"Keep each rep controlled."},
    {"key":"dumbbell-row","name":"Single-arm dumbbell row","sets":3,"reps":10,"durationSeconds":null,"target":{"value":25,"unit":"lb"},"restSeconds":75,"notes":"Reps per side."},
    {"key":"side-plank","name":"Side plank","sets":2,"reps":null,"durationSeconds":30,"target":null,"restSeconds":45,"notes":"Hold on each side."}
  ]';
BEGIN
  IF current_setting('stunna.allow_synthetic_seed', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Synthetic seed requires explicit development opt-in';
  END IF;
  IF EXISTS (SELECT 1 FROM stunna.athletes WHERE auth0_sub = subject) THEN
    RAISE EXCEPTION 'Fixture subject already exists';
  END IF;
  INSERT INTO stunna.athletes(id, auth0_sub, time_zone) VALUES (athlete, subject, 'America/Chicago');
  INSERT INTO stunna.training_preferences(athlete_id, training_focus) VALUES (athlete, 'Demo block · Build consistency with controlled work');
  INSERT INTO stunna.training_blocks(id, athlete_id, title, goal, starts_on, ends_on, source)
    VALUES (block, athlete, 'Demo foundation', 'Build consistent movement and aerobic work', day-7, day+21, 'manual');
  INSERT INTO stunna.planned_sessions(id, athlete_id, block_id, scheduled_at, time_zone, kind, purpose, source) VALUES
    (strength, athlete, block, (day + time '07:00') AT TIME ZONE 'America/Chicago', 'America/Chicago', 'strength', 'Full-body strength with steady technique.', 'manual'),
    (run, athlete, block, (day+1 + time '07:30') AT TIME ZONE 'America/Chicago', 'America/Chicago', 'run', 'Practice repeatable treadmill intervals.', 'manual'),
    (gen_random_uuid(), athlete, block, (day+3 + time '08:00') AT TIME ZONE 'America/Chicago', 'America/Chicago', 'mobility', 'Mobility session awaiting an approved prescription.', 'manual');
  INSERT INTO stunna.prescription_revisions(athlete_id, planned_session_id, revision, title, exercises, change_reason, source, approved_at) VALUES
    (athlete, strength, 1, 'Full-body strength', jsonb_set(strength_items, '{0,target,value}', '35'), 'Initial synthetic prescription.', 'synthetic', now() - interval '1 minute'),
    (athlete, strength, 2, 'Full-body strength', strength_items, 'Demo correction sets the goblet squat target to 40 lb.', 'synthetic', now()),
    (athlete, run, 1, 'Treadmill intervals', '[
      {"key":"easy-warmup","name":"Easy warm-up","sets":1,"reps":null,"durationSeconds":300,"target":{"value":4.5,"unit":"mph"},"restSeconds":0,"notes":null},
      {"key":"treadmill-repeat","name":"Steady repeat","sets":4,"reps":null,"durationSeconds":120,"target":{"value":6,"unit":"mph"},"restSeconds":60,"notes":"Walk during recovery."}
    ]', 'Initial synthetic interval prescription.', 'synthetic', now());
  INSERT INTO stunna.exercise_benchmarks(id, athlete_id, exercise_key, performed_at, performance, source) VALUES
    (gen_random_uuid(), athlete, 'goblet-squat', (day-3 + time '07:00') AT TIME ZONE 'America/Chicago',
     '{"sets":3,"reps":8,"durationSeconds":null,"target":{"value":35,"unit":"lb"}}', 'synthetic'),
    (gen_random_uuid(), athlete, 'treadmill-repeat', (day-4 + time '07:00') AT TIME ZONE 'America/Chicago',
     '{"sets":4,"reps":null,"durationSeconds":120,"target":{"value":5.8,"unit":"mph"}}', 'synthetic');
END $$;
