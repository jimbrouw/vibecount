-- One cash observation can have several immutable refund effects. Ordinary
-- interpretations remain unique and never overwrite historical negative effects.
alter table public.financial_records drop constraint financial_records_bank_transaction_id_key;
create unique index financial_records_ordinary_bank_unique on public.financial_records(bank_transaction_id) where refund_link_id is null;

create or replace function public.review_bank_transaction_v1(p_id uuid,p_version integer,p_classification text,p_category uuid,p_bps integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  tx public.bank_transactions; owner_id uuid := auth.uid(); kind text; amount_pence bigint := 0;
  posting_id uuid; new_version integer;
begin
  if owner_id is null then raise exception 'Sign in to review transactions.'; end if;
  select * into tx from public.bank_transactions where id=p_id and user_id=owner_id for update;
  if not found then raise exception 'Transaction not found.'; end if;
  if not exists(select 1 from public.record_imports where id=tx.import_id and user_id=owner_id and status<>'discarded') then
    raise exception 'This import is reversed. Reopen it for review first.';
  end if;
  if tx.decision_version is distinct from p_version then raise exception 'Decision changed. Reload and review again.'; end if;
  if p_classification is null or p_classification not in ('Business','Personal','Mixed','Transfer','Refund','Unknown') then raise exception 'Choose a classification.'; end if;
  if p_rationale is null or length(btrim(p_rationale)) not between 1 and 1000 then raise exception 'Add a short reason.'; end if;
  kind := case when tx.signed_amount_pence > 0 then 'income' else 'expense' end;
  if p_classification in ('Business','Mixed') then
    if tx.dedupe_status <> 'clear' then raise exception 'Resolve possible duplicates before including this transaction.'; end if;
    if p_classification='Business' and p_bps is distinct from 10000 then raise exception 'Business use must be 100 percent.'; end if;
    if p_classification='Mixed' and (kind<>'expense' or p_bps is null or p_bps<=0 or p_bps>=10000) then raise exception 'Mixed expenses require a percentage between 0 and 100.'; end if;
    if not exists(select 1 from public.record_categories where id=p_category and record_type=kind and (user_id=owner_id or is_default)) then raise exception 'Choose an owned category of the correct type.'; end if;
    amount_pence := round(abs(tx.signed_amount_pence)::numeric*p_bps/10000)::bigint;
    if amount_pence=0 then raise exception 'Business amount rounds to zero.'; end if;
    insert into public.financial_records(user_id,record_type,record_date,description,amount,category_id,import_id,source_type,source_reference,status,approved_at,bank_transaction_id,effect_sign,refund_link_id)
      values(owner_id,kind,tx.transaction_date,tx.description,amount_pence::numeric/100,p_category,tx.import_id,'csv','Transaction '||tx.id::text,'approved',now(),tx.id,1,null)
      on conflict(bank_transaction_id) where refund_link_id is null do update set record_date=excluded.record_date,import_id=excluded.import_id,record_type=excluded.record_type,effect_sign=1,refund_link_id=null,source_reference=excluded.source_reference,amount=excluded.amount,category_id=excluded.category_id,status='approved',approved_at=now()
      returning id into posting_id;
  else
    if p_bps is distinct from 0 or p_category is not null then raise exception 'Excluded/unresolved classifications require zero business percentage and no category.'; end if;
    posting_id := tx.recognized_record_id;
    if posting_id is not null then update public.financial_records set status='excluded',approved_at=null where id=posting_id and user_id=owner_id; end if;
  end if;
  new_version := tx.decision_version+1;
  insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
    values(owner_id,tx.id,tx.import_id,new_version,p_classification,p_bps,p_category,btrim(p_rationale),amount_pence,owner_id);
  update public.bank_transactions set classification=p_classification,business_use_bps=p_bps,category_id=p_category,
    decision_version=new_version,recognized_record_id=posting_id,updated_at=now() where id=tx.id;
  return jsonb_build_object('version',new_version,'recognized_pence',amount_pence,'record_id',posting_id);
end; $$;

-- Existing connected cash must be internally complete before extending capacity.
create function public.validate_refund_extension(p_original uuid) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();graph jsonb;edges uuid[];refunds uuid[];originals uuid[];
begin
 graph:=public.read_refund_reversal_graph('original',p_original);
 select array_agg((v->>'id')::uuid),array_agg(distinct(v->>'refund_transaction_id')::uuid),array_agg(distinct(v->>'original_transaction_id')::uuid)
 into edges,refunds,originals from jsonb_array_elements(graph->'links') v;
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
 if exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=any(refunds)
  and (t.classification<>'Refund' or not exists(select 1 from public.active_refunds l where l.user_id=owner_id and l.refund_transaction_id=t.id and l.id=t.active_refund_id))) then raise exception 'Complete refund cash dependency state unavailable.';end if;
