-- Atomic read-back catalog, deliberately excluding descriptions, references,
-- filenames, raw cells, bank identifiers, storage paths and encryption material.
create function public.read_refund_split_catalog(p_refund uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();cash bigint;transactions jsonb;n integer;
begin
 if owner_id is null or p_refund is null then raise exception 'Sign in and choose owned refund cash.';end if;
 select signed_amount_pence into cash from public.bank_transactions where id=p_refund and user_id=owner_id;
 if not found then raise exception 'Owned refund source unavailable.';end if;
 select count(*)::integer into n from (select 1 from public.bank_transactions t where t.user_id=owner_id and (t.id=p_refund or(t.signed_amount_pence>0)<>(cash>0)) limit 10001) bounded;
 if n>10000 then raise exception 'Refund source catalog exceeds the complete review limit.';end if;
 with bounded as (
  select t.* from public.bank_transactions t where t.user_id=owner_id and (t.id=p_refund or (t.signed_amount_pence>0)<>(cash>0)) order by t.id limit 10001
 ),choices as (
  select jsonb_build_object('id',t.id,'user_id',owner_id,'account_id',t.account_id,'import_id',t.import_id,'source_row_id',t.source_row_id,
   'recognized_record_id',t.recognized_record_id,'record_transaction_id',f.bank_transaction_id,'project_id',f.project_id,
   'category_label',(select k.name from public.record_categories k where k.id=f.category_id and k.record_type=f.record_type and(k.user_id=owner_id or(k.user_id is null and k.is_default))),
   'project_label',(select p.name from public.projects p where p.id=f.project_id and p.user_id=owner_id),
   'category_valid',exists(select 1 from public.record_categories k where k.id=f.category_id and k.record_type=f.record_type and(k.user_id=owner_id or(k.user_id is null and k.is_default))),
   'record_provenance_valid',(not exists(select 1 from public.financial_records x where x.user_id=owner_id and x.bank_transaction_id=t.id and x.status='approved' and x.id is distinct from t.recognized_record_id)) and case when t.recognized_record_id is null then true else coalesce(f.bank_transaction_id=t.id and f.import_id=t.import_id and f.record_date=t.transaction_date and (f.status<>'approved' or (f.category_id=t.category_id and f.record_type=(case when t.signed_amount_pence>0 then 'income' else 'expense' end)
     and f.amount*100=round(abs(t.signed_amount_pence)::numeric*t.business_use_bps/10000) and t.classification in('Business','Mixed')
     and ((t.classification='Business' and t.business_use_bps=10000) or(t.classification='Mixed' and t.signed_amount_pence<0 and t.business_use_bps between 1 and 9999))
     and exists(select 1 from public.record_categories k where k.id=f.category_id and k.record_type=f.record_type and(k.user_id=owner_id or(k.user_id is null and k.is_default))))) and f.refund_link_id is null and f.effect_sign=1
    and (f.project_id is null or exists(select 1 from public.projects p where p.id=f.project_id and p.user_id=owner_id)),false) end,
   'transaction_date',t.transaction_date,'signed_amount_pence',t.signed_amount_pence,'currency',t.currency,
   'description','','account_label','Owned account','account_mask','','account_type',c.account_type,
   'classification',t.classification,'decision_version',t.decision_version,'dedupe_status',t.dedupe_status,
   'active_transfer_id',t.active_transfer_id,'active_refund_id',t.active_refund_id,'has_refunds',c.has_refunds,'import_status',c.import_status,
   'record_status',c.record_status,'recognized_pence',c.recognized_pence,'invoice_allocated_pence',c.invoice_allocated_pence,
   'business_use_bps',t.business_use_bps,'record_type',c.record_type,'effect_sign',c.effect_sign,'category_id',c.category_id,
   'refunded_pence',c.refunded_pence,'reduced_pence',c.reduced_pence,'refund_count',c.refund_count,'refund_stamp',c.refund_stamp) value
  from bounded t join public.refund_transaction_choices c on c.id=t.id and c.user_id=owner_id
  left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=owner_id
 ) select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into transactions from choices;
 if jsonb_array_length(transactions)>10000 then raise exception 'Refund source catalog exceeds the complete review limit.';end if;
 if not exists(select 1 from jsonb_array_elements(transactions) v where v->>'id'=p_refund::text) then raise exception 'Complete owned refund source unavailable.';end if;
 return jsonb_build_object('owner_id',owner_id,'stamp',public.reconciliation_export_stamp(),'transactions',transactions);
end;$$;
revoke all on function public.read_refund_split_catalog(uuid) from public,anon,service_role;
grant execute on function public.read_refund_split_catalog(uuid) to authenticated;
