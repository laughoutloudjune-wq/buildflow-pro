-- Same issue as get_plot_jobs_public earlier: Supabase grants EXECUTE on new
-- functions to anon directly, which "revoke all ... from public" doesn't
-- touch. plot_create() already refuses internally for a non-authenticated
-- caller (role check reads '' when there's no auth.uid()), but per L-02's
-- own point about payment_voucher_create/void, the grant itself should be
-- revoked too rather than relying only on the internal check.
revoke execute on function public.plot_create(jsonb) from anon;
