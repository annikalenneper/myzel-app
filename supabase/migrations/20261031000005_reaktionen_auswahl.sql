-- Nutzerin, 27.10.2026: Totenkopf und Kleeblatt entfallen aus der Auswahl der Reaktionen.

delete from public.comment_reactions where reaction in ('totenkopf', 'kleeblatt');
alter table public.comment_reactions drop constraint comment_reactions_reaction_check;
alter table public.comment_reactions add constraint comment_reactions_reaction_check
  check (reaction in ('herz', 'daumen_hoch', 'daumen_runter', 'frage', 'lachen'));
