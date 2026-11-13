-- SOURCE ONLY: hosted application requires separate owner authorization.
-- Identity is immutable. Refresh appends a revision; replacement/relink is rejected.
CREATE TABLE stunna.source_links (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL,
  session_id uuid NOT NULL,
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 100),
  UNIQUE (athlete_id,id),
  UNIQUE (athlete_id,provider,source_id),
  UNIQUE (athlete_id,session_id,provider),
  FOREIGN KEY (athlete_id,session_id) REFERENCES stunna.actual_sessions(athlete_id,id)
);
CREATE TABLE stunna.source_evidence_revisions (
  id uuid PRIMARY KEY,
  athlete_id uuid NOT NULL,
  link_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=196608),
  actor_sub text NOT NULL CHECK (actor_sub=current_setting('stunna.subject',true)),
  source text NOT NULL CHECK (source IN ('browser','api')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id,link_id,revision),
  FOREIGN KEY (athlete_id,link_id) REFERENCES stunna.source_links(athlete_id,id)
);
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['source_links','source_evidence_revisions'] LOOP
    EXECUTE format('ALTER TABLE stunna.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE stunna.%I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY athlete_ownership ON stunna.%I USING (athlete_id IN (SELECT id FROM stunna.athletes)) WITH CHECK (athlete_id IN (SELECT id FROM stunna.athletes))',tab);
    EXECUTE format('REVOKE ALL ON stunna.%I FROM PUBLIC',tab);
  END LOOP;
END $$;
CREATE FUNCTION stunna.check_source_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link stunna.source_links; saved_status text;
BEGIN
  SELECT * INTO link FROM stunna.source_links WHERE athlete_id=NEW.athlete_id AND id=NEW.link_id;
  SELECT status INTO saved_status FROM stunna.actual_sessions WHERE athlete_id=NEW.athlete_id AND id=link.session_id;
  IF saved_status IS DISTINCT FROM 'completed' OR
    NEW.evidence->>'provider' IS DISTINCT FROM link.provider OR
    NEW.evidence->>'sourceId' IS DISTINCT FROM link.source_id OR
    NEW.evidence->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Invalid completed session evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_evidence_identity BEFORE INSERT ON stunna.source_evidence_revisions
  FOR EACH ROW EXECUTE FUNCTION stunna.check_source_evidence();
