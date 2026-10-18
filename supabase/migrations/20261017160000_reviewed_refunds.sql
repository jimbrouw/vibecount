-- Reviewed cash refunds are negative effects in the ORIGINAL accounting bucket.
alter table public.financial_records add column effect_sign smallint not null default 1 check(effect_sign in (-1,1));
create table public.refund_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,payload_hash text not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table public.refund_links (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 original_transaction_id uuid not null,refund_transaction_id uuid not null,amount_pence bigint not null check(amount_pence between 1 and 999999999999),
 recognized_pence bigint not null check(recognized_pence between 0 and 999999999999),record_type text not null check(record_type in ('income','expense')),
 business_use_bps integer not null check(business_use_bps between 1 and 10000),category_id uuid not null references public.record_categories(id),
 original_snapshot jsonb not null,refund_snapshot jsonb not null,
 author uuid not null references auth.users(id),rationale text not null check(length(btrim(rationale)) between 1 and 1000),request_id uuid not null,
 created_at timestamptz not null default now(),unique(id,user_id),check(original_transaction_id<>refund_transaction_id),
 constraint refund_links_original_owner_fk foreign key(original_transaction_id,user_id) references public.bank_transactions(id,user_id),
 constraint refund_links_refund_owner_fk foreign key(refund_transaction_id,user_id) references public.bank_transactions(id,user_id),
 foreign key(user_id,request_id) references public.refund_requests(user_id,request_id) deferrable initially deferred
);
create table public.refund_reversals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),refund_id uuid not null unique,
 author uuid not null references auth.users(id),rationale text not null check(length(btrim(rationale)) between 1 and 1000),request_id uuid not null,
 created_at timestamptz not null default now(),foreign key(refund_id,user_id) references public.refund_links(id,user_id),
 foreign key(user_id,request_id) references public.refund_requests(user_id,request_id) deferrable initially deferred
);
alter table public.financial_records add column refund_link_id uuid unique,
 add constraint financial_records_refund_owner_fk foreign key(refund_link_id,user_id) references public.refund_links(id,user_id),
 add constraint financial_records_effect_provenance check((effect_sign=1 and refund_link_id is null) or (effect_sign=-1 and refund_link_id is not null and bank_transaction_id is not null));
alter table public.bank_transactions add column active_refund_id uuid unique,
 add constraint transactions_active_refund_owner_fk foreign key(active_refund_id,user_id) references public.refund_links(id,user_id);
create index refund_original_owner on public.refund_links(user_id,original_transaction_id,id);
create index refund_transaction_owner on public.refund_links(user_id,refund_transaction_id,id);
create index refund_requests_index on public.refund_links(user_id,request_id);
create index refund_reversals_owner on public.refund_reversals(user_id,id);
create index refund_reversal_requests on public.refund_reversals(user_id,request_id);
alter table public.refund_requests enable row level security;
alter table public.refund_links enable row level security;
alter table public.refund_reversals enable row level security;
revoke all on public.refund_requests,public.refund_links,public.refund_reversals from public,anon,authenticated,service_role;
grant select on public.refund_requests,public.refund_links,public.refund_reversals to authenticated,service_role;
create policy refund_request_read on public.refund_requests for select to authenticated using(user_id=(select auth.uid()));
create policy refund_links_read on public.refund_links for select to authenticated using(user_id=(select auth.uid()));
create policy refund_reversals_read on public.refund_reversals for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_refund_requests before update or delete on public.refund_requests for each row execute function public.reject_source_mutation();
create trigger immutable_refund_links before update or delete on public.refund_links for each row execute function public.reject_source_mutation();
create trigger immutable_refund_reversals before update or delete on public.refund_reversals for each row execute function public.reject_source_mutation();
create view public.active_refunds with(security_invoker=true) as select l.* from public.refund_links l where not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=l.user_id);
revoke all on public.active_refunds from public,anon,authenticated,service_role;
grant select on public.active_refunds to authenticated,service_role;
create function public.protect_refund_effect() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') and (new.effect_sign<>1 or new.refund_link_id is not null or (tg_op='UPDATE' and (old.effect_sign<>1 or old.refund_link_id is not null))) then raise exception 'Use reviewed refund actions for negative accounting effects.'; end if;
 return new;
