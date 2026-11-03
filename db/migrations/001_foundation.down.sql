-- Destructive: back up/export first. Normally roll back application code only.
DROP TABLE stunna.write_requests;
DROP TABLE stunna.audit_events;
DROP TABLE stunna.body_measurements;
DROP TABLE stunna.actual_sessions;
DROP TABLE stunna.planned_sessions;
DROP TABLE stunna.training_blocks;
DROP TABLE stunna.athletes;
DROP SCHEMA stunna;
