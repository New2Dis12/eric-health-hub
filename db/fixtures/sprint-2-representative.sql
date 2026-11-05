-- Run only on the isolated development branch with the synthetic-seed opt-in.
DO $$
DECLARE
  subject text := coalesce(nullif(current_setting('stunna.fixture_subject',true),''),'auth0|stunna-sprint2-synthetic');
  athlete uuid;
  block uuid;
  anchor date;
  plan uuid;
BEGIN
  IF current_setting('stunna.allow_synthetic_seed',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Synthetic seed requires explicit development opt-in';
  END IF;
  SELECT a.id,b.id,b.starts_on+7 INTO STRICT athlete,block,anchor FROM stunna.athletes a
    JOIN stunna.training_blocks b ON b.athlete_id=a.id
    WHERE a.auth0_sub=subject AND b.title='Demo foundation';
  IF EXISTS (SELECT 1 FROM stunna.block_context_revisions WHERE athlete_id=athlete AND block_id=block) THEN
    RAISE EXCEPTION 'Representative fixture already exists';
  END IF;
  UPDATE stunna.exercise_benchmarks SET verification_status='verified',
    source_reference='Synthetic demo evidence' WHERE athlete_id=athlete AND source='synthetic';
  INSERT INTO stunna.block_context_revisions(athlete_id,block_id,revision,context,change_reason) VALUES
    (athlete,block,1,'{
      "weeklyStructure":[{"weekday":2,"slots":["Run","Strength"]},{"weekday":4,"slots":["Recovery"]}],
      "progressionRules":["Apply only reviewed date-specific adjustments.","Change one training variable at a time; retain explicit unknown targets."],
      "sourceReferences":["Synthetic methodology fixture; no personal records"]
    }','Synthetic methodology demonstration.');
  -- Running revision encodes the ordered work and recovery, including warm-up.
  INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source)
    SELECT athlete,p.id,2,'Demo run intervals','[{
      "key":"demo-run-interval","name":"Treadmill work and recovery","sets":null,"reps":null,"durationSeconds":null,"target":null,"restSeconds":null,"notes":"Synthetic targets for interface review.",
      "warmups":[{"phase":"warmup","modality":"run","label":"Gradual warm-up","durationSeconds":240,"targets":[],"rpe":{"min":2,"max":3}}],
      "intervalBlocks":[{"repeat":3,"segments":[
        {"phase":"work","modality":"run","label":"Work","durationSeconds":90,"targets":[{"metric":"speed","unit":"mph","range":{"min":5.4,"max":5.6}}],"rpe":{"min":6,"max":7}},
        {"phase":"recovery","modality":"run","label":"Easy recovery","durationSeconds":75,"targets":[{"metric":"pace","unit":"sec/km","range":null}],"rpe":{"min":2,"max":3}}
      ]}]
    }]','Add structured synthetic segments.','synthetic'
    FROM stunna.planned_sessions p WHERE p.athlete_id=athlete AND p.kind='run';
  plan := gen_random_uuid();
  INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,scheduled_at,time_zone,kind,purpose,source)
    VALUES(plan,athlete,block,(anchor+1+time '09:00') AT TIME ZONE 'America/Chicago','America/Chicago','strength','Combined-day strength after the run; synthetic example.','manual');
  INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES
    (athlete,plan,1,'Demo combined-day strength','[{
      "key":"demo-db-press","name":"Dumbbell floor press","sets":2,"reps":null,"repsRange":{"min":8,"max":10},
      "durationSeconds":null,"target":{"value":20,"unit":"lb"},"loadBasis":"per_hand","restSeconds":75,"notes":null,
      "rpe":{"min":6,"max":7},"equipment":"Dumbbell pair","optional":false,
      "comparisonContext":"floor press; per-hand load",
      "sourceReferences":["Synthetic plan fixture"],
      "adjustments":[{"condition":"If the prescribed equipment is unavailable","action":"Use the reviewed alternative with effort-based loading.","substitution":{"exerciseKey":"demo-pushup","name":"Incline push-up","equipment":"Stable bench"}}]
    },{
      "key":"demo-optional-core","name":"Optional trunk hold","sets":2,"reps":null,"durationSeconds":20,"target":null,"restSeconds":30,"notes":null,"optional":true,
      "adjustments":[{"condition":"If accumulated fatigue remains high","action":"Omit this optional support exercise."}]
    }]','Synthetic combined-day demonstration.','synthetic');
  plan := gen_random_uuid();
  INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,scheduled_at,time_zone,kind,purpose,source)
    VALUES(plan,athlete,block,(anchor+2+time '07:00') AT TIME ZONE 'America/Chicago','America/Chicago','other','Rowing with distinct split and stroke-rate targets.','manual');
  INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES
    (athlete,plan,1,'Demo rowing intervals','[{
      "key":"demo-row-interval","name":"Controlled rowing","sets":null,"reps":null,"durationSeconds":null,"target":null,"restSeconds":null,"notes":"Synthetic targets, not a verified threshold.",
      "intervalBlocks":[{"repeat":3,"segments":[
        {"phase":"work","modality":"row","label":"Distance interval","durationSeconds":null,"targets":[{"metric":"distance","unit":"m","range":{"min":400,"max":400}},{"metric":"rowing_split","unit":"sec/500m","range":{"min":165,"max":175}},{"metric":"stroke_rate","unit":"spm","range":{"min":20,"max":22}}],"rpe":{"min":6,"max":7}},
        {"phase":"recovery","modality":"row","label":"Easy row","durationSeconds":90,"targets":[],"rpe":{"min":2,"max":3}}
      ]}]
    }]','Synthetic rowing demonstration.','synthetic');
  plan := gen_random_uuid();
  INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,scheduled_at,time_zone,kind,purpose,source)
    VALUES(plan,athlete,block,(anchor+4+time '07:00') AT TIME ZONE 'America/Chicago','America/Chicago','bike','Bike power and cycling cadence, separate from rowing stroke rate.','manual');
  INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES
    (athlete,plan,1,'Demo cycling intervals','[{
      "key":"demo-bike-interval","name":"Bike work and recovery","sets":null,"reps":null,"durationSeconds":null,"target":null,"restSeconds":null,"notes":null,
      "intervalBlocks":[{"repeat":4,"segments":[
        {"phase":"work","modality":"bike","label":"Steady work","durationSeconds":60,"targets":[{"metric":"power","unit":"W","range":{"min":120,"max":160}},{"metric":"cycling_cadence","unit":"rpm","range":{"min":75,"max":90}}],"rpe":{"min":6,"max":7}},
        {"phase":"recovery","modality":"bike","label":"Easy spin","durationSeconds":90,"targets":[],"rpe":{"min":2,"max":3}}
      ]}]
    }]','Synthetic cycling demonstration.','synthetic');
END $$;
