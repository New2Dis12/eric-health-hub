-- Append presentation-only revisions to synthetic prescriptions on development.
DO $$
BEGIN
  IF current_setting('stunna.allow_synthetic_seed',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Synthetic seed requires explicit development opt-in';
  END IF;
  INSERT INTO stunna.prescription_revisions
    (athlete_id,planned_session_id,revision,title,exercises,change_reason,source,overview)
  SELECT r.athlete_id,r.planned_session_id,r.revision+1,r.title,r.exercises,
    'Add synthetic overview metadata for interface review.','synthetic',
    jsonb_build_object(
      'rationale', CASE p.kind
        WHEN 'strength' THEN 'Practice controlled strength work with a manageable effort target and room to adjust.'
        WHEN 'run' THEN 'Use repeatable work and recovery periods to practice consistent effort.'
        WHEN 'bike' THEN 'Practice repeatable output with easy recovery between efforts.'
        ELSE 'Practice smooth, controlled rowing with distinct work and recovery segments.' END,
      'expectedDurationMinutes',jsonb_build_object('min',CASE WHEN p.kind='strength' THEN 25 ELSE 15 END,
        'max',CASE WHEN p.kind='strength' THEN 35 ELSE 20 END),
      'rpe',jsonb_build_object('min',6,'max',7))
  FROM (
    SELECT DISTINCT ON (athlete_id,planned_session_id) *
    FROM stunna.prescription_revisions
    ORDER BY athlete_id,planned_session_id,revision DESC
  ) r JOIN stunna.planned_sessions p ON p.athlete_id=r.athlete_id AND p.id=r.planned_session_id
  WHERE r.source='synthetic' AND r.overview IS NULL;
END $$;