end;$$;
revoke all on function public.validate_refund_extension(uuid) from public,anon,authenticated,service_role;

-- Private shared writer. Public methods own their immutable payload/recovery.
create function public.write_reviewed_refund_split(p_refund uuid,p_version integer,p_allocations jsonb,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();refund public.bank_transactions;original public.bank_transactions;posting public.financial_records;prior_posting public.financial_records;
 a jsonb;cash bigint;gross bigint;reduced bigint;business bigint;link_id uuid;record_id uuid;marker uuid;
 portions jsonb:='[]';income bigint:=0;expense bigint:=0;removed_income bigint:=0;removed_expense bigint:=0;context text;nodes uuid[];
begin
 if owner_id is null then raise exception 'Sign in to review refunds.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 context:=public.reconciliation_export_stamp();
 if p_stamp is not null and context is distinct from p_stamp then raise exception 'Split refund financial context changed.';end if;
 select array_agg(id order by id) into nodes from (select p_refund id union select (v->>'original_id')::uuid from jsonb_array_elements(p_allocations) v) s;
 perform 1 from public.bank_transactions where user_id=owner_id and id=any(nodes) order by id for update;
 perform 1 from public.record_imports where user_id=owner_id and id in(select import_id from public.bank_transactions where user_id=owner_id and id=any(nodes)) order by id for share;
 perform 1 from public.financial_records where user_id=owner_id and bank_transaction_id=any(nodes) order by id for update;
 perform 1 from public.projects where id in(select project_id from public.financial_records where user_id=owner_id and bank_transaction_id=any(nodes)) order by id for share;
 perform 1 from public.record_categories where id in(select category_id from public.financial_records where user_id=owner_id and bank_transaction_id=any(nodes)) order by id for share;
 if public.reconciliation_export_stamp() is distinct from context then raise exception 'Split refund financial context changed.';end if;
 select * into refund from public.bank_transactions where id=p_refund and user_id=owner_id;
 if not found then raise exception 'Refund transaction not found.';end if;
 if refund.decision_version is distinct from p_version then raise exception 'Refund decisions changed. Review again.';end if;
 if cardinality(nodes)<>jsonb_array_length(p_allocations)+1 then raise exception 'Choose distinct original payments and refund cash.';end if;
 if (select count(*) from public.bank_transactions where user_id=owner_id and id=any(nodes))<>cardinality(nodes) then raise exception 'Original payment not found.';end if;
 if exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=any(nodes) and
  (t.currency<>'GBP' or t.dedupe_status<>'clear' or t.active_transfer_id is not null or t.active_refund_id is not null
   or not exists(select 1 from public.record_imports i where i.id=t.import_id and i.user_id=owner_id and i.status in('review','committed'))))
  or exists(select 1 from public.active_refunds where user_id=owner_id and refund_transaction_id=any(nodes))
  or exists(select 1 from public.active_refunds where user_id=owner_id and original_transaction_id=refund.id)
  then raise exception 'Resolve duplicates, transfers or existing refund relationships first.';end if;
 if exists(select 1 from public.active_invoice_allocations where user_id=owner_id and transaction_id=refund.id) then raise exception 'Reverse allocations on the refund observation first.';end if;
 cash:=abs(refund.signed_amount_pence);
 if (select sum((v->>'amount_pence')::numeric) from jsonb_array_elements(p_allocations) v)<>cash then raise exception 'Portions must allocate the entire observed refund cash exactly.';end if;
 select * into prior_posting from public.financial_records where id=refund.recognized_record_id and user_id=owner_id;
 if refund.recognized_record_id is not null and (not found or prior_posting.bank_transaction_id is distinct from refund.id or prior_posting.effect_sign<>1 or prior_posting.refund_link_id is not null) then raise exception 'Review existing source posting provenance.';end if;
 if exists(select 1 from public.financial_records f where f.user_id=owner_id and f.bank_transaction_id=refund.id and f.status='approved' and f.id is distinct from refund.recognized_record_id) then raise exception 'Refund source has an unreviewed extra accounting effect.';end if;
 if prior_posting.status='approved' then
  if prior_posting.import_id is distinct from refund.import_id or prior_posting.record_date<>refund.transaction_date or prior_posting.category_id is distinct from refund.category_id or prior_posting.category_id is null
   or not exists(select 1 from public.record_categories c where c.id=prior_posting.category_id and c.record_type=prior_posting.record_type and (c.user_id=owner_id or(c.user_id is null and c.is_default)))
   or refund.classification not in('Business','Mixed') or prior_posting.record_type<>(case when refund.signed_amount_pence>0 then 'income' else 'expense' end)
   or prior_posting.amount*100<>round(cash::numeric*refund.business_use_bps/10000) or refund.business_use_bps<1
   or (refund.classification='Business' and refund.business_use_bps<>10000) or (refund.classification='Mixed' and (refund.signed_amount_pence>0 or refund.business_use_bps>=10000))
   then raise exception 'Review the existing interpretation before replacing it.';end if;
  if prior_posting.record_type='income' then removed_income:=(prior_posting.amount*100)::bigint;else removed_expense:=(prior_posting.amount*100)::bigint;end if;
 end if;
 -- Validate every original and retained cumulative history before any mutation.
 for a in select v from jsonb_array_elements(p_allocations) v order by v->>'original_id' loop
  select * into original from public.bank_transactions where id=(a->>'original_id')::uuid and user_id=owner_id;
  if original.decision_version is distinct from (a->>'original_version')::integer or public.refund_group_stamp(original.id) is distinct from a->>'refund_stamp' then raise exception 'Refund decisions changed. Review again.';end if;
  if (original.signed_amount_pence>0)=(refund.signed_amount_pence>0) then raise exception 'Choose an opposite-sign GBP refund.';end if;
  select * into posting from public.financial_records where id=original.recognized_record_id and user_id=owner_id;
  if not found or posting.bank_transaction_id is distinct from original.id or posting.import_id is distinct from original.import_id or posting.status<>'approved' or posting.effect_sign<>1 or posting.refund_link_id is not null
   or (posting.project_id is not null and not exists(select 1 from public.projects p where p.id=posting.project_id and p.user_id=owner_id))
   or posting.record_date<>original.transaction_date or posting.category_id is distinct from original.category_id or posting.category_id is null
   or original.classification not in('Business','Mixed') or original.business_use_bps<1
   or (original.classification='Business' and original.business_use_bps<>10000) or (original.classification='Mixed' and (original.signed_amount_pence>0 or original.business_use_bps>=10000))
   or posting.amount*100<>round(abs(original.signed_amount_pence)::numeric*original.business_use_bps/10000)
   or posting.record_type<>(case when original.signed_amount_pence>0 then 'income' else 'expense' end)
   or not exists(select 1 from public.record_categories c where c.id=posting.category_id and c.record_type=posting.record_type and (c.user_id=owner_id or(c.user_id is null and c.is_default)))
   or exists(select 1 from public.financial_records f where f.user_id=owner_id and f.bank_transaction_id=original.id and f.status='approved' and f.id<>posting.id)
   then raise exception 'Review the original Business or Mixed payment first.';end if;
  if exists(select 1 from public.active_refunds l where l.user_id=owner_id and l.original_transaction_id=original.id and
   (l.record_type<>posting.record_type or l.category_id<>posting.category_id or l.business_use_bps<>original.business_use_bps
    or (l.recognized_pence>0 and not exists(select 1 from public.financial_records f where f.user_id=owner_id and f.refund_link_id=l.id and f.bank_transaction_id=l.refund_transaction_id and f.status='approved' and f.effect_sign=-1 and f.record_type=l.record_type and f.category_id=l.category_id and f.amount*100=l.recognized_pence))
    or (l.recognized_pence=0 and exists(select 1 from public.financial_records f where f.user_id=owner_id and f.refund_link_id=l.id and f.status='approved')))) then raise exception 'Complete cumulative refund history unavailable.';end if;
  if exists(select 1 from public.active_refunds where user_id=owner_id and original_transaction_id=original.id) then perform public.validate_refund_extension(original.id);end if;
  select coalesce(sum(amount_pence),0)::bigint,coalesce(sum(recognized_pence),0)::bigint into gross,reduced from public.active_refunds where user_id=owner_id and original_transaction_id=original.id;
  if gross>abs(original.signed_amount_pence) or reduced<>round(gross::numeric*original.business_use_bps/10000) then raise exception 'Complete cumulative refund history unavailable.';end if;
  if gross+(a->>'amount_pence')::bigint>abs(original.signed_amount_pence) then raise exception 'Refund exceeds remaining original payment.';end if;
  business:=round((gross+(a->>'amount_pence')::bigint)::numeric*original.business_use_bps/10000)::bigint-reduced;
  if business<0 or reduced+business>posting.amount*100 then raise exception 'Refund exceeds the recognised original amount.';end if;
  portions:=portions||jsonb_build_array(jsonb_build_object('original_id',original.id,'original_record_id',posting.id,'original_source_row_id',original.source_row_id,'original_import_id',original.import_id,'original_date',original.transaction_date,
   'original_version',original.decision_version,'category_id',posting.category_id,'project_id',posting.project_id,'record_type',posting.record_type,'business_use_bps',original.business_use_bps,
   'prior_refunded_pence',gross,'prior_reduced_pence',reduced,'amount_pence',(a->>'amount_pence')::bigint,'recognized_pence',business));
  if posting.record_type='income' then income:=income+business;else expense:=expense+business;end if;
 end loop;
 if public.reconciliation_export_stamp() is distinct from context then raise exception 'Split refund financial context changed.';end if;
 if prior_posting.id is not null then update public.financial_records set status='excluded',approved_at=null where id=prior_posting.id and user_id=owner_id;end if;
 for a in select v from jsonb_array_elements(portions) v loop
  insert into public.refund_links(user_id,original_transaction_id,refund_transaction_id,amount_pence,recognized_pence,record_type,business_use_bps,category_id,original_snapshot,refund_snapshot,author,rationale,request_id)
  values(owner_id,(a->>'original_id')::uuid,refund.id,(a->>'amount_pence')::bigint,(a->>'recognized_pence')::bigint,a->>'record_type',(a->>'business_use_bps')::integer,(a->>'category_id')::uuid,
   jsonb_build_object('decision_version',(a->>'original_version')::integer,'source_row_id',a->>'original_source_row_id','import_id',a->>'original_import_id','date',a->>'original_date','record_id',a->>'original_record_id','project_id',a->'project_id'),
   jsonb_build_object('decision_version',refund.decision_version,'source_row_id',refund.source_row_id,'import_id',refund.import_id,'date',refund.transaction_date),owner_id,btrim(p_reason),p_request) returning id into link_id;
  if marker is null then marker:=link_id;end if;
  record_id:=null;
  if (a->>'recognized_pence')::bigint>0 then
   insert into public.financial_records(user_id,record_type,record_date,description,amount,category_id,import_id,source_type,source_reference,status,approved_at,bank_transaction_id,effect_sign,refund_link_id,project_id)
   values(owner_id,a->>'record_type',refund.transaction_date,refund.description,(a->>'recognized_pence')::numeric/100,(a->>'category_id')::uuid,refund.import_id,'csv','Refund '||link_id::text,'approved',now(),refund.id,-1,link_id,(a->>'project_id')::uuid) returning id into record_id;
  end if;
 end loop;
 select jsonb_agg(v||jsonb_build_object('refund_link_id',l.id,'record_id',f.id) order by v->>'original_id') into portions
 from jsonb_array_elements(portions) v join public.refund_links l on l.user_id=owner_id and l.request_id=p_request and l.original_transaction_id=(v->>'original_id')::uuid
 left join public.financial_records f on f.user_id=owner_id and f.refund_link_id=l.id;
 insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
 values(owner_id,refund.id,refund.import_id,refund.decision_version+1,'Refund',0,null,btrim(p_reason),-income-expense,owner_id);
 update public.bank_transactions set classification='Refund',business_use_bps=0,category_id=null,decision_version=decision_version+1,recognized_record_id=null,active_refund_id=marker,updated_at=now() where id=refund.id and user_id=owner_id;
 return jsonb_build_object('schema_version','refund-split-result/1','refund_id',refund.id,'reviewed_stamp',context,'observed_cash_pence',cash,'allocated_cash_pence',cash,
  'recognized_reduction_pence',income+expense,'income_reduction_pence',income,'expense_reduction_pence',expense,'removed_ordinary_income_pence',removed_income,'removed_ordinary_expense_pence',removed_expense,
  'income_delta_pence',-income-removed_income,'expense_delta_pence',-expense-removed_expense,'profit_delta_pence',expense+removed_expense-income-removed_income,'portions',portions);
