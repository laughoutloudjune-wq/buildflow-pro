-- Actual withheld retention/WHT amounts, as confirmed by the accountant at
-- payout time. These override the %-based formula (total_work_amount *
-- retention_percent, gross * wht_percent) when present.
--
-- Needed because the percent formula can't express every real-world case:
-- e.g. a DC/extra-work bill has total_work_amount = 0, so retention% always
-- computes to ฿0 no matter what — but the bill may have actually been paid
-- with a real retention withholding anyway. Null means "use the formula";
-- a value means "this exact amount was withheld."

alter table public.billings add column if not exists retention_amount numeric;
alter table public.billings add column if not exists wht_amount numeric;