end; $$;
create trigger protect_refund_effect before insert or update on public.financial_records for each row execute function public.protect_refund_effect();

create function public.refund_group_stamp(p_original uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(coalesce((select decision_version::text from public.bank_transactions where id=p_original and user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(l.id::text||':'||coalesce(r.id::text,''),',' order by l.id) from public.refund_links l left join public.refund_reversals r on r.refund_id=l.id and r.user_id=l.user_id where l.original_transaction_id=p_original and l.user_id=(select auth.uid())),''));
$$;
revoke all on function public.refund_group_stamp(uuid) from public,anon;
grant execute on function public.refund_group_stamp(uuid) to authenticated;

create function public.approve_refund(p_original uuid,p_original_version integer,p_refund uuid,p_refund_version integer,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); original public.bank_transactions; refund public.bank_transactions; posting public.financial_records;
 already_gross bigint; already_business bigint; cash bigint; business bigint; link_id uuid; posting_id uuid; payload text; existing public.refund_requests; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review refunds.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm a refund reason and request ID.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_object('action','refund','original',p_original,'original_version',p_original_version,'refund',p_refund,'refund_version',p_refund_version,'stamp',p_stamp,'reason',btrim(p_reason))::text);
 select * into existing from public.refund_requests where user_id=owner_id and request_id=p_request;
 if found then if existing.payload_hash<>payload then raise exception 'Refund request changed.'; end if; return existing.result; end if;
 perform 1 from public.bank_transactions where user_id=owner_id and id in (p_original,p_refund) order by id for update;
 select * into original from public.bank_transactions where id=p_original and user_id=owner_id;
 if not found then raise exception 'Original payment not found.'; end if;
 select * into refund from public.bank_transactions where id=p_refund and user_id=owner_id;
 if not found then raise exception 'Refund transaction not found.'; end if;
 if original.decision_version is distinct from p_original_version or refund.decision_version is distinct from p_refund_version or public.refund_group_stamp(original.id) is distinct from p_stamp then raise exception 'Refund decisions changed. Review again.'; end if;
 if original.id=refund.id or original.currency<>'GBP' or refund.currency<>'GBP' or (original.signed_amount_pence>0)=(refund.signed_amount_pence>0) then raise exception 'Choose an opposite-sign GBP refund.'; end if;
 if original.dedupe_status<>'clear' or refund.dedupe_status<>'clear' or original.active_transfer_id is not null or refund.active_transfer_id is not null or original.active_refund_id is not null or refund.active_refund_id is not null
  or exists(select 1 from public.active_refunds where original_transaction_id=refund.id and user_id=owner_id) then raise exception 'Resolve duplicates, transfers or existing refund relationships first.'; end if;
 if exists(select 1 from public.record_imports where id in (original.import_id,refund.import_id) and user_id=owner_id and status='discarded') then raise exception 'Reopen reversed imports first.'; end if;
 if exists(select 1 from public.active_invoice_allocations where transaction_id=refund.id and user_id=owner_id) then raise exception 'Reverse allocations on the refund observation first.'; end if;
 select * into posting from public.financial_records where id=original.recognized_record_id and user_id=owner_id;
 if not found or posting.status<>'approved' or posting.effect_sign<>1 or original.classification not in ('Business','Mixed') or original.business_use_bps<1 or posting.category_id is null
   or posting.amount*100<>round(abs(original.signed_amount_pence)::numeric*original.business_use_bps/10000) or posting.record_type<>(case when original.signed_amount_pence>0 then 'income' else 'expense' end)
   then raise exception 'Review the original Business or Mixed payment first.'; end if;
 select coalesce(sum(amount_pence),0)::bigint,coalesce(sum(recognized_pence),0)::bigint into already_gross,already_business from public.active_refunds where original_transaction_id=original.id and user_id=owner_id;
 cash:=abs(refund.signed_amount_pence);
 if already_gross+cash>abs(original.signed_amount_pence) then raise exception 'Refund exceeds remaining original payment.'; end if;
 business:=round((already_gross+cash)::numeric*original.business_use_bps/10000)::bigint-already_business;
 if business<0 or already_business+business>posting.amount*100 then raise exception 'Refund exceeds the recognised original amount.'; end if;
 -- Exclude any previous interpretation; the approval below records one definitive decision.
 posting_id:=refund.recognized_record_id;
 if posting_id is not null then update public.financial_records set status='excluded',approved_at=null where id=posting_id and user_id=owner_id; end if;
 insert into public.refund_links(user_id,original_transaction_id,refund_transaction_id,amount_pence,recognized_pence,record_type,business_use_bps,category_id,original_snapshot,refund_snapshot,author,rationale,request_id)
 values(owner_id,original.id,refund.id,cash,business,posting.record_type,original.business_use_bps,posting.category_id,
  jsonb_build_object('decision_version',original.decision_version,'source_row_id',original.source_row_id,'import_id',original.import_id,'gross_pence',abs(original.signed_amount_pence),'recognized_pence',posting.amount*100,'record_id',posting.id,'date',original.transaction_date),
  jsonb_build_object('decision_version',refund.decision_version,'source_row_id',refund.source_row_id,'import_id',refund.import_id,'date',refund.transaction_date),owner_id,btrim(p_reason),p_request) returning id into link_id;
 if business>0 then
  insert into public.financial_records(user_id,record_type,record_date,description,amount,category_id,import_id,source_type,source_reference,status,approved_at,bank_transaction_id,effect_sign,refund_link_id,project_id)
  values(owner_id,posting.record_type,refund.transaction_date,refund.description,business::numeric/100,posting.category_id,refund.import_id,'csv','Refund '||link_id::text,'approved',now(),refund.id,-1,link_id,posting.project_id)
  on conflict(bank_transaction_id) do update set record_type=excluded.record_type,amount=excluded.amount,category_id=excluded.category_id,status='approved',approved_at=now(),effect_sign=-1,refund_link_id=excluded.refund_link_id,source_reference=excluded.source_reference,project_id=excluded.project_id returning id into posting_id;
 end if;
 insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
 values(owner_id,refund.id,refund.import_id,refund.decision_version+1,'Refund',original.business_use_bps,posting.category_id,btrim(p_reason),-business,owner_id);
 update public.bank_transactions set classification='Refund',business_use_bps=original.business_use_bps,category_id=posting.category_id,decision_version=decision_version+1,recognized_record_id=posting_id,active_refund_id=link_id,updated_at=now() where id=refund.id;
 result:=jsonb_build_object('refund_id',link_id,'record_type',posting.record_type,'cash_pence',cash,'recognized_pence',-business);
 insert into public.refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.approve_refund(uuid,integer,uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.approve_refund(uuid,integer,uuid,integer,text,text,uuid) to authenticated;

create function public.reverse_refund_group(p_original uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
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
  perform public.review_bank_transaction_v1(tx.id,tx.decision_version,'Unknown',null,0,btrim(p_reason));
  n:=n+1;business:=business+link.recognized_pence;
 end loop;
 result:=jsonb_build_object('reversed_count',n,'removed_reduction_pence',business,'restored_prior_classifications',0);
 insert into public.refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.reverse_refund_group(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_refund_group(uuid,text,text,uuid) to authenticated;

-- Canonical ordinary posting reuse must clear any former refund semantics.
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
      on conflict(bank_transaction_id) do update set project_id=case when financial_records.refund_link_id is not null then null else financial_records.project_id end,record_type=excluded.record_type,effect_sign=1,refund_link_id=null,source_reference=excluded.source_reference,amount=excluded.amount,category_id=excluded.category_id,status='approved',approved_at=now()
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

alter function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) rename to review_bank_transaction_v3;
revoke all on function public.review_bank_transaction_v3(uuid,integer,text,uuid,integer,text) from public,anon,authenticated,service_role;
create function public.review_bank_transaction(p_id uuid,p_version integer,p_classification text,p_category uuid,p_bps integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 if exists(select 1 from public.active_refunds where user_id=owner_id and p_id in (original_transaction_id,refund_transaction_id)) then raise exception 'Reverse the related refund group before reclassifying either source.'; end if;
 return public.review_bank_transaction_v3(p_id,p_version,p_classification,p_category,p_bps,p_rationale);
end; $$;
revoke all on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) from public,anon,service_role;
grant execute on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) to authenticated;

alter function public.approve_transfer_pair(uuid,integer,uuid,integer,text,text,uuid) rename to approve_transfer_pair_v1;
revoke all on function public.approve_transfer_pair_v1(uuid,integer,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
create function public.approve_transfer_pair(p_outgoing uuid,p_outgoing_version integer,p_incoming uuid,p_incoming_version integer,p_kind text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 if exists(select 1 from public.active_refunds where user_id=owner_id and (original_transaction_id in (p_outgoing,p_incoming) or refund_transaction_id in (p_outgoing,p_incoming))) then raise exception 'Reverse refund relationships before pairing a transfer.'; end if;
 return public.approve_transfer_pair_v1(p_outgoing,p_outgoing_version,p_incoming,p_incoming_version,p_kind,p_reason,p_request);
end; $$;
revoke all on function public.approve_transfer_pair(uuid,integer,uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.approve_transfer_pair(uuid,integer,uuid,integer,text,text,uuid) to authenticated;

create or replace view public.financial_record_quarter_summaries with(security_invoker=true) as
select user_id,tax_year_start,tax_quarter,
 coalesce(sum(amount*effect_sign) filter(where record_type='income' and status='approved'),0) income_total,
 coalesce(sum(amount*effect_sign) filter(where record_type='expense' and status='approved'),0) expense_total,
 count(*) filter(where record_type='income' and status='approved') income_count,
 count(*) filter(where record_type='expense' and status='approved') expense_count,
 coalesce(sum(amount*effect_sign) filter(where record_type='income' and status='approved'),0)-coalesce(sum(amount*effect_sign) filter(where record_type='expense' and status='approved'),0) net_total
from public.financial_records group by user_id,tax_year_start,tax_quarter;

create or replace function public.source_import_summary(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with tx as (select * from public.bank_transactions where import_id=p_id and user_id=(select auth.uid())),
  allocations as (select a.* from public.active_invoice_allocations a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  invoice_events as (select a.id from public.invoice_settlements a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  pair_history as (select p.* from public.transfer_pairs p where p.user_id=(select auth.uid()) and exists(select 1 from tx where tx.id in (p.outgoing_transaction_id,p.incoming_transaction_id))),
  pairs as (select p.* from pair_history p where not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=p.user_id)),
  pair_stamp as (select coalesce(string_agg(p.id::text||':'||coalesce(r.id::text,''),',' order by p.id),'') stamp from pair_history p left join public.transfer_reversals r on r.pair_id=p.id and r.user_id=p.user_id),
  counterpart_stamp as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from pairs p where t.id in (p.outgoing_transaction_id,p.incoming_transaction_id)))
  , refund_originals as (select distinct l.original_transaction_id from public.refund_links l where l.user_id=(select auth.uid()) and exists(select 1 from tx where tx.id in (l.original_transaction_id,l.refund_transaction_id))),
  refund_history as (select l.* from public.refund_links l join refund_originals o on o.original_transaction_id=l.original_transaction_id where l.user_id=(select auth.uid())),
  refunds as (select l.* from refund_history l where not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=l.user_id)),
  refund_stamp as (select coalesce(string_agg(l.id::text||':'||coalesce(r.id::text,''),',' order by l.id),'') stamp from refund_history l left join public.refund_reversals r on r.refund_id=l.id and r.user_id=l.user_id),
  refund_counterparts as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from refunds l where t.id in (l.original_transaction_id,l.refund_transaction_id)))
  select jsonb_build_object('transactions',count(tx.id),
    'income_pence',coalesce(sum(case when f.status='approved' and f.record_type='income' then f.amount*100*f.effect_sign else 0 end),0),
    'expense_pence',coalesce(sum(case when f.status='approved' and f.record_type='expense' then f.amount*100*f.effect_sign else 0 end),0),
    'allocation_count',(select count(*) from allocations),'allocation_pence',(select coalesce(sum(amount_pence),0) from allocations),
    'transfer_count',(select count(*) from pairs),'transfer_pence',(select coalesce(sum(amount_pence),0) from pairs),
    'refund_count',(select count(*) from refunds),'refund_pence',(select coalesce(sum(amount_pence),0) from refunds),
    'refund_income_reduction_pence',(select coalesce(sum(recognized_pence) filter(where record_type='income'),0) from refunds),
    'refund_expense_reduction_pence',(select coalesce(sum(recognized_pence) filter(where record_type='expense'),0) from refunds),
    'stamp',md5(coalesce(string_agg(tx.id::text||':'||tx.decision_version::text,',' order by tx.id),'')||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from invoice_events)||'|'||(select stamp from pair_stamp)||'|'||(select stamp from counterpart_stamp)||'|'||(select stamp from refund_stamp)||'|'||(select stamp from refund_counterparts)))
  from tx left join public.financial_records f on f.id=tx.recognized_record_id and f.user_id=tx.user_id;
