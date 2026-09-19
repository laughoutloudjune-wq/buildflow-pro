-- notifications.type is CHECK-constrained to a fixed list (caught by testing
-- sales_work_request_create against a rolled-back transaction - the insert
-- 23514'd before this migration existed). Widens it for the two new types
-- Phase 6 writes: work_request_new (to admin/pm/foreman on file) and
-- work_request_done (to the requester when construction marks it done).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_request', 'billing_approved', 'billing_rejected',
    'pr_pending_review', 'pr_approved', 'pr_rejected',
    'work_request_new', 'work_request_done'
  ]));
