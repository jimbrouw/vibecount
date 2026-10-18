-- Complete, explicitly reviewed refund reversal. Does not enable split approval.
create function public.reverse_refund_closure(p_kind text,p_id uuid,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();payload text;prior public.refund_requests;graph jsonb;nodes uuid[];edges uuid[];refunds uuid[];originals uuid[];
 income bigint;expense bigint;cash bigint;tx public.bank_transactions;result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review refund reversals.';end if;
 if p_kind is null or p_kind not in ('original','refund','import') or p_id is null or p_request is null
  or p_stamp is null or p_stamp !~ '^[a-f0-9]{32}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
  raise exception 'Review the complete refund reversal, reason and request.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_object('action','reverse_refund_closure/1','kind',p_kind,'id',p_id,'stamp',p_stamp,'reason',btrim(p_reason))::text);
 select * into prior from public.refund_requests where user_id=owner_id and request_id=p_request;
 if found then
  if prior.payload_hash<>payload then raise exception 'Refund reversal request changed.';end if;
  return prior.result;
 end if;
 graph:=public.read_refund_reversal_graph(p_kind,p_id);
 if graph->>'stamp' is distinct from p_stamp then raise exception 'Refund reversal context changed. Review again.';end if;
 select coalesce(array_agg((v->>'id')::uuid),'{}'::uuid[]) into nodes from jsonb_array_elements(graph->'transactions') v;
 perform 1 from public.bank_transactions where user_id=owner_id and id=any(nodes) order by id for update;
 -- Source ingestion may have started outside the reconciliation advisory lock.
 graph:=public.read_refund_reversal_graph(p_kind,p_id);
 if graph->>'stamp' is distinct from p_stamp then raise exception 'Refund reversal context changed. Review again.';end if;
 if exists(select 1 from jsonb_array_elements(graph->'transactions') t where (p_kind='original' and (t->>'id')::uuid=p_id and (t->>'refund_link_count')::integer>0)
  or (p_kind='refund' and (t->>'id')::uuid=p_id and (t->>'original_link_count')::integer>0)) then raise exception 'Choose the correct original or refund source.';end if;
 select array_agg((v->>'id')::uuid order by v->>'id'),array_agg(distinct (v->>'refund_transaction_id')::uuid order by (v->>'refund_transaction_id')::uuid),array_agg(distinct (v->>'original_transaction_id')::uuid order by (v->>'original_transaction_id')::uuid),
  coalesce(sum((v->>'recognized_pence')::bigint) filter(where v->>'record_type'='income'),0),
  coalesce(sum((v->>'recognized_pence')::bigint) filter(where v->>'record_type'='expense'),0)
 into edges,refunds,originals,income,expense from jsonb_array_elements(graph->'links') v;
 if coalesce(cardinality(edges),0)=0 then raise exception 'No active refund relationships remain.';end if;
 if jsonb_array_length(graph->'assignments')>0 then raise exception 'Reverse every linked invoice refund assignment before this refund closure.';end if;
 -- Fail closed on incomplete cash, source roles, accounting or effect provenance.
 if exists(select 1 from jsonb_array_elements(graph->'links') l
  where ((l->>'recognized_pence')::bigint>0 and l->>'record_id' is null)
   or (l->>'recognized_pence')::bigint>(l->>'amount_pence')::bigint) then raise exception 'Complete approved refund effects unavailable.';end if;
 if exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=any(refunds||originals)
  and (t.currency<>'GBP' or t.active_transfer_id is not null or t.dedupe_status<>'clear'
   or not exists(select 1 from public.record_imports i where i.id=t.import_id and i.user_id=owner_id and i.status<>'discarded')
   or (t.id=any(refunds) and t.id=any(originals)))) then raise exception 'Resolve refund source currency, roles, duplicates or import state.';end if;
 if exists(select 1 from public.active_refunds l join public.bank_transactions o on o.id=l.original_transaction_id and o.user_id=l.user_id
  join public.bank_transactions r on r.id=l.refund_transaction_id and r.user_id=l.user_id
  where l.user_id=owner_id and l.id=any(edges) and ((o.signed_amount_pence>0)=(r.signed_amount_pence>0)
   or l.record_type<>(case when o.signed_amount_pence>0 then 'income' else 'expense' end)
   or (l.record_type='income' and l.business_use_bps<>10000))) then raise exception 'Refund accounting endpoints are inconsistent.';end if;
 if exists(select 1 from public.active_refunds l join public.bank_transactions t on t.id=l.refund_transaction_id and t.user_id=l.user_id
  where l.user_id=owner_id and t.id=any(refunds) group by t.id,t.signed_amount_pence
  having sum(l.amount_pence)<>abs(t.signed_amount_pence) or bool_or(not(l.id=any(edges)))) then raise exception 'Refund cash must be completely allocated in the reversal.';end if;
 if exists(select 1 from public.active_refunds l join public.bank_transactions t on t.id=l.original_transaction_id and t.user_id=l.user_id
  where l.user_id=owner_id and t.id=any(originals) group by t.id,t.signed_amount_pence
  having sum(l.amount_pence)>abs(t.signed_amount_pence) or count(distinct (l.record_type,l.category_id,l.business_use_bps))<>1
   or sum(l.recognized_pence)<>round(sum(l.amount_pence)::numeric*min(l.business_use_bps)/10000)
   or bool_or(not(l.id=any(edges)))) then raise exception 'Complete cumulative refund history unavailable.';end if;
 if exists(select 1 from public.active_invoice_allocations a where a.user_id=owner_id and a.transaction_id=any(refunds)) then raise exception 'Refund cash cannot also support receipt allocations.';end if;
 if exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=any(refunds) and t.recognized_record_id is not null
  and not exists(select 1 from public.financial_records f where f.id=t.recognized_record_id and f.user_id=owner_id and f.bank_transaction_id=t.id)) then raise exception 'Refund source posting provenance is inconsistent.';end if;
 if exists(select 1 from public.financial_records f where f.user_id=owner_id and f.bank_transaction_id=any(refunds) and f.status='approved'
  and not exists(select 1 from public.refund_links l where l.user_id=owner_id and l.id=any(edges) and l.id=f.refund_link_id
   and l.refund_transaction_id=f.bank_transaction_id and l.recognized_pence>0 and f.amount*100=l.recognized_pence
   and f.effect_sign=-1 and f.record_type=l.record_type and f.category_id=l.category_id)) then raise exception 'Refund source has an unreviewed extra accounting effect.';end if;
 select coalesce(sum(abs(signed_amount_pence)),0) into cash from public.bank_transactions where user_id=owner_id and id=any(refunds);
 perform 1 from public.financial_records where user_id=owner_id and refund_link_id=any(edges) order by id for update;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Refund reversal context changed. Review again.';end if;
 insert into public.refund_reversals(user_id,refund_id,author,rationale,request_id)
 select owner_id,id,owner_id,btrim(p_reason),p_request from public.refund_links where user_id=owner_id and id=any(edges) order by id;
 -- Exclude all child effects, including siblings not held by the old scalar pointer.
 update public.financial_records set status='excluded',approved_at=null where user_id=owner_id and effect_sign=-1 and refund_link_id=any(edges);
 for tx in select * from public.bank_transactions where user_id=owner_id and id=any(refunds) order by id loop
  -- One explicit Unknown decision per observation. Do not invoke a scalar-pointer
  -- classifier that could mutate another child or an unrelated legacy record.
  insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
   values(owner_id,tx.id,tx.import_id,tx.decision_version+1,'Unknown',0,null,btrim(p_reason),0,owner_id);
  update public.bank_transactions set classification='Unknown',business_use_bps=0,category_id=null,decision_version=tx.decision_version+1,
   active_refund_id=null,recognized_record_id=null,updated_at=now() where id=tx.id and user_id=owner_id;
 end loop;
 result:=jsonb_build_object('schema_version','refund-reversal-result/1','kind',p_kind,'id',p_id,'reviewed_stamp',p_stamp,
  'link_ids',to_jsonb(edges),'original_ids',to_jsonb(originals),'refund_ids',to_jsonb(refunds),
  'reversed_count',cardinality(edges),'refund_observation_count',cardinality(refunds),'observed_refund_cash_pence',cash,
  'income_reduction_removed_pence',income,'expense_reduction_removed_pence',expense,'profit_delta_pence',income-expense,'restored_prior_classifications',0);
 insert into public.refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end;$$;
