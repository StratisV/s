-- home.os realtime: clients subscribe to changes in their household and reload.
--
-- The tables join the supabase_realtime publication only when it exists, so this file also
-- runs on plain Postgres (the database tests). Realtime still applies RLS, so members only
-- receive their own household's rows.

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['households', 'members', 'areas', 'items', 'completions']
  loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- DELETE events only carry the primary key unless the whole old row is logged. Logging it
-- lets realtime filter deletes by household_id.
alter table public.members replica identity full;
alter table public.areas replica identity full;
alter table public.items replica identity full;
alter table public.completions replica identity full;
