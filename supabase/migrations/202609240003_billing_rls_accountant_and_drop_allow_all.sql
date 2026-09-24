-- Handover plan Phase 6.2 (H-10): billings/billing_jobs/billing_adjustments
-- still carried an "Allow all" policy (roles={public}, qual=true) alongside
-- the narrower `_select` policies added earlier - since RLS policies are
-- OR'd together, "Allow all" made the narrower ones moot, so ANY
-- authenticated user (including sales) could read every bill's amounts and
-- write to these tables directly regardless of the narrower policy's
-- intent. Dropping it now makes the narrower `_select` policies the only
-- ones in effect.
--
-- The `_select` policies are extended to include 'accountant' in the
-- read-all set (previously only pm/admin) - the accountant's whole job is
-- contractor payments (contractor-cycle report, mark paid out), which needs
-- every bill, not just ones they personally created/submitted.
--
-- No insert/update/delete policy is added for `authenticated` on purpose:
-- every real write already goes through billing_approve/billing_reject/
-- billing_mark_paid_out/etc. (SECURITY DEFINER, owned by postgres, bypasses
-- RLS) - see AUDIT_REPORT.md H-10 "done when" criterion. With "Allow all"
-- gone and no write policy, a direct insert/update/delete from any
-- authenticated role is now refused.
--
-- Rollback: recreate "Allow all" on each table as
--   create policy "Allow all" on public.<table> for all to public using (true);
-- and revert the three _select policies to their pm/admin-only form.

alter policy billings_select on public.billings
  using (
    (created_by = auth.uid()) or (submitted_by = auth.uid()) or
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any(array['pm','admin','accountant']))
  );

alter policy billing_jobs_select on public.billing_jobs
  using (
    exists (select 1 from billings b where b.id = billing_jobs.billing_id and (
      b.created_by = auth.uid() or b.submitted_by = auth.uid() or
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['pm','admin','accountant']))
    ))
  );

alter policy billing_adjustments_select on public.billing_adjustments
  using (
    exists (select 1 from billings b where b.id = billing_adjustments.billing_id and (
      b.created_by = auth.uid() or b.submitted_by = auth.uid() or
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['pm','admin','accountant']))
    ))
  );

drop policy "Allow all" on public.billings;
drop policy "Allow all" on public.billing_jobs;
drop policy "Allow all" on public.billing_adjustments;
