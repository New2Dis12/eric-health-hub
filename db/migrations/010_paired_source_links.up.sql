-- Preserve external activity uniqueness and legacy cardinality for other providers.
CREATE UNIQUE INDEX source_links_other_provider_once
  ON stunna.source_links (athlete_id, session_id, provider) WHERE provider <> 'garmin';
CREATE INDEX source_links_session_lookup ON stunna.source_links (athlete_id, session_id);
ALTER TABLE stunna.source_links DROP CONSTRAINT source_links_athlete_id_session_id_provider_key;
