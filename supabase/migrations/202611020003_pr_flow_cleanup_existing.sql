-- OPTIONAL one-off clean-up, run AFTER 202611020002 and only with June's OK.
-- Re-checks the request lines whose stored state disagrees with what the
-- orders say (live on 2026-11-02: 50 lines; 49 are "ordered" in the rules but
-- stored "arrived"), then lets each request's status follow. Expected result:
-- requests 9, 22, 56 and 58 (every order received, still "รอของ") become
-- received. Nobody is notified (app.skip_pr_notify). Nothing is removed.
-- Request 18's one line stays 'arrived' -> recomputes to 'closed' but the
-- request keeps 'received' because the status rule never moves an all-closed
-- request backwards.
select set_config('app.skip_pr_notify', '1', false);

select public._pri_resync_material(id)
from public.purchase_request_items
where line_status is distinct from public._pri_line_state(id);
