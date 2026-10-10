-- Drop the removed transfer-request (TR) and commission features.
-- The live tables held 0 rows when this was written (checked 2026-10-10).
-- IRREVERSIBLE. Apply only after the build without TR code is deployed.

-- Old TR notifications and the column that points at transfer_requests.
delete from public.notifications where type in ('tr_submitted','tr_approved','tr_rejected');
alter table public.notifications drop column if exists transfer_request_id;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_request', 'billing_approved', 'billing_rejected',
    'pr_pending_review', 'pr_approved', 'pr_rejected', 'pr_ordered', 'pr_received',
    'work_request_new', 'work_request_done',
    'work_request_pending', 'work_request_approved', 'work_request_rejected'
  ]));

drop function if exists public.transfer_request_create(jsonb);
drop function if exists public.transfer_request_update(uuid, jsonb);
drop function if exists public.transfer_request_set_status(uuid, jsonb);
drop function if exists public._transfer_request_snapshot(uuid);
drop table if exists public.transfer_request_number_counters;
drop table if exists public.transfer_requests;

drop function if exists public.commission_setting_set(jsonb);
drop function if exists public.commission_setting_clear(jsonb);
drop function if exists public._commission_for_plot(uuid);
drop table if exists public.commission_settings;
