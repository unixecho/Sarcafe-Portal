-- Employee number + six-digit code sign-in stopped working after
-- 20261009120000 added pos_verify_pin(text, text) next to the original
-- pos_verify_pin(integer, text). Both take the same named arguments, so the
-- Supabase REST layer cannot choose between them for a JSON call ("Could not
-- choose the best candidate function", PGRST203) and every login answered
-- with a server error. The text overload is canonical (it preserves leading
-- zeroes), so the integer one goes. Service-only, as before.
drop function if exists public.pos_verify_pin(integer, text);