revoke all on function public.reverse_refund_closure(text,uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_refund_closure(text,uuid,text,text,uuid) to authenticated;

-- Preserve historical one-original requests without allowing a legacy read-back
-- to authorise unseen sibling originals when shared-cash posting is introduced.
alter function public.reverse_refund_group(uuid,text,text,uuid) rename to reverse_refund_group_v1;
revoke all on function public.reverse_refund_group_v1(uuid,text,text,uuid) from public,anon,authenticated,service_role;
create function public.reverse_refund_group(p_original uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();graph jsonb;n integer;
begin
 if owner_id is null then raise exception 'Sign in to reverse refunds.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 if exists(select 1 from public.refund_requests where user_id=owner_id and request_id=p_request) then
  return public.reverse_refund_group_v1(p_original,p_stamp,p_reason,p_request);
 end if;
 graph:=public.read_refund_reversal_graph('original',p_original);
 select count(distinct v->>'original_transaction_id') into n from jsonb_array_elements(graph->'links') v;
 if n>1 then raise exception 'Review the complete connected refund reversal, including sibling originals.';end if;
 return public.reverse_refund_group_v1(p_original,p_stamp,p_reason,p_request);
end;$$;
revoke all on function public.reverse_refund_group(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_refund_group(uuid,text,text,uuid) to authenticated;
