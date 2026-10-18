-- Durable human review precedes every new public FX financial action. Existing
-- financial cores/fingerprints remain private and unchanged.
create table public.fx_reviewed_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,
 kind text not null check(kind in('allocate','reverse')),intent jsonb not null,review_snapshot jsonb not null,
 author uuid not null references auth.users(id),created_at timestamptz not null default statement_timestamp(),
 primary key(user_id,request_id),check(author=user_id),check(jsonb_typeof(intent)='object' and jsonb_typeof(review_snapshot)='object'),
 check(octet_length(intent::text)<=128000 and octet_length(review_snapshot::text)<=2200000)
);
create table public.fx_reviewed_request_cancellations (
 user_id uuid not null,request_id uuid not null,author uuid not null references auth.users(id),created_at timestamptz not null default statement_timestamp(),
 primary key(user_id,request_id),foreign key(user_id,request_id) references public.fx_reviewed_requests(user_id,request_id),check(author=user_id)
);
alter table public.fx_reviewed_requests enable row level security;
alter table public.fx_reviewed_request_cancellations enable row level security;
revoke all on public.fx_reviewed_requests,public.fx_reviewed_request_cancellations from public,anon,authenticated,service_role;
grant select on public.fx_reviewed_requests,public.fx_reviewed_request_cancellations to authenticated;
create policy fx_reviewed_requests_owner on public.fx_reviewed_requests for select to authenticated using(user_id=(select auth.uid()));
create policy fx_reviewed_cancellations_owner on public.fx_reviewed_request_cancellations for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_fx_reviewed_requests before update or delete on public.fx_reviewed_requests for each row execute function public.reject_source_mutation();
create trigger immutable_fx_reviewed_cancellations before update or delete on public.fx_reviewed_request_cancellations for each row execute function public.reject_source_mutation();

create function public.validate_fx_lot_reversal_intent(p jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>8000 or(select count(*) from jsonb_object_keys(p))<>6
 or not(p ?& array['schema_version','lot_id','lot_version','expected_stamp','rationale','request_id'])
 or p->>'schema_version' is distinct from 'fx-lot-reversal-intent/1'
 or jsonb_typeof(p->'lot_version') is distinct from 'number' or p->>'lot_version' !~ '^[1-9][0-9]{0,9}$' or(p->>'lot_version')::numeric>=2147483647
 or jsonb_typeof(p->'expected_stamp') is distinct from 'string' or p->>'expected_stamp' !~ '^[a-f0-9]{32}$' or length(p->>'expected_stamp')<>32
 or jsonb_typeof(p->'rationale') is distinct from 'string' or length(btrim(p->>'rationale')) not between 1 and 1000 then raise exception 'Review the exact complete-lot reversal intent.';end if;
 return p||jsonb_build_object('lot_id',public.fx_fact_uuid(p->'lot_id',false),'request_id',public.fx_fact_uuid(p->'request_id',false),'rationale',btrim(p->>'rationale'));
end;$$;
revoke all on function public.validate_fx_lot_reversal_intent(jsonb) from public,anon,authenticated,service_role;

create function public.fx_reviewed_payload_hash(p_kind text,p_intent jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(case when p_kind='allocate' then jsonb_build_object('action','fx-allocate/1','intent',p_intent)
 else jsonb_build_object('action','fx-reverse-lot/1','lot',(p_intent->>'lot_id')::uuid,'stamp',p_intent->>'expected_stamp','reason',p_intent->>'rationale') end::text,'UTF8')),'hex');
$$;
revoke all on function public.fx_reviewed_payload_hash(text,jsonb) from public,anon,authenticated,service_role;

