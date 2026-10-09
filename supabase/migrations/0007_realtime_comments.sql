-- 0007: Supabase Realtime (Postgres Changes) for the ticket conversation.
--
-- Additive only. Adds ONE table, ticket_comments, to the supabase_realtime
-- publication so an open ticket page receives new messages without polling.
-- No policy, grant, function or column changes.
--
-- Why this is safe for tenant isolation and internal-note privacy:
-- * Supabase Realtime authorizes every Postgres Changes event per subscriber
--   by evaluating the table's RLS SELECT policy with that subscriber's own JWT
--   (role "authenticated" + request.jwt.claims), the same way PostgREST does.
--   ticket_comments_select (0002_rls.sql) therefore decides who receives a
--   row: clients never receive INTERNAL rows or rows on other organizations'
--   tickets; team members only rows on tickets assigned to them.
-- * Unauthenticated (anon key only) subscribers receive nothing: the policy
--   requires a staff or client role claim.
-- * Soft deletes (deleted_at set) produce UPDATE rows that the policy hides,
--   so they are not streamed either. Hard deletes do not happen in app code
--   (CLAUDE.md rule 9); DELETE events would carry only the primary key.
-- * The frontend subscribes to INSERT on one ticket_id and treats the event
--   as a signal; the message itself is still read through the API + RLS.
--
-- Verified empirically on DEV (client/admin/anon subscribers, internal note,
-- cross-tenant ticket) before use; see docs/CHAT.md "Realtime".
--
-- Rollback: alter publication supabase_realtime drop table public.ticket_comments;
-- (the app falls back to its polling interval automatically).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_comments'
  ) then
    alter publication supabase_realtime add table public.ticket_comments;
  end if;
end
$$;