$$;

alter function public.reverse_source_import(uuid,text,text) rename to reverse_source_import_v3;
revoke all on function public.reverse_source_import_v3(uuid,text,text) from public,anon,authenticated,service_role;
create function public.reverse_source_import(p_id uuid,p_stamp text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); summary jsonb; original_id uuid;
begin
 if owner_id is null then raise exception 'Sign in first.'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Add a reversal reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 if not exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and source_file_id is not null) then raise exception 'Preserved import not found.'; end if;
 if exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and status='discarded') then return 0; end if;
 summary:=public.source_import_summary(p_id);
 if summary->>'stamp' is distinct from p_stamp then raise exception 'Import decisions, allocations, transfers or refunds changed. Review again.'; end if;
 for original_id in select distinct l.original_transaction_id from public.active_refunds l where l.user_id=owner_id and exists(select 1 from public.bank_transactions t where t.import_id=p_id and t.user_id=owner_id and t.id in (l.original_transaction_id,l.refund_transaction_id)) order by l.original_transaction_id loop
  perform public.reverse_refund_group(original_id,public.refund_group_stamp(original_id),'Import reversal: '||left(btrim(p_reason),980),gen_random_uuid());
 end loop;
 summary:=public.source_import_summary(p_id);
 return public.reverse_source_import_v3(p_id,summary->>'stamp',p_reason);
