-- Adding uniqueness fails atomically if a pair exists. Never delete or relink evidence.
ALTER TABLE stunna.source_links ADD CONSTRAINT source_links_athlete_id_session_id_provider_key
  UNIQUE (athlete_id, session_id, provider);
DROP INDEX stunna.source_links_session_lookup;
DROP INDEX stunna.source_links_other_provider_once;
