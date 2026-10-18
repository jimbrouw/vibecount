-- Read-only preparation for shared-cash refunds. Does not enable split approval or mutate effects.
create function public.read_refund_reversal_graph(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();nodes uuid[];result jsonb;
begin
 if owner_id is null or p_id is null or p_kind is null or p_kind not in ('original','refund','import') then raise exception 'Sign in and choose an owned refund source.';end if;
 if p_kind='import' then
  if not exists(select 1 from public.record_imports where id=p_id and user_id=owner_id) then raise exception 'Owned refund source unavailable.';end if;
 elsif not exists(select 1 from public.bank_transactions where id=p_id and user_id=owner_id) then raise exception 'Owned refund source unavailable.';
 end if;
 with recursive edges as (
  select l.original_transaction_id,l.refund_transaction_id from public.refund_links l where l.user_id=owner_id
  and not exists(select 1 from public.refund_reversals r where r.user_id=owner_id and r.refund_id=l.id)
 ),component(id) as (
  select t.id from public.bank_transactions t where t.user_id=owner_id and (case when p_kind='import' then t.import_id=p_id else t.id=p_id end)
  union
  select case when e.original_transaction_id=c.id then e.refund_transaction_id else e.original_transaction_id end
  from component c join edges e on c.id in(e.original_transaction_id,e.refund_transaction_id)
 )
 select coalesce(array_agg(id),'{}'::uuid[]) into nodes from (select id from component limit 20001) bounded;
 if cardinality(nodes)>20000 then raise exception 'Refund component exceeds the review limit; no partial graph is returned.';end if;
 with active as (
  select l.* from public.refund_links l where l.user_id=owner_id
  and not exists(select 1 from public.refund_reversals r where r.user_id=owner_id and r.refund_id=l.id)
 ),selected as (
  select l.* from active l where l.original_transaction_id=any(nodes) or l.refund_transaction_id=any(nodes)
 ),assignments as (
  select a.id,a.user_id,a.refund_id,a.amount_pence from public.active_invoice_refund_assignments a join selected l on l.id=a.refund_id and l.user_id=a.user_id where a.user_id=owner_id
 ),transactions as (
  select t.id,t.user_id,t.import_id,t.source_row_id,t.decision_version,t.signed_amount_pence,t.currency,
   (select count(*)::integer from active l where l.original_transaction_id=t.id) original_link_count,
   (select count(*)::integer from active l where l.refund_transaction_id=t.id) refund_link_count
  from public.bank_transactions t where t.user_id=owner_id and t.id=any(nodes)
 ),links as (
  select l.id,l.user_id,l.original_transaction_id,l.refund_transaction_id,l.amount_pence,l.recognized_pence,l.record_type,l.business_use_bps,l.category_id,
   case when l.recognized_pence=0 then null else f.id end record_id,
   (select count(*)::integer from assignments a where a.refund_id=l.id) assignment_count
  from selected l left join public.financial_records f on f.refund_link_id=l.id and f.user_id=l.user_id and f.bank_transaction_id=l.refund_transaction_id
   and f.status='approved' and f.effect_sign=-1 and f.record_type=l.record_type and f.category_id=l.category_id and f.amount*100=l.recognized_pence
 ),imports as (
  select i.id,i.user_id,(select count(*)::integer from public.bank_transactions t where t.user_id=owner_id and t.import_id=i.id) transaction_count
  from public.record_imports i where i.user_id=owner_id and (i.id in(select t.import_id from transactions t) or (p_kind='import' and i.id=p_id))
 )
 select jsonb_build_object('owner_id',owner_id,'stamp',public.reconciliation_export_stamp(),
 'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from transactions t),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from links l),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from assignments a),'[]'::jsonb),
 'imports',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from imports i),'[]'::jsonb)) into result;
 if jsonb_array_length(result->'links')>20000 or jsonb_array_length(result->'assignments')>20000 then raise exception 'Refund graph exceeds the review limit; no partial graph is returned.';end if;
 return result;
end;$$;
revoke all on function public.read_refund_reversal_graph(text,uuid) from public,anon,service_role;
grant execute on function public.read_refund_reversal_graph(text,uuid) to authenticated;
