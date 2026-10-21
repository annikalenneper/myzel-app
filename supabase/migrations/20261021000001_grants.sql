-- Rechte enger als die Supabase-Standardrechte (Review 21.10.2026): Supabase gibt anon und authenticated über
-- Default Privileges ALL auf neue Tabellen und Sequenzen und EXECUTE auf Funktionen. RLS schützt Lesen und
-- Schreiben, nicht aber TRUNCATE, TRIGGER, REFERENCES, Sequenzen und Funktionsaufrufe per RPC.
-- Danach gilt: anon darf nichts, authenticated nur lesen (weiter durch RLS auf aktive Mitglieder begrenzt).
-- Die Server-Funktionen verbinden sich als postgres und sind davon nicht betroffen.
-- Neue Tabellen späterer Phasen bekommen ihr „grant select … to authenticated“ in ihrer eigenen Migration.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

grant select on
  public.members, public.topics, public.events, public.tasks, public.task_assignees, public.task_followers,
  public.task_blockers, public.comments, public.plenum_marks, public.history
to authenticated;
-- die Lese-Policies rufen sie auf
grant execute on function public.is_active_member() to authenticated;