end; $$;
revoke all on function public.reverse_source_import(uuid,text,text) from public,anon,service_role;
grant execute on function public.reverse_source_import(uuid,text,text) to authenticated;

create or replace view public.transfer_transaction_choices with(security_invoker=true) as
select t.id,t.user_id,t.account_id,t.import_id,t.transaction_date,t.signed_amount_pence,t.currency,t.description,t.reference,
  t.classification,t.decision_version,t.dedupe_status,t.active_transfer_id,
  a.label as account_label,a.masked_identifier as account_mask,a.account_type,
  i.status as import_status,f.status as record_status,
  case when f.status='approved' then (f.amount*100*f.effect_sign)::bigint else 0 end as recognized_pence,
  coalesce(s.allocated_pence,0)::bigint as invoice_allocated_pence,t.active_refund_id,exists(select 1 from public.active_refunds r where r.user_id=t.user_id and t.id in (r.original_transaction_id,r.refund_transaction_id)) as has_refunds
from public.bank_transactions t join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
left join (select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) s on s.transaction_id=t.id and s.user_id=t.user_id;

create view public.refund_transaction_choices with(security_invoker=true) as
select c.*,t.business_use_bps,f.record_type,f.effect_sign,f.category_id,
 coalesce(r.refunded_pence,0)::bigint refunded_pence,coalesce(r.reduced_pence,0)::bigint reduced_pence,
 coalesce(r.refund_count,0)::integer refund_count,public.refund_group_stamp(c.id) refund_stamp