end;$$;
revoke all on function public.write_reviewed_refund_split(uuid,integer,jsonb,text,text,uuid) from public,anon,authenticated,service_role;

create function public.approve_refund_split(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();item jsonb;allocations jsonb:='[]';intent jsonb;prior public.refund_requests;payload text;result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review refunds.';end if;
 if jsonb_typeof(p_intent) is distinct from 'object' then raise exception 'Review exact split-refund fields.';end if;
 if (select count(*) from jsonb_object_keys(p_intent))<>7 or not(p_intent ?& array['schema_version','refund_id','refund_version','expected_stamp','allocations','rationale','request_id'])
  or p_intent->>'schema_version' is distinct from 'refund-split-intent/1' or jsonb_typeof(p_intent->'allocations') is distinct from 'array'
  or jsonb_typeof(p_intent->'rationale') is distinct from 'string' or length(btrim(p_intent->>'rationale')) not between 1 and 1000
  or jsonb_typeof(p_intent->'refund_id') is distinct from 'string' or jsonb_typeof(p_intent->'request_id') is distinct from 'string'
  or (p_intent->>'refund_id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or (p_intent->>'request_id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(p_intent->'expected_stamp') is distinct from 'string' or (p_intent->>'expected_stamp') !~ '^[a-f0-9]{32}$'
  or jsonb_typeof(p_intent->'refund_version') is distinct from 'number' or (p_intent->>'refund_version') !~ '^[0-9]+$' or (p_intent->>'refund_version')::numeric>2147483647
  then raise exception 'Review exact split-refund fields.';end if;
 if jsonb_array_length(p_intent->'allocations') not between 1 and 100 then raise exception 'Review one to 100 original portions.';end if;
 for item in select value from jsonb_array_elements(p_intent->'allocations') loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'Review exact original portions.';end if;
  if (select count(*) from jsonb_object_keys(item))<>4 or not(item ?& array['original_id','original_version','refund_stamp','amount_pence'])
   or jsonb_typeof(item->'original_id') is distinct from 'string' or jsonb_typeof(item->'refund_stamp') is distinct from 'string' or (item->>'refund_stamp') !~ '^[a-f0-9]{32}$'
   or (item->>'original_id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or jsonb_typeof(item->'original_version') is distinct from 'number' or (item->>'original_version') !~ '^[0-9]+$' or (item->>'original_version')::numeric>2147483647
   or jsonb_typeof(item->'amount_pence') is distinct from 'number' or (item->>'amount_pence') !~ '^[0-9]+$' or (item->>'amount_pence')::numeric not between 1 and 999999999999
   then raise exception 'Review exact original portions.';end if;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('original_id',(item->>'original_id')::uuid,'original_version',(item->>'original_version')::integer,'refund_stamp',item->>'refund_stamp','amount_pence',(item->>'amount_pence')::bigint));
 end loop;
 if (select count(distinct v->>'original_id') from jsonb_array_elements(allocations) v)<>jsonb_array_length(allocations) then raise exception 'An original can appear only once.';end if;
 select jsonb_agg(v order by v->>'original_id') into allocations from jsonb_array_elements(allocations) v;
 intent:=jsonb_build_object('schema_version','refund-split-intent/1','refund_id',(p_intent->>'refund_id')::uuid,'refund_version',(p_intent->>'refund_version')::integer,'expected_stamp',p_intent->>'expected_stamp','allocations',allocations,'rationale',btrim(p_intent->>'rationale'),'request_id',(p_intent->>'request_id')::uuid);
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('action','approve_refund_split/1','intent',intent)::text,'UTF8')),'hex');
 select * into prior from public.refund_requests where user_id=owner_id and request_id=(intent->>'request_id')::uuid;
 if found then if prior.payload_hash<>payload then raise exception 'Refund request changed.';end if;return prior.result;end if;
 result:=public.write_reviewed_refund_split((intent->>'refund_id')::uuid,(intent->>'refund_version')::integer,allocations,intent->>'expected_stamp',intent->>'rationale',(intent->>'request_id')::uuid);
 insert into public.refund_requests(user_id,request_id,payload_hash,result) values(owner_id,(intent->>'request_id')::uuid,payload,result);
 return result;
