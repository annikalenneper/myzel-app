-- Nachtrag zu 20261021000001_grants (Review 21.10.2026): EXECUTE für PUBLIC ist ein globales Standardrecht und lässt
-- sich nicht „in schema public“ entziehen. Ohne diese Zeile wären Funktionen späterer Phasen ohne Login per RPC
-- aufrufbar.
alter default privileges revoke execute on functions from public;