from public.transfer_transaction_choices c join public.bank_transactions t on t.id=c.id and t.user_id=c.user_id
left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
left join(select user_id,original_transaction_id,sum(amount_pence) refunded_pence,sum(recognized_pence) reduced_pence,count(*) refund_count from public.active_refunds group by user_id,original_transaction_id) r on r.original_transaction_id=c.id and r.user_id=c.user_id;
revoke all on public.refund_transaction_choices from public,anon,authenticated,service_role;
grant select on public.refund_transaction_choices to authenticated;

create or replace function public.reconciliation_export_stamp() returns text language sql stable security invoker set search_path='' as $$
  select md5(
    (select coalesce(string_agg(id::text||':'||updated_at::text,',' order by id),'') from public.invoices where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text||':'||decision_version::text||':'||coalesce(active_transfer_id::text,''),',' order by id),'') from public.bank_transactions where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_settlements where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.transfer_pairs where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.transfer_reversals where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.refund_links where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.refund_reversals where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text||':'||updated_at::text||':'||status||':'||amount::text||':'||effect_sign::text,',' order by id),'') from public.financial_records where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text||':'||status,',' order by id),'') from public.record_imports where user_id=(select auth.uid()))
  );
$$;

create view public.refund_source_transactions with(security_invoker=true) as
select t.*,exists(select 1 from public.active_refunds r where r.user_id=t.user_id and t.id in (r.original_transaction_id,r.refund_transaction_id)) has_refunds from public.bank_transactions t;
revoke all on public.refund_source_transactions from public,anon,authenticated,service_role;
grant select on public.refund_source_transactions to authenticated;