end;$$;
revoke all on function public.approve_refund_split(jsonb) from public,anon,service_role;
grant execute on function public.approve_refund_split(jsonb) to authenticated;

-- Keep the legacy method fingerprint and four-field result exactly as retained.
create or replace function public.approve_refund(p_original uuid,p_original_version integer,p_refund uuid,p_refund_version integer,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();payload text;prior public.refund_requests;result jsonb;split jsonb;cash bigint;
begin
 if owner_id is null then raise exception 'Sign in to review refunds.';end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm a refund reason and request ID.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_object('action','refund','original',p_original,'original_version',p_original_version,'refund',p_refund,'refund_version',p_refund_version,'stamp',p_stamp,'reason',btrim(p_reason))::text);
 select * into prior from public.refund_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Refund request changed.';end if;return prior.result;end if;
 select abs(signed_amount_pence) into cash from public.bank_transactions where user_id=owner_id and id=p_refund;
 if not found then raise exception 'Refund transaction not found.';end if;
 split:=public.write_reviewed_refund_split(p_refund,p_refund_version,jsonb_build_array(jsonb_build_object('original_id',p_original,'original_version',p_original_version,'refund_stamp',p_stamp,'amount_pence',cash)),null,btrim(p_reason),p_request);
 result:=jsonb_build_object('refund_id',split->'portions'->0->'refund_link_id','record_type',split->'portions'->0->'record_type','cash_pence',cash,'recognized_pence',-(split->>'recognized_reduction_pence')::bigint);
 insert into public.refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end;$$;


