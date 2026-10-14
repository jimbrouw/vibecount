-- Trigger remains callable by PostgreSQL; it does not need public RPC access.
revoke execute on function public.log_financial_record_change() from public, anon, authenticated;