create or replace view public.receipt_allocation_balances with(security_invoker=true) as
select t.id,t.user_id,t.import_id,t.transaction_date,t.description,t.reference,t.signed_amount_pence,t.currency,t.classification,
 t.business_use_bps,t.dedupe_status,t.decision_version,t.source_row_id,t.recognized_record_id,
 f.status as record_status,(f.amount*100*f.effect_sign)::bigint as recognized_pence,
 coalesce(a.allocated_pence,0)::bigint as allocated_pence,
 (t.signed_amount_pence-coalesce(a.allocated_pence,0))::bigint as unallocated_pence,t.active_transfer_id,
 t.active_refund_id,coalesce(r.refunded_pence,0)::bigint refunded_pence
from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
left join(select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) a on a.transaction_id=t.id and a.user_id=t.user_id
left join(select user_id,original_transaction_id,sum(amount_pence) refunded_pence from public.active_refunds group by user_id,original_transaction_id) r on r.original_transaction_id=t.id and r.user_id=t.user_id
where t.signed_amount_pence>0;

alter function public.approve_invoice_allocations(uuid,integer,jsonb,text,uuid,bigint) rename to approve_invoice_allocations_v1;
revoke all on function public.approve_invoice_allocations_v1(uuid,integer,jsonb,text,uuid,bigint) from public,anon,authenticated,service_role;
create function public.approve_invoice_allocations(p_transaction uuid,p_version integer,p_allocations jsonb,p_reason text,p_request uuid,p_expected_allocated bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 if exists(select 1 from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id where t.id=p_transaction and t.user_id=owner_id and (t.active_refund_id is not null or f.effect_sign=-1)) then raise exception 'A refund observation is not an invoice receipt.'; end if;
 return public.approve_invoice_allocations_v1(p_transaction,p_version,p_allocations,p_reason,p_request,p_expected_allocated);
end; $$;
revoke all on function public.approve_invoice_allocations(uuid,integer,jsonb,text,uuid,bigint) from public,anon,service_role;
grant execute on function public.approve_invoice_allocations(uuid,integer,jsonb,text,uuid,bigint) to authenticated;