-- Legacy fresh one-original reversal excludes retained child effects explicitly.
create or replace function public.reverse_refund_group_v1(p_original uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); payload text; existing public.refund_requests; link public.refund_links; tx public.bank_transactions; result jsonb; n integer:=0; business bigint:=0;
begin
 if owner_id is null then raise exception 'Sign in to reverse refunds.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm reversal reason and request ID.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_object('action','reverse_group','original',p_original,'stamp',p_stamp,'reason',btrim(p_reason))::text);
 select * into existing from public.refund_requests where user_id=owner_id and request_id=p_request;
 if found then if existing.payload_hash<>payload then raise exception 'Refund request changed.'; end if; return existing.result; end if;
 if public.refund_group_stamp(p_original) is distinct from p_stamp or not exists(select 1 from public.active_refunds where original_transaction_id=p_original and user_id=owner_id) then raise exception 'Refund group changed. Review again.'; end if;
 perform 1 from public.bank_transactions where user_id=owner_id and (id=p_original or id in (select refund_transaction_id from public.active_refunds where original_transaction_id=p_original and user_id=owner_id)) order by id for update;
 for link in select * from public.active_refunds where original_transaction_id=p_original and user_id=owner_id order by id loop
  insert into public.refund_reversals(user_id,refund_id,author,rationale,request_id) values(owner_id,link.id,owner_id,btrim(p_reason),p_request);
  update public.bank_transactions set active_refund_id=null where id=link.refund_transaction_id and user_id=owner_id returning * into tx;
  update public.financial_records set status='excluded',approved_at=null where user_id=owner_id and refund_link_id=link.id;
  insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
  values(owner_id,tx.id,tx.import_id,tx.decision_version+1,'Unknown',0,null,btrim(p_reason),0,owner_id);
  update public.bank_transactions set classification='Unknown',business_use_bps=0,category_id=null,decision_version=tx.decision_version+1,recognized_record_id=null,updated_at=now() where id=tx.id and user_id=owner_id;
  n:=n+1;business:=business+link.recognized_pence;
 end loop;
 result:=jsonb_build_object('reversed_count',n,'removed_reduction_pence',business,'restored_prior_classifications',0);
 insert into public.refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;

