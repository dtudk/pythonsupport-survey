-- Rights in pis_survey, applied by setup.sh and `manage.sh update` after migrations; safe to rerun.
-- The reset revokes everything first, so deleting a GRANT removes that right. A new schema
-- needs a line in the reset too. The psql variables come from deploy/settings.env:
-- psql -v analyst=pis_analyst -v viewer=pis_viewer ...

SET client_min_messages = warning;

SELECT format('CREATE ROLE %I NOLOGIN', r) FROM unnest(ARRAY[:'analyst', :'viewer']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

-- pis_analyst owns them, so every analyst can change them. Django stays in public, and pis has
-- no rights here: backups and restores run as postgres.
CREATE SCHEMA IF NOT EXISTS processed_data;  -- results of the processing notebooks
CREATE SCHEMA IF NOT EXISTS static_data;     -- data from outside Django, e.g. the old survey
CREATE SCHEMA IF NOT EXISTS published_data;  -- what viewers may see
ALTER SCHEMA processed_data OWNER TO :"analyst";
ALTER SCHEMA static_data    OWNER TO :"analyst";
ALTER SCHEMA published_data OWNER TO :"analyst";

-- When each static_data table was last fetched (pis_lib.fetched). Here, so the dashboard can always read it.
CREATE TABLE IF NOT EXISTS static_data.fetched (table_name text PRIMARY KEY, fetched_at timestamptz NOT NULL);

-- Reset. pis_analyst keeps its rights where it is the owner: those can't be revoked.
REVOKE ALL ON SCHEMA public FROM :"analyst", :"viewer";
REVOKE ALL ON SCHEMA processed_data, static_data, published_data FROM :"viewer";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"analyst", :"viewer";
REVOKE ALL ON ALL TABLES IN SCHEMA processed_data, static_data, published_data FROM :"viewer";
ALTER DEFAULT PRIVILEGES FOR ROLE :"analyst" IN SCHEMA published_data REVOKE ALL ON TABLES FROM :"viewer";

-- pis_analyst: also tables someone else created in its schemas.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA processed_data, static_data, published_data TO :"analyst";

-- Read only Django's survey_* tables, not users, sessions or the live link tokens.
GRANT USAGE ON SCHEMA public TO :"analyst";
SELECT format('GRANT SELECT ON public.%I TO %I', tablename, :'analyst') FROM pg_tables
 WHERE schemaname = 'public' AND tablename LIKE 'survey\_%' AND tablename <> 'survey_surveylink'
\gexec

-- pis_viewer: read published_data, including tables created there later.
GRANT USAGE ON SCHEMA published_data TO :"viewer";
GRANT SELECT ON ALL TABLES IN SCHEMA published_data TO :"viewer";
ALTER DEFAULT PRIVILEGES FOR ROLE :"analyst" IN SCHEMA published_data GRANT SELECT ON TABLES TO :"viewer";