create function public.fx_reviewed_snapshot(p_kind text,p_intent jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();c jsonb;receipt jsonb;inv jsonb;lot jsonb;entry jsonb;fact public.fx_document_fact_revisions;tranche jsonb;rows jsonb:='[]';sources jsonb;parts jsonb;result jsonb;
 prior_original bigint;prior_cash bigint;total_cash bigint:=0;outstanding bigint;
begin
 c:=public.read_fx_settlement_catalog();
 if c->>'financial_stamp' is distinct from p_intent->>'expected_stamp' then raise exception 'FX review context changed.';end if;
 if p_kind='allocate' then
  select value into receipt from jsonb_array_elements(c->'receipts') where value->>'id'=p_intent->>'receipt_id';
  if receipt is null or(receipt->>'decision_version')::integer is distinct from(p_intent->>'receipt_version')::integer
   or receipt->>'classification'<>'Business' or(receipt->>'business_use_bps')::integer<>10000 or receipt->>'dedupe_status'<>'clear'
   or receipt->>'import_status' not in('review','committed') or(receipt->>'active_refund_count')::integer<>0
   or receipt->'active_transfer_id'<>'null'::jsonb or receipt->'active_refund_id'<>'null'::jsonb
   or receipt->>'record_status'<>'approved' or receipt->>'record_type'<>'income' or(receipt->>'effect_sign')::integer<>1
   or receipt->>'record_transaction_id' is distinct from receipt->>'id' or(receipt->>'recognized_gbp_pence')::bigint is distinct from(receipt->>'signed_minor')::bigint then raise exception 'Review eligible source-linked GBP receipt income.';end if;
  sources:=public.fx_settlement_source_context(owner_id,p_intent,true);
  for entry in select value from jsonb_array_elements(p_intent->'allocations') loop
   select value into inv from jsonb_array_elements(c->'invoices') where value->>'id'=entry->>'invoice_id' and value->>'revision_id'=entry->>'invoice_revision_id';
   select value into lot from jsonb_array_elements(c->'lots') where value->>'id'=entry->>'conversion_lot_id';
   select * into fact from public.fx_document_fact_revisions where id=(entry->>'conversion_evidence_revision_id')::uuid and user_id=owner_id;
   if inv is null or fact.id is null or fact.data->'rate' is distinct from entry->'rate' or fact.data->>'conversion_date' is distinct from entry->>'conversion_date'
    or fact.data#>>'{rate,source_currency}' is distinct from inv->>'currency' or(fact.data->>'invoice_portion_minor')::bigint>(inv->>'invoice_minor')::bigint
    or(fact.data->>'gbp_cash_portion_pence')::bigint>(receipt->>'signed_minor')::bigint then raise exception 'Selected FX invoice or conversion changed.';end if;
   if lot is null then
    if(entry->>'conversion_lot_version')::integer<>0 or exists(select 1 from public.fx_conversion_lots where id=(entry->>'conversion_lot_id')::uuid or(user_id=owner_id and(conversion_family_id=fact.family_id or(invoice_revision_id=(entry->>'invoice_revision_id')::uuid and transaction_id=(p_intent->>'receipt_id')::uuid and conversion_document_id=fact.document_id and rate=entry->'rate' and conversion_date=(entry->>'conversion_date')::date)))) then raise exception 'Reuse the retained conversion lot identity.';end if;
    prior_original:=0;prior_cash:=0;
   else
    if lot->>'invoice_revision_id' is distinct from entry->>'invoice_revision_id' or lot->>'invoice_fact_revision_id' is distinct from entry->>'invoice_evidence_revision_id'
     or(lot->>'receipt_version')::integer is distinct from(p_intent->>'receipt_version')::integer or lot->'rate' is distinct from entry->'rate' or lot->>'conversion_date' is distinct from entry->>'conversion_date'
     or lot->>'invoice_id' is distinct from entry->>'invoice_id' or lot->>'receipt_id' is distinct from p_intent->>'receipt_id'
     or lot->>'conversion_fact_revision_id' is distinct from entry->>'conversion_evidence_revision_id' or(lot->>'version')::integer is distinct from(entry->>'conversion_lot_version')::integer
     or(lot->>'active_count')::integer>=10000 then raise exception 'Retained lot history changed.';end if;
    prior_original:=(lot->>'prior_invoice_minor')::bigint;prior_cash:=(lot->>'prior_cash_minor')::bigint;
   end if;
   outstanding:=(inv->>'invoice_minor')::bigint-(inv->>'allocated_minor')::bigint;
   tranche:=public.fx_convert_tranche(entry->'rate',prior_original,prior_cash,(entry->>'invoice_minor')::bigint,'vibecount-currencies/1');
   if(entry->>'invoice_minor')::bigint>outstanding or(entry->>'cash_minor')::bigint is distinct from(tranche->>'portion_target_minor')::bigint
    or prior_original+(entry->>'invoice_minor')::bigint>(fact.data->>'invoice_portion_minor')::bigint
    or prior_cash+(entry->>'cash_minor')::bigint>(fact.data->>'gbp_cash_portion_pence')::bigint then raise exception 'Review exact FX capacities and cumulative conversion.';end if;
   total_cash:=total_cash+(entry->>'cash_minor')::bigint;
   rows:=rows||jsonb_build_array(jsonb_build_object('invoice_id',inv->'id','invoice_revision_id',inv->'revision_id','invoice_currency',inv->'currency',
    'invoice_minor',entry->'invoice_minor','cash_minor',entry->'cash_minor','invoice_outstanding_before_minor',outstanding,'invoice_outstanding_after_minor',outstanding-(entry->>'invoice_minor')::bigint,
    'conversion_lot_id',entry->'conversion_lot_id','conversion_lot_version',entry->'conversion_lot_version','tranche',tranche,'conversion_date',entry->'conversion_date',
    'evidence_date',fact.data->'evidence_date','invoice_limit_minor',fact.data->'invoice_portion_minor','cash_limit_pence',fact.data->'gbp_cash_portion_pence'));
  end loop;
  if total_cash>(receipt->>'signed_minor')::bigint-(receipt->>'allocated_minor')::bigint then raise exception 'Shared observed cash capacity changed.';end if;
 else
  parts:=public.read_fx_lot_portions((p_intent->>'lot_id')::uuid);
  if parts->>'financial_stamp' is distinct from p_intent->>'expected_stamp' or(parts->>'version')::integer is distinct from(p_intent->>'lot_version')::integer or(parts->>'active_count')::integer<1 then raise exception 'Review all current active FX portions.';end if;
  select value into receipt from jsonb_array_elements(c->'receipts') where value->>'id'=parts#>>'{lot,receipt_id}';
  select value into inv from jsonb_array_elements(c->'invoices') where value->>'id'=parts#>>'{lot,invoice_id}';
  if receipt is null or inv is null then raise exception 'Complete retained balances unavailable.';end if;
 end if;
 result:=jsonb_build_object('schema_version','fx-reviewed-snapshot/1','owner_id',owner_id,'kind',p_kind,'financial_stamp',p_intent->'expected_stamp',
  'receipt',jsonb_build_object('id',receipt->'id','import_id',receipt->'import_id','source_row_id',receipt->'source_row_id','cash_date',receipt->'transaction_date',
    'signed_cash_pence',receipt->'signed_minor','allocated_cash_pence',receipt->'allocated_minor','record_id',receipt->'recognized_record_id'),
  'rows',rows,'sources',coalesce(sources,'[]'),'invoice',case when p_kind='reverse' then inv else null end,'portion_review',parts,'financial_action','review_only');
 if octet_length(result::text)>2200000 then raise exception 'Complete saved FX review exceeds the safe limit.';end if;
 return result;
end;$$;
revoke all on function public.fx_reviewed_snapshot(text,jsonb) from public,anon,authenticated,service_role;

create function public.prepare_fx_reviewed_request(p_kind text,p_intent jsonb,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();i jsonb;prior public.fx_reviewed_requests;snapshot jsonb;result public.fx_reviewed_requests;
begin
 if owner_id is null or p_confirmed is distinct from true or p_kind is null or p_kind not in('allocate','reverse') then raise exception 'Sign in and confirm saving the exact FX review.';end if;
 i:=case when p_kind='allocate' then public.validate_fx_settlement_intent(p_intent) else public.validate_fx_lot_reversal_intent(p_intent) end;
 if p_kind='allocate' and(select count(distinct value->>'conversion_lot_id') from jsonb_array_elements(i->'allocations'))<>jsonb_array_length(i->'allocations') then raise exception 'Use distinct conversion lots for the selected invoices.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.fx_reviewed_requests where user_id=owner_id and request_id=(i->>'request_id')::uuid;
 if found then if prior.kind<>p_kind or prior.intent is distinct from i then raise exception 'Saved FX review request changed.';end if;return to_jsonb(prior);end if;
 if exists(select 1 from public.settlement_requests where user_id=owner_id and request_id=(i->>'request_id')::uuid) then raise exception 'This request already belongs to financial history.';end if;
 if exists(select 1 from public.fx_reviewed_requests r where r.user_id=owner_id
  and not exists(select 1 from public.settlement_requests s where s.user_id=r.user_id and s.request_id=r.request_id)
  and not exists(select 1 from public.fx_reviewed_request_cancellations x where x.user_id=r.user_id and x.request_id=r.request_id)) then raise exception 'Resolve the existing saved FX request before starting another.';end if;
 lock table public.invoices,public.invoice_revisions,public.bank_transactions,public.financial_records,public.record_imports,
 public.fx_conversion_lots,public.invoice_settlements,public.fx_document_fact_families,public.fx_document_fact_revisions,
 public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 snapshot:=public.fx_reviewed_snapshot(p_kind,i);
 insert into public.fx_reviewed_requests(user_id,request_id,kind,intent,review_snapshot,author) values(owner_id,(i->>'request_id')::uuid,p_kind,i,snapshot,owner_id) returning * into result;
 return to_jsonb(result);
end;$$;
revoke all on function public.prepare_fx_reviewed_request(text,jsonb,boolean) from public,anon,service_role;
grant execute on function public.prepare_fx_reviewed_request(text,jsonb,boolean) to authenticated;

create function public.commit_fx_reviewed_request(p_request uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();r public.fx_reviewed_requests;proof public.fx_settlement_source_checks;i jsonb;
begin
 if owner_id is null or p_request is null or p_confirmed is distinct from true then raise exception 'Sign in and confirm the saved FX financial review.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into r from public.fx_reviewed_requests where user_id=owner_id and request_id=p_request;
 if not found then raise exception 'Owned saved FX review unavailable.';end if;i:=r.intent;
 -- Completion recovery precedes cancellation, proof age and all current sources.
 if exists(select 1 from public.settlement_requests where user_id=owner_id and request_id=p_request) then
  if r.kind='allocate' then return public.approve_fx_invoice_allocations(i);end if;
  return public.reverse_fx_conversion_lot((i->>'lot_id')::uuid,i->>'expected_stamp',i->>'rationale',p_request);
 end if;
 if exists(select 1 from public.fx_reviewed_request_cancellations where user_id=owner_id and request_id=p_request) then raise exception 'This unsaved financial review was cancelled.';end if;
 lock table public.invoices,public.invoice_revisions,public.bank_transactions,public.financial_records,public.record_imports,
 public.fx_conversion_lots,public.invoice_settlements,public.fx_document_fact_families,public.fx_document_fact_revisions,
 public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 if public.fx_settlement_review_stamp() is distinct from i->>'expected_stamp' then raise exception 'Saved FX review changed. Cancel this uncompleted review and review current sources.';end if;
 if r.kind='allocate' then
  select * into proof from public.fx_settlement_source_checks where user_id=owner_id and request_id=p_request;
  if proof.id is null or proof.outcome<>'verified' or proof.intent is distinct from i
   or proof.checked_at<statement_timestamp()-interval '5 minutes' or proof.checked_at>statement_timestamp()
   or proof.sources is distinct from public.fx_settlement_source_context(owner_id,i,true) then raise exception 'Fresh exact private FX source check required.';end if;
  return public.approve_fx_invoice_allocations(i);
 end if;
 if public.read_fx_lot_portions((i->>'lot_id')::uuid) is distinct from r.review_snapshot->'portion_review' then raise exception 'Complete retained reversal portions changed.';end if;
 return public.reverse_fx_conversion_lot((i->>'lot_id')::uuid,i->>'expected_stamp',i->>'rationale',p_request);
end;$$;
revoke all on function public.commit_fx_reviewed_request(uuid,boolean) from public,anon,service_role;
grant execute on function public.commit_fx_reviewed_request(uuid,boolean) to authenticated;

create function public.cancel_fx_reviewed_request(p_request uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();r public.fx_reviewed_requests;
begin
 if owner_id is null or p_request is null or p_confirmed is distinct from true then raise exception 'Confirm cancellation of this saved financial review.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into r from public.fx_reviewed_requests where user_id=owner_id and request_id=p_request;if not found then raise exception 'Owned saved FX review unavailable.';end if;
 if exists(select 1 from public.settlement_requests where user_id=owner_id and request_id=p_request) then raise exception 'Financial result already exists; review its history rather than cancelling.';end if;
 insert into public.fx_reviewed_request_cancellations(user_id,request_id,author) values(owner_id,p_request,owner_id) on conflict do nothing;
 return jsonb_build_object('request_id',p_request,'state','cancelled');
end;$$;
revoke all on function public.cancel_fx_reviewed_request(uuid,boolean) from public,anon,service_role;
grant execute on function public.cancel_fx_reviewed_request(uuid,boolean) to authenticated;

create function public.read_fx_reviewed_request(p_request uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();r public.fx_reviewed_requests;s public.settlement_requests;cancelled boolean;result jsonb;
begin
 if owner_id is null or p_request is null then raise exception 'Choose an owned saved FX request.';end if;
 select * into r from public.fx_reviewed_requests where user_id=owner_id and request_id=p_request;if not found then raise exception 'Owned saved FX review unavailable.';end if;
 select * into s from public.settlement_requests where user_id=owner_id and request_id=p_request;
 if s.request_id is not null and s.payload_hash is distinct from public.fx_reviewed_payload_hash(r.kind,r.intent) then raise exception 'Financial request history disagrees with its saved review.';end if;
 select exists(select 1 from public.fx_reviewed_request_cancellations where user_id=owner_id and request_id=p_request) into cancelled;
 if cancelled and s.request_id is not null then raise exception 'Saved FX request state disagrees.';end if;
 result:=jsonb_build_object('schema_version','fx-reviewed-request/1','request',to_jsonb(r),'state',case when s.request_id is not null then 'completed' when cancelled then 'cancelled' else 'prepared' end,'result',s.result);
 if octet_length(result::text)>4400000 then raise exception 'Complete saved request exceeds the safe payload limit.';end if;return result;
end;$$;
revoke all on function public.read_fx_reviewed_request(uuid) from public,anon,service_role;
grant execute on function public.read_fx_reviewed_request(uuid) to authenticated;

create function public.read_fx_reviewed_requests(p_after uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();rows jsonb;pending uuid;
begin
 if owner_id is null then raise exception 'Sign in to read saved FX reviews.';end if;
 if exists(select 1 from public.fx_reviewed_requests r join public.settlement_requests s on s.user_id=r.user_id and s.request_id=r.request_id where r.user_id=owner_id and s.payload_hash is distinct from public.fx_reviewed_payload_hash(r.kind,r.intent)) then raise exception 'Saved FX request history disagrees.';end if;
 select r.request_id into pending from public.fx_reviewed_requests r where r.user_id=owner_id
  and not exists(select 1 from public.settlement_requests s where s.user_id=r.user_id and s.request_id=r.request_id)
  and not exists(select 1 from public.fx_reviewed_request_cancellations x where x.user_id=r.user_id and x.request_id=r.request_id) order by r.request_id limit 1;
 select coalesce(jsonb_agg(to_jsonb(v) order by v.request_id desc),'[]') into rows from(
  select r.request_id,r.kind,r.created_at,case when exists(select 1 from public.settlement_requests s where s.user_id=r.user_id and s.request_id=r.request_id) then 'completed'
   when exists(select 1 from public.fx_reviewed_request_cancellations x where x.user_id=r.user_id and x.request_id=r.request_id) then 'cancelled' else 'prepared' end state
  from public.fx_reviewed_requests r where r.user_id=owner_id and(p_after is null or r.request_id<p_after) order by r.request_id desc limit 21
 ) v;
 return jsonb_build_object('schema_version','fx-reviewed-request-index/1','owner_id',owner_id,'pending_request_id',pending,'requests',rows);
end;$$;
revoke all on function public.read_fx_reviewed_requests(uuid) from public,anon,service_role;
grant execute on function public.read_fx_reviewed_requests(uuid) to authenticated;