-- Preserve per-child commercial capacities and historical assignment recovery.
create or replace function public.approve_invoice_refund_assignment(p_credit uuid,p_allocation uuid,p_refund uuid,p_amount bigint,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); c public.invoice_credit_notes; a public.invoice_settlements; r public.refund_links; prior public.invoice_refund_requests; b record; payload text; assignment uuid; result jsonb; used bigint;
begin
 if owner_id is null then raise exception 'Sign in to match recorded refunds.'; end if;
 if p_credit is null or p_allocation is null or p_refund is null or p_request is null or p_amount is null or p_amount not between 1 and 999999999999 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the exact refund assignment and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('action','assign','credit',p_credit,'allocation',p_allocation,'refund',p_refund,'amount',p_amount,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 select * into prior from public.invoice_refund_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Refund assignment request changed.'; end if; return prior.result; end if;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Reconciliation changed. Review the refund assignment again.'; end if;
 select * into c from public.active_invoice_credits where id=p_credit and user_id=owner_id;
 if not found then raise exception 'Active owned credit not found.'; end if;
 select * into a from public.active_invoice_allocations where id=p_allocation and user_id=owner_id and invoice_id=c.invoice_id;
 if not found then raise exception 'Choose the original receipt allocation for this invoice.'; end if;
 select * into r from public.active_refunds where id=p_refund and user_id=owner_id and original_transaction_id=a.transaction_id and record_type='income' and business_use_bps=10000;
 if not found then raise exception 'Choose an active customer refund of this original receipt.'; end if;
 perform 1 from public.invoices where id=c.invoice_id and user_id=owner_id for update;
 select * into b from public.invoice_payment_balances where id=c.invoice_id and user_id=owner_id and status='finalised' and currency='GBP';
 if not found then raise exception 'Choose a finalised GBP invoice.'; end if;
 -- A representative marker signals dependency only; this selected child need
 -- not be the marker, nor own all observed cash, nor have a scalar record pointer.
 perform 1 from public.bank_transactions where user_id=owner_id and id=r.refund_transaction_id for update;
 perform 1 from public.financial_records where user_id=owner_id and bank_transaction_id=r.refund_transaction_id order by id for update;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Reconciliation changed. Review the refund assignment again.';end if;
 if not exists(select 1 from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
  join public.financial_records f on f.user_id=t.user_id and f.bank_transaction_id=t.id and f.refund_link_id=r.id
  where t.id=r.refund_transaction_id and t.user_id=owner_id and t.classification='Refund' and t.currency='GBP' and t.signed_amount_pence<0
   and t.dedupe_status='clear' and t.active_transfer_id is null and i.status<>'discarded'
   and exists(select 1 from public.active_refunds m where m.user_id=owner_id and m.id=t.active_refund_id and m.refund_transaction_id=t.id)
   and (select sum(l.amount_pence) from public.active_refunds l where l.user_id=owner_id and l.refund_transaction_id=t.id)=-t.signed_amount_pence
   and f.status='approved' and f.record_type='income' and f.effect_sign=-1 and f.category_id=r.category_id and f.amount*100=r.recognized_pence)
  or exists(select 1 from public.active_refunds l where l.user_id=owner_id and l.refund_transaction_id=r.refund_transaction_id and
   (l.record_type<>'income' or l.business_use_bps<>10000 or l.recognized_pence<>l.amount_pence
    or not exists(select 1 from public.financial_records f where f.user_id=owner_id and f.refund_link_id=l.id and f.bank_transaction_id=l.refund_transaction_id and f.status='approved' and f.effect_sign=-1 and f.record_type=l.record_type and f.category_id=l.category_id and f.amount*100=l.recognized_pence)))
  or exists(select 1 from public.financial_records f where f.user_id=owner_id and f.bank_transaction_id=r.refund_transaction_id and f.status='approved'
   and not exists(select 1 from public.active_refunds l where l.user_id=owner_id and l.id=f.refund_link_id and l.refund_transaction_id=f.bank_transaction_id))
  then raise exception 'Review the recorded refund cash before assigning it.';end if;
 select coalesce(sum(amount_pence),0) into used from public.active_invoice_refund_assignments where user_id=owner_id and refund_id=r.id;
 if p_amount>r.amount_pence-used then raise exception 'Assignment exceeds remaining refund cash.'; end if;
 select coalesce(sum(amount_pence),0) into used from public.active_invoice_refund_assignments where user_id=owner_id and allocation_id=a.id;
 if p_amount>a.amount_pence-used then raise exception 'Assignment exceeds the original receipt allocation.'; end if;
 select coalesce(sum(amount_pence),0) into used from public.active_invoice_refund_assignments where user_id=owner_id and credit_id=c.id;
 if p_amount>c.gross_pence-used or p_amount>b.allocated_pence-b.returned_pence or p_amount>b.credited_pence-b.returned_pence then raise exception 'Assignment exceeds remaining invoice credit or receipt capacity.'; end if;
 insert into public.invoice_refund_assignments(user_id,invoice_id,allocation_id,credit_id,refund_id,amount_pence,author,rationale,request_id,invoice_snapshot,allocation_snapshot,credit_snapshot,refund_snapshot)
 values(owner_id,c.invoice_id,a.id,c.id,r.id,p_amount,owner_id,btrim(p_reason),p_request,to_jsonb(b),to_jsonb(a),to_jsonb(c),to_jsonb(r)) returning id into assignment;
 perform public.sync_invoice_settlement_state(c.invoice_id,owner_id);
 result:=jsonb_build_object('assignment_id',assignment,'amount_pence',p_amount,'recognized_income_change_pence',0);
 insert into public.invoice_refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.approve_invoice_refund_assignment(uuid,uuid,uuid,bigint,text,text,uuid) from public,anon,service_role;
grant execute on function public.approve_invoice_refund_assignment(uuid,uuid,uuid,bigint,text,text,uuid) to authenticated;

