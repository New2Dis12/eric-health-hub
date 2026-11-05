-- Run as migration owner after provisioning a distinct LOGIN role named
-- stunna_runtime with NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT.
-- Set its password securely in the provider console, never in this file.
-- Do not grant runtime membership in the migration/owner role.
REVOKE ALL ON SCHEMA stunna FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA stunna FROM PUBLIC;
GRANT USAGE ON SCHEMA stunna TO stunna_runtime;
GRANT SELECT, INSERT ON stunna.athletes, stunna.training_blocks, stunna.planned_sessions,
  stunna.actual_sessions, stunna.body_measurements, stunna.audit_events, stunna.write_requests TO stunna_runtime;
-- SELECT FOR UPDATE requires UPDATE permission on at least one column.
GRANT UPDATE(id) ON stunna.athletes TO stunna_runtime;
GRANT UPDATE(started_at,completed_at,status,notes,rpe,revision,updated_at,source)
  ON stunna.actual_sessions TO stunna_runtime;
-- No DELETE, DDL, or UPDATE of audit/measurement/idempotency/plan records.
-- Conditional so the same grants script works for Sprint 1 rollback/recovery.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prescription_revisions','training_preferences','exercise_benchmarks','block_context_revisions'] LOOP
    IF to_regclass(format('stunna.%I', tab)) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON stunna.%I FROM stunna_runtime', tab);
      EXECUTE format('GRANT SELECT ON stunna.%I TO stunna_runtime', tab);
    END IF;
  END LOOP;
END $$;
