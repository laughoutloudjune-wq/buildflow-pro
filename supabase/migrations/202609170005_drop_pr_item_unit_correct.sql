-- Removes pr_item_unit_correct, added earlier the same day in
-- 202609170002_pr_item_unit_correct.sql. It let a PM hand-correct the unit on
-- an already-approved request line, as a way to rescue requests like PR-0023
-- whose lines had inherited the material's purchasing unit rather than the
-- one the foreman meant.
--
-- 202609170003 made it unnecessary: purchasing answers the request line on
-- the order itself, so a request no longer has to have its unit corrected
-- before it can be closed out. With the UI for it removed, this was an
-- unreachable SECURITY DEFINER function that any signed-in user could still
-- call - dead API surface, so it goes.
--
-- Nothing is lost by dropping it: it only ever wrote purchase_request_items
-- .unit, which pr_create/pr_update still set from the request form.

drop function if exists public.pr_item_unit_correct(uuid, text);
