-- Clickfield AI Ticketing System — seed data
-- Safe to run multiple times (idempotent via ON CONFLICT).
-- NOTE: this seeds reference data only (org, categories, SLA policies).
-- Auth users are NOT created here — they must be created via Supabase Auth
-- (see backend/app/core/privileged.py::provision_user) so that auth.users and
-- public.users stay in sync and app_metadata (role/organization_id) is set
-- correctly. See backend/tests/conftest.py for how tests provision fixture
-- users.

-- Internal Clickfield AI organization (decision #3)
insert into organizations (id, name, slug, is_internal, status)
values ('00000000-0000-0000-0000-000000000001', 'Clickfield AI', 'clickfield-ai', true, 'ACTIVE')
on conflict (slug) do nothing;

-- Categories (spec §7)
insert into categories (name, description) values
  ('Bug', 'Something is not working as expected'),
  ('Technical Issue', 'General technical problem'),
  ('Website', 'Issue related to a website'),
  ('Mobile App', 'Issue related to a mobile application'),
  ('Backend/API', 'Issue related to backend services or APIs'),
  ('Database', 'Issue related to data or database behavior'),
  ('Hosting/Deployment', 'Issue related to hosting or deployments'),
  ('Security', 'Security concern or incident'),
  ('Account/Access', 'Login, access, or permissions issue'),
  ('Change Request', 'Requested change to existing functionality'),
  ('Feature Request', 'Request for new functionality'),
  ('Maintenance', 'Routine maintenance request'),
  ('Other', 'Anything not covered above')
on conflict (name) do nothing;

-- SLA policies (spec §25 defaults, configurable later via admin settings)
insert into sla_policies (priority, response_minutes, resolution_minutes) values
  ('CRITICAL', 30, 120),
  ('HIGH', 120, 480),
  ('MEDIUM', 240, 1440),
  ('LOW', 480, 4320)
on conflict (priority) do update
  set response_minutes = excluded.response_minutes,
      resolution_minutes = excluded.resolution_minutes;
