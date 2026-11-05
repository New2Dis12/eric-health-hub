-- Optional authored summary, versioned with the complete prescription snapshot.
-- Older snapshots remain valid and have no overview metadata.
ALTER TABLE stunna.prescription_revisions
  ADD COLUMN overview jsonb CHECK (
    overview IS NULL OR (jsonb_typeof(overview)='object' AND octet_length(overview::text) <= 2000)
  );
