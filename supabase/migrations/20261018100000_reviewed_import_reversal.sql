-- Complete import reversal: one human review, one decision per affected source.
create table public.source_import_reversal_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,import_id uuid not null,
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id),foreign key(import_id,user_id) references public.record_imports(id,user_id)
);
alter table public.source_import_reversal_requests enable row level security;
revoke all on public.source_import_reversal_requests from public,anon,authenticated,service_role;
grant select on public.source_import_reversal_requests to authenticated,service_role;
create policy import_reversal_requests_read on public.source_import_reversal_requests for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_import_reversal_requests before update or delete on public.source_import_reversal_requests for each row execute function public.reject_source_mutation();

create function public.read_source_import_reversal_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();imp public.record_imports;graph jsonb;nodes uuid[];pairs jsonb;allocations jsonb;result jsonb;
begin
 if owner_id is null or p_id is null then raise exception 'Sign in and choose a preserved import.';end if;
 select * into imp from public.record_imports where id=p_id and user_id=owner_id and source_file_id is not null;
 if not found then raise exception 'Owned preserved import unavailable.';end if;
 graph:=public.read_refund_reversal_graph('import',p_id);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into pairs from (
  select p.id,p.user_id,p.outgoing_transaction_id,p.incoming_transaction_id,p.amount_pence,p.kind from public.active_transfer_pairs p
  where p.user_id=owner_id and exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.import_id=p_id and t.id in(p.outgoing_transaction_id,p.incoming_transaction_id)) order by p.id limit 20001
 ) s;
 select array_agg(id order by id) into nodes from (
  select (v->>'id')::uuid id from jsonb_array_elements(graph->'transactions') v
  union select (v->>'outgoing_transaction_id')::uuid from jsonb_array_elements(pairs) v
  union select (v->>'incoming_transaction_id')::uuid from jsonb_array_elements(pairs) v
 ) s;
 nodes:=coalesce(nodes,'{}'::uuid[]);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into allocations from (
  select a.id,a.user_id,a.invoice_id,a.transaction_id,a.amount_pence,
   (select count(*)::integer from public.active_invoice_refund_assignments r where r.user_id=owner_id and r.allocation_id=a.id) assignment_count
  from public.active_invoice_allocations a join public.bank_transactions t on t.id=a.transaction_id and t.user_id=a.user_id
  where t.import_id=p_id and t.user_id=owner_id order by a.id limit 20001
 ) s;
 if cardinality(nodes)>20000 or jsonb_array_length(pairs)>20000 or jsonb_array_length(allocations)>20000 then raise exception 'Complete import reversal exceeds the review limit.';end if;
 with transactions as (
  select t.id,t.user_id,t.import_id,t.source_row_id,t.transaction_date,t.decision_version,t.signed_amount_pence,t.currency,t.classification,
   t.account_id,a.account_type,i.status import_status,t.recognized_record_id,t.active_transfer_id,t.active_refund_id,
   (select count(*)::integer from public.financial_records f where f.user_id=owner_id and f.bank_transaction_id=t.id) record_count,
   (select count(*)::integer from public.active_invoice_allocations s where s.user_id=owner_id and s.transaction_id=t.id) allocation_count,
   (select count(*)::integer from public.active_transfer_pairs p where p.user_id=owner_id and t.id in(p.outgoing_transaction_id,p.incoming_transaction_id)) transfer_pair_count,
   (select count(*)::integer from public.active_refunds l where l.user_id=owner_id and l.original_transaction_id=t.id) original_link_count,
   (select count(*)::integer from public.active_refunds l where l.user_id=owner_id and l.refund_transaction_id=t.id) refund_link_count
  from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
  join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id where t.user_id=owner_id and t.id=any(nodes)
 ),effects as (
  select f.id,f.user_id,f.bank_transaction_id,f.import_id,f.record_date,f.record_type,(f.amount*100)::bigint amount_pence,f.effect_sign,f.refund_link_id,f.status,f.category_id,f.project_id
  from public.financial_records f where f.user_id=owner_id and(f.bank_transaction_id=any(nodes) or f.import_id=p_id) order by f.id limit 20001
 ),invoices as (
  select b.id,b.user_id,b.status,b.currency,b.invoice_pence,b.credited_pence,b.entitlement_pence,b.allocated_pence,b.returned_pence,b.retained_cash_pence,b.outstanding_pence,b.refund_due_pence
  from public.invoice_payment_balances b where b.user_id=owner_id and b.id in(select (v->>'invoice_id')::uuid from jsonb_array_elements(allocations) v)
 ),assignments as (
  select a.id,a.user_id,a.refund_id,a.allocation_id,a.amount_pence from public.active_invoice_refund_assignments a where a.user_id=owner_id and
   (a.refund_id in(select (v->>'id')::uuid from jsonb_array_elements(graph->'links') v) or a.allocation_id in(select (v->>'id')::uuid from jsonb_array_elements(allocations) v)) order by a.id limit 20001
 ),duplicates as (
  select d.id,d.user_id,d.transaction_id,d.retained_transaction_id from public.active_duplicate_decisions d
  join public.bank_transactions t on t.id=d.retained_transaction_id and t.user_id=d.user_id where t.user_id=owner_id and t.import_id=p_id order by d.id limit 20001
 ) select jsonb_build_object('schema_version','source-import-reversal-context/1','owner_id',owner_id,'import_id',p_id,'import_status',imp.status,'financial_stamp',public.reconciliation_export_stamp(),
  'counts',jsonb_build_object('target_transactions',(select count(*) from public.bank_transactions where user_id=owner_id and import_id=p_id),'transactions',cardinality(nodes),
   'effects',(select count(*) from public.financial_records where user_id=owner_id and(bank_transaction_id=any(nodes) or import_id=p_id)),
   'transfers',jsonb_array_length(pairs),'allocations',jsonb_array_length(allocations),'invoices',(select count(*) from invoices),
   'assignments',(select count(*) from public.active_invoice_refund_assignments a where a.user_id=owner_id and(a.refund_id in(select(v->>'id')::uuid from jsonb_array_elements(graph->'links') v) or a.allocation_id in(select(v->>'id')::uuid from jsonb_array_elements(allocations) v))),
   'duplicates',(select count(*) from public.active_duplicate_decisions d join public.bank_transactions t on t.id=d.retained_transaction_id and t.user_id=d.user_id where t.user_id=owner_id and t.import_id=p_id)),
  'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from transactions t),'[]'::jsonb),'effects',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from effects f),'[]'::jsonb),
  'transfer_pairs',pairs,'allocations',allocations,'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from invoices i),'[]'::jsonb),
  'blocking_assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from assignments a),'[]'::jsonb),'duplicate_references',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from duplicates d),'[]'::jsonb),'refund_graph',graph) into result;
 if exists(select 1 from jsonb_each(result->'counts') e where(e.value::text)::bigint>20000) then raise exception 'Complete import reversal exceeds the review limit.';end if;
 return result;
end;$$;
revoke all on function public.read_source_import_reversal_context(uuid) from public,anon,service_role;
grant execute on function public.read_source_import_reversal_context(uuid) to authenticated;

create function public.reverse_source_import_reviewed(p_id uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();prior public.source_import_reversal_requests;payload text;ctx jsonb;nodes uuid[];refunds uuid[];target uuid[];reset_ids uuid[];effects uuid[];
 tx public.bank_transactions;entry jsonb;request uuid;children jsonb:='[]';child jsonb;result jsonb;income bigint;expense bigint;
begin
 if owner_id is null then raise exception 'Sign in to reverse a preserved import.';end if;
 if p_id is null or p_request is null or p_stamp is null or p_stamp !~ '^[a-f0-9]{32}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the complete import reversal and reason.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('action','reverse_source_import_reviewed/1','import',p_id,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 select * into prior from public.source_import_reversal_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Import reversal request changed.';end if;return prior.result;end if;
 ctx:=public.read_source_import_reversal_context(p_id);
 if ctx->>'financial_stamp' is distinct from p_stamp or ctx->>'import_status' not in('review','committed') then raise exception 'Import reversal context changed. Review again.';end if;
 select coalesce(array_agg((v->>'id')::uuid),'{}'::uuid[]) into nodes from jsonb_array_elements(ctx->'transactions') v;
 perform 1 from public.bank_transactions where user_id=owner_id and id=any(nodes) order by id for update;
 perform 1 from public.record_imports where user_id=owner_id and id in(select import_id from public.bank_transactions where user_id=owner_id and id=any(nodes)) order by id for update;
 perform 1 from public.financial_records where user_id=owner_id and(bank_transaction_id=any(nodes) or import_id=p_id) order by id for update;
 perform 1 from public.invoices where user_id=owner_id and id in(select(v->>'id')::uuid from jsonb_array_elements(ctx->'invoices') v) order by id for update;
 ctx:=public.read_source_import_reversal_context(p_id);
 if ctx->>'financial_stamp' is distinct from p_stamp then raise exception 'Import reversal context changed. Review again.';end if;
 if jsonb_array_length(ctx->'blocking_assignments')>0 then raise exception 'Reverse every linked invoice refund assignment before this import.';end if;
 if jsonb_array_length(ctx->'duplicate_references')>0 then raise exception 'Reverse duplicate references to this retained source before this import.';end if;
 if exists(select 1 from jsonb_array_elements(ctx->'effects') f where f->>'bank_transaction_id' is null
  or not exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=(f->>'bank_transaction_id')::uuid and t.import_id=(f->>'import_id')::uuid)) then raise exception 'Complete source effect provenance unavailable.';end if;
 -- Validate reciprocal, disjoint transfer endpoints before invoking legacy helpers.
 if exists(select 1 from jsonb_array_elements(ctx->'transfer_pairs') v
  left join public.bank_transactions o on o.user_id=owner_id and o.id=(v->>'outgoing_transaction_id')::uuid
  left join public.bank_transactions i on i.user_id=owner_id and i.id=(v->>'incoming_transaction_id')::uuid
  left join public.financial_accounts oa on oa.id=o.account_id and oa.user_id=owner_id
  left join public.financial_accounts ia on ia.id=i.account_id and ia.user_id=owner_id
  where o.id is null or i.id is null or o.account_id=i.account_id or o.currency<>'GBP' or i.currency<>'GBP' or o.signed_amount_pence<>-(v->>'amount_pence')::bigint or i.signed_amount_pence<>(v->>'amount_pence')::bigint
   or o.active_transfer_id is distinct from(v->>'id')::uuid or i.active_transfer_id is distinct from(v->>'id')::uuid
   or o.classification<>'Transfer' or i.classification<>'Transfer' or oa.account_type<>'bank' or ia.account_type<>(case when v->>'kind'='card_repayment' then 'credit_card' else 'bank' end)
   or exists(select 1 from public.active_refunds l where l.user_id=owner_id and(o.id in(l.original_transaction_id,l.refund_transaction_id) or i.id in(l.original_transaction_id,l.refund_transaction_id)))
   or exists(select 1 from public.active_invoice_allocations a where a.user_id=owner_id and a.transaction_id in(o.id,i.id))
   or exists(select 1 from public.financial_records f where f.user_id=owner_id and f.status='approved' and f.bank_transaction_id in(o.id,i.id)))
  or exists(select 1 from jsonb_array_elements(ctx->'transactions') v where(v->>'transfer_pair_count')::integer>1 or(v->>'active_transfer_id' is not null and not exists(select 1 from jsonb_array_elements(ctx->'transfer_pairs') p where p->>'id'=v->>'active_transfer_id')))
  then raise exception 'Complete valid transfer dependencies unavailable.';end if;
 if exists(select 1 from jsonb_array_elements(ctx->'transactions') v where v->>'currency'<>'GBP' or v->>'import_status' not in('review','committed')) then raise exception 'Resolve affected source currency or import state first.';end if;
 if exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=any(nodes)
  and ((t.recognized_record_id is not null and not exists(select 1 from public.financial_records f where f.id=t.recognized_record_id and f.user_id=owner_id and f.bank_transaction_id=t.id))
   or(t.active_refund_id is not null and not exists(select 1 from jsonb_array_elements(ctx->'refund_graph'->'links') l where(l->>'id')::uuid=t.active_refund_id and(l->>'refund_transaction_id')::uuid=t.id))))
  or exists(select 1 from public.financial_records f where f.user_id=owner_id and f.bank_transaction_id=any(nodes) and f.status='approved' and f.effect_sign=-1
   and not exists(select 1 from jsonb_array_elements(ctx->'refund_graph'->'links') l where(l->>'id')::uuid=f.refund_link_id and(l->>'refund_transaction_id')::uuid=f.bank_transaction_id))
  then raise exception 'Complete refund/source posting provenance unavailable.';end if;
 select coalesce(array_agg((v->>'id')::uuid),'{}'::uuid[]) into target from jsonb_array_elements(ctx->'transactions') v where v->>'import_id'=p_id::text;
 select coalesce(array_agg(distinct(v->>'refund_transaction_id')::uuid),'{}'::uuid[]) into refunds from jsonb_array_elements(ctx->'refund_graph'->'links') v;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into reset_ids from(select unnest(target||refunds) id union select(v->>'outgoing_transaction_id')::uuid from jsonb_array_elements(ctx->'transfer_pairs') v union select(v->>'incoming_transaction_id')::uuid from jsonb_array_elements(ctx->'transfer_pairs') v) s;
 select coalesce(array_agg(f.id),'{}'::uuid[]),coalesce(sum(f.amount*100*f.effect_sign) filter(where f.record_type='income'),0)::bigint,coalesce(sum(f.amount*100*f.effect_sign) filter(where f.record_type='expense'),0)::bigint
 into effects,income,expense from public.financial_records f where f.user_id=owner_id and f.status='approved' and f.bank_transaction_id=any(reset_ids);
 if abs(income)>9007199254740991 or abs(expense)>9007199254740991 or abs(expense-income)>9007199254740991 then raise exception 'Import reversal totals exceed exact review bounds.';end if;
 if jsonb_array_length(ctx->'refund_graph'->'links')>0 then
  request:=gen_random_uuid();child:=public.reverse_refund_closure('import',p_id,p_stamp,p_reason,request);
  children:=children||jsonb_build_array(jsonb_build_object('kind','refund_closure','request_id',request,'result',child));
 end if;
 for entry in select value from jsonb_array_elements(ctx->'transfer_pairs') order by value->>'id' loop
  request:=gen_random_uuid();child:=public.reverse_transfer_pair((entry->>'id')::uuid,p_reason,request);
  children:=children||jsonb_build_array(jsonb_build_object('kind','transfer','request_id',request,'result',child));
 end loop;
 for entry in select value from jsonb_array_elements(ctx->'allocations') order by value->>'id' loop
  request:=gen_random_uuid();child:=public.reverse_invoice_allocation((entry->>'id')::uuid,p_reason,request);
  children:=children||jsonb_build_array(jsonb_build_object('kind','allocation','request_id',request,'result',child));
 end loop;
 -- Child operations already reset refund/transfer observations. Residual target
 -- rows get one explicit decision, with all source effects excluded by identity.
 update public.financial_records set status='excluded',approved_at=null where user_id=owner_id and bank_transaction_id=any(target);
 for tx in select * from public.bank_transactions where user_id=owner_id and id=any(target) and not(id=any(refunds))
  and not exists(select 1 from jsonb_array_elements(ctx->'transfer_pairs') p where id in((p->>'outgoing_transaction_id')::uuid,(p->>'incoming_transaction_id')::uuid)) order by id loop
  insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
   values(owner_id,tx.id,tx.import_id,tx.decision_version+1,'Unknown',0,null,p_reason,0,owner_id);
  update public.bank_transactions set classification='Unknown',business_use_bps=0,category_id=null,decision_version=tx.decision_version+1,recognized_record_id=null,updated_at=now() where id=tx.id and user_id=owner_id;
 end loop;
 -- Verify the promised once-only source transitions before committing history.
 if exists(select 1 from jsonb_array_elements(ctx->'transactions') v join public.bank_transactions t on t.id=(v->>'id')::uuid and t.user_id=owner_id
  where t.id=any(reset_ids) and(t.decision_version<>(v->>'decision_version')::integer+1 or t.classification<>'Unknown' or t.active_refund_id is not null or t.active_transfer_id is not null)) then raise exception 'Import reversal must reset each affected observation exactly once.';end if;
 update public.record_imports set status='discarded',committed_at=null where id=p_id and user_id=owner_id;
 insert into public.source_import_events(user_id,import_id,event,reason,author) values(owner_id,p_id,'reversed',btrim(p_reason),owner_id);
 result:=jsonb_build_object('schema_version','source-import-reversal-result/1','import_id',p_id,'reviewed_stamp',p_stamp,'target_ids',to_jsonb(target),'reset_ids',to_jsonb(reset_ids),'excluded_approved_record_ids',to_jsonb(effects),
  'income_delta_pence',-income,'expense_delta_pence',-expense,'profit_delta_pence',expense-income,'discarded_import_ids',jsonb_build_array(p_id),'restored_prior_classifications',0,'children',children);
 insert into public.source_import_reversal_requests(user_id,request_id,import_id,payload_hash,result) values(owner_id,p_request,p_id,payload,result);
 return result;
end;$$;
revoke all on function public.reverse_source_import_reviewed(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_source_import_reviewed(uuid,text,text,uuid) to authenticated;
