-- Review Phase 3 (22.10.2026): Das Ergebnis eines Plenums entsteht aus der Historie („im Plenum vom …“). Damit es
-- auch bei vielen Einträgen schnell bleibt: Index auf das Plenum der Zeile und auf die zurückgenommenen Einträge.
create index history_plenum on public.history ((changes -> 'plenum_id' ->> 'new')) where changes ? 'plenum_line';
create index history_undone on public.history using gin ((changes -> 'history_ids' -> 'old')) where action = 'undo';
