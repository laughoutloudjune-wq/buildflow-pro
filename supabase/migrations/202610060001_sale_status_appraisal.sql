-- New sale status "ประเมิน" (appraisal): the bank's property valuation step,
-- between loan approved (60) and awaiting inspection (70). Idempotent.
insert into public.sale_statuses (code, label, color, stage, sort_order)
values ('appraisal', 'ประเมิน', 'cyan', 'closing', 65)
on conflict (code) do nothing;
