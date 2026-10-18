-- Stage B persistence: private until dimensioned review/export integration is complete.
alter table public.invoice_settlements
 add column settlement_kind text not null default 'native_gbp',
 add column invoice_minor bigint,add column invoice_currency text,add column invoice_revision_id uuid,
 add column conversion_lot_id uuid,add column lot_event_ordinal integer,add column fx_snapshot jsonb,
 add foreign key(invoice_revision_id,user_id) references public.invoice_revisions(id,user_id),
 add foreign key(conversion_lot_id,user_id) references public.fx_conversion_lots(id,user_id);
alter table public.invoice_settlements drop constraint invoice_settlements_amount_pence_check;
alter table public.invoice_settlements add constraint settlement_dimensions check(
 (settlement_kind='native_gbp' and amount_pence between 1 and 999999999999
  and invoice_minor is null and invoice_currency is null and invoice_revision_id is null and conversion_lot_id is null and lot_event_ordinal is null and fx_snapshot is null)
 or(settlement_kind='fx_gbp_cash' and amount_pence between 0 and 999999999999
  and invoice_minor is not null and invoice_minor between 1 and 999999999999
  and invoice_currency is not null and invoice_currency in('GBP','USD','EUR','JPY','KWD')
  and invoice_revision_id is not null and conversion_lot_id is not null and lot_event_ordinal is not null and lot_event_ordinal>0
  and fx_snapshot is not null and jsonb_typeof(fx_snapshot)='object'));
create unique index settlement_lot_ordinal on public.invoice_settlements(user_id,conversion_lot_id,lot_event_ordinal) where conversion_lot_id is not null;
-- Keep the existing active view's frozen column contract, including both kinds.
create view public.active_dimensioned_invoice_allocations with(security_invoker=true) as
select s.* from public.invoice_settlements s join public.active_invoice_allocations a on a.id=s.id and a.user_id=s.user_id;
revoke all on public.active_dimensioned_invoice_allocations from public,anon,authenticated,service_role;
grant select on public.active_dimensioned_invoice_allocations to authenticated,service_role;

create function public.fx_financial_stamp_addendum(p_owner uuid) returns text
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.fx_conversion_lots where user_id=p_owner) then md5('fx-financial/1|'||
 coalesce((select string_agg(id::text,',' order by id) from public.fx_conversion_lots where user_id=p_owner),'')||'|'||
 coalesce((select string_agg(id::text,',' order by id) from public.fx_document_fact_revisions where user_id=p_owner),'')||'|'||
 coalesce((select string_agg(d.id::text||':'||(exists(select 1 from storage.objects o where o.bucket_id='document-evidence' and o.name=d.object_path))::text,',' order by d.id)
 from public.evidence_documents d where d.user_id=p_owner and d.id in(select conversion_document_id from public.fx_conversion_lots where user_id=p_owner
 union select r.document_id from public.fx_conversion_lots l join public.fx_document_fact_revisions r on r.id=l.invoice_fact_revision_id and r.user_id=l.user_id where l.user_id=p_owner)),'')||'|'||
 coalesce((select string_agg(i.id::text||':'||b.purpose||':'||b.tax_year_start::text,',' order by i.id) from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id where i.user_id=p_owner),'')) end;
$$;
revoke all on function public.fx_financial_stamp_addendum(uuid) from public,anon,authenticated,service_role;
-- Historical base bodies stay intact. Wrap both CURRENT public and owner-derived
-- stamps once; legacy v19/v21 bases remain the retained native subexpressions.
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.reconciliation_export_stamp()'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.reconciliation_export_stamp(','FUNCTION public.reconciliation_export_stamp_pre_fx(');
 if copied=definition then raise exception 'Inspect public stamp declaration before copying its compatibility base.';end if;
 execute copied;
end;$$;
revoke all on function public.reconciliation_export_stamp_pre_fx() from public,anon,authenticated,service_role;
create or replace function public.reconciliation_export_stamp() returns text language sql stable security definer set search_path='' as $$
 select case when x.extra is null then x.base else md5(x.base||'|'||x.extra) end
 from(select public.reconciliation_export_stamp_pre_fx() base,public.fx_financial_stamp_addendum(auth.uid()) extra) x;
$$;
revoke all on function public.reconciliation_export_stamp() from public,anon,service_role;
grant execute on function public.reconciliation_export_stamp() to authenticated;
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.tax_financial_stamp_for_owner(uuid)'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.tax_financial_stamp_for_owner(','FUNCTION public.tax_financial_stamp_pre_fx(');
 if copied=definition then raise exception 'Inspect owner stamp declaration before copying its compatibility base.';end if;
 execute copied;
end;$$;
revoke all on function public.tax_financial_stamp_pre_fx(uuid) from public,anon,authenticated,service_role;
create or replace function public.tax_financial_stamp_for_owner(p_owner uuid) returns text language sql stable security definer set search_path='' as $$
 select case when x.extra is null then x.base else md5(x.base||'|'||x.extra) end
 from(select public.tax_financial_stamp_pre_fx(p_owner) base,public.fx_financial_stamp_addendum(p_owner) extra) x;
$$;
revoke all on function public.tax_financial_stamp_for_owner(uuid) from public,anon,authenticated,service_role;
create function public.fx_settlement_review_stamp() returns text language sql stable security definer set search_path='' as $$
 select md5('fx-settlement-context/1|'||public.fx_evidence_review_stamp());
$$;
revoke all on function public.fx_settlement_review_stamp() from public,anon,service_role;
grant execute on function public.fx_settlement_review_stamp() to authenticated;

create function public.validate_fx_settlement_intent(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a jsonb;normalized jsonb;allocations jsonb:='[]';rate jsonb;key text;n bigint;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>128000
 or(select count(*) from jsonb_object_keys(p))<>11 or not(p ?& array['schema_version','ruleset_id','receipt_id','receipt_version','expected_stamp','rationale','request_id','fee_mode','receipt_valuation_id','receipt_valuation_evidence_revision_id','allocations'])
 or p->>'schema_version' is distinct from 'fx-settlement-intent/1' or p->>'ruleset_id' is distinct from 'vibecount-currencies/1'
 or p->>'fee_mode' is distinct from 'none' or p->'receipt_valuation_id' is distinct from 'null'::jsonb or p->'receipt_valuation_evidence_revision_id' is distinct from 'null'::jsonb
 or jsonb_typeof(p->'rationale') is distinct from 'string' or length(btrim(p->>'rationale')) not between 1 and 1000
 or jsonb_typeof(p->'expected_stamp') is distinct from 'string' or length(p->>'expected_stamp')<>32 or p->>'expected_stamp' !~ '^[a-f0-9]{32}$'
 or jsonb_typeof(p->'receipt_version') is distinct from 'number' or p->>'receipt_version' !~ '^(0|[1-9][0-9]{0,9})$' or(p->>'receipt_version')::numeric>=2147483647
 or jsonb_typeof(p->'allocations') is distinct from 'array' or jsonb_array_length(p->'allocations') not between 1 and 50 then raise exception 'Review an exact bounded GBP-cash FX intent.';end if;
 for a in select value from jsonb_array_elements(p->'allocations') loop
  if jsonb_typeof(a) is distinct from 'object' or(select count(*) from jsonb_object_keys(a))<>12
  or not(a ?& array['invoice_id','invoice_revision_id','invoice_minor','cash_minor','conversion_date','rate','invoice_evidence_id','invoice_evidence_revision_id','conversion_evidence_id','conversion_evidence_revision_id','conversion_lot_id','conversion_lot_version']) then raise exception 'Review exact FX allocation fields.';end if;
  foreach key in array array['invoice_id','invoice_revision_id','invoice_evidence_id','invoice_evidence_revision_id','conversion_evidence_id','conversion_evidence_revision_id','conversion_lot_id'] loop
   a:=jsonb_set(a,array[key],to_jsonb(public.fx_fact_uuid(a->key,false)));
  end loop;
  foreach key in array array['invoice_minor','cash_minor','conversion_lot_version'] loop
   if jsonb_typeof(a->key) is distinct from 'number' or a->>key !~ '^(0|[1-9][0-9]{0,11})$' then raise exception 'Review exact nonnegative FX units/counters.';end if;
   n:=(a->>key)::bigint;
   if n>999999999999 or(key='invoice_minor' and n=0) or(key='conversion_lot_version' and n>=2147483647) then raise exception 'Review bounded FX units/counters.';end if;
  end loop;
  if jsonb_typeof(a->'conversion_date') is distinct from 'string' or length(a->>'conversion_date')<>10 or a->>'conversion_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or(a->>'conversion_date')::date not between date '1900-01-01' and date '9998-12-31' then raise exception 'Review an exact conversion date.';end if;
  rate:=public.fx_convert_minor(0,a->'rate','vibecount-currencies/1')->'rate';
  if rate->>'target_currency'<>'GBP' then raise exception 'Foreign receipt valuation needs a separate reviewed workflow.';end if;
  allocations:=allocations||jsonb_build_array(jsonb_set(a,'{rate}',rate));
 end loop;
 if(select count(distinct value->>'invoice_id') from jsonb_array_elements(allocations))<>jsonb_array_length(allocations) then raise exception 'Review each invoice once per request.';end if;
 select jsonb_agg(value order by value->>'invoice_id') into allocations from jsonb_array_elements(allocations);
 return p||jsonb_build_object('receipt_id',public.fx_fact_uuid(p->'receipt_id',false),'request_id',public.fx_fact_uuid(p->'request_id',false),'rationale',btrim(p->>'rationale'),'allocations',allocations);
end;$$;
revoke all on function public.validate_fx_settlement_intent(jsonb) from public,anon,authenticated,service_role;

create function public.fx_allocation_snapshot(p_lot uuid,p_owner uuid,p_prior_original bigint,p_prior_cash bigint,p_portion bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare lot public.fx_conversion_lots;tx public.bank_transactions;tranche jsonb;
begin
 select * into lot from public.fx_conversion_lots where id=p_lot and user_id=p_owner;
 select * into tx from public.bank_transactions where id=lot.transaction_id and user_id=p_owner;
 if lot.id is null or tx.id is null then raise exception 'Complete FX snapshot sources unavailable.';end if;
 tranche:=public.fx_convert_tranche(lot.rate,p_prior_original,p_prior_cash,p_portion,lot.ruleset_id);
 return jsonb_build_object('schema_version','fx-allocation-snapshot/1','lot_id',lot.id,'invoice_revision_id',lot.invoice_revision_id,
 'invoice_fact_revision_id',lot.invoice_fact_revision_id,'conversion_fact_revision_id',lot.conversion_fact_revision_id,
 'receipt_version',lot.transaction_version,'receipt_record_id',tx.recognized_record_id,'source_row_id',tx.source_row_id,'import_id',tx.import_id,
 'cash_date',tx.transaction_date,'value_date',tx.transaction_date,'observed_cash_pence',tx.signed_amount_pence,'receipt_recognized_gbp_pence',tx.signed_amount_pence,'ruleset_id',lot.ruleset_id,
 'invoice_currency',lot.invoice_currency,'cash_currency','GBP','rate',lot.rate,'conversion_date',lot.conversion_date,'evidence_date',lot.evidence_date,
 'documented_invoice_limit_minor',lot.invoice_limit_minor,'documented_cash_limit_minor',lot.cash_limit_minor,'tranche',tranche);
end;$$;
revoke all on function public.fx_allocation_snapshot(uuid,uuid,bigint,bigint,bigint) from public,anon,authenticated,service_role;

create function public.require_dimensioned_settlement() returns trigger
language plpgsql security invoker set search_path='' as $$
declare lot public.fx_conversion_lots;original public.invoice_settlements;rev public.invoice_revisions;prior_original bigint;prior_cash bigint;used_invoice bigint;used_cash bigint;ordinal bigint;active_count integer;snapshot jsonb;
begin
 if new.settlement_kind='native_gbp' then
  if not exists(select 1 from public.invoices i where i.id=new.invoice_id and i.user_id=new.user_id and i.origin='native_gbp' and i.currency='GBP' and i.amount is not null
   and i.original_total_minor is null and i.currency_ruleset_id is null and i.source_fact_revision_id is null and i.source_fact_family_id is null) then raise exception 'Use the reviewed currency-aware invoice relationship workflow.';end if;
  if new.reverses_id is not null and exists(select 1 from public.invoice_settlements where id=new.reverses_id and user_id=new.user_id and settlement_kind<>'native_gbp') then raise exception 'Reverse FX through the complete conversion lot.';end if;
  return new;
 end if;
 if new.settlement_kind is distinct from 'fx_gbp_cash' then raise exception 'Review supported settlement dimensions.';end if;
 if current_user in('authenticated','anon','service_role') or new.author is distinct from new.user_id or new.user_id is distinct from auth.uid() then raise exception 'Use the reviewed FX settlement workflow.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));
 select * into lot from public.fx_conversion_lots where id=new.conversion_lot_id and user_id=new.user_id;
 select * into rev from public.invoice_revisions where id=lot.invoice_revision_id and user_id=new.user_id;
 select count(*)+1 into ordinal from public.invoice_settlements where user_id=new.user_id and conversion_lot_id=lot.id;
 if lot.id is null or(new.invoice_id,new.transaction_id,new.invoice_revision_id,new.invoice_currency,new.lot_event_ordinal)
 is distinct from(lot.invoice_id,lot.transaction_id,lot.invoice_revision_id,lot.invoice_currency,ordinal::integer) or new.invoice_snapshot is distinct from rev.snapshot then raise exception 'Preserve exact FX lot dimensions and event order.';end if;
 if new.event_kind='reversal' then
  select * into original from public.active_dimensioned_invoice_allocations where id=new.reverses_id and user_id=new.user_id and settlement_kind='fx_gbp_cash';
  if original.id is null or(new.invoice_id,new.transaction_id,new.amount_pence,new.invoice_minor,new.invoice_currency,new.invoice_revision_id,new.conversion_lot_id,new.fx_snapshot,new.invoice_snapshot)
   is distinct from(original.invoice_id,original.transaction_id,original.amount_pence,original.invoice_minor,original.invoice_currency,original.invoice_revision_id,original.conversion_lot_id,original.fx_snapshot,original.invoice_snapshot)
   or exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=new.user_id and conversion_lot_id=lot.id and lot_event_ordinal>original.lot_event_ordinal) then raise exception 'Reverse retained FX portions in complete suffix order.';end if;
  return new;
 end if;
 perform public.bind_fx_conversion_lot(new.user_id,lot.id,lot.invoice_id,lot.invoice_revision_id,lot.conversion_fact_revision_id);
 select count(*)::integer,coalesce(sum(invoice_minor),0),coalesce(sum(amount_pence),0) into active_count,prior_original,prior_cash from public.active_dimensioned_invoice_allocations where user_id=new.user_id and conversion_lot_id=lot.id;
 if active_count>=10000 then raise exception 'FX lot exceeds the complete reversal review limit.';end if;
 select coalesce(sum(invoice_minor),0) into used_invoice from public.active_dimensioned_invoice_allocations where user_id=new.user_id and invoice_id=lot.invoice_id;
 select coalesce(sum(amount_pence),0) into used_cash from public.active_invoice_allocations where user_id=new.user_id and transaction_id=lot.transaction_id;
 snapshot:=public.fx_allocation_snapshot(lot.id,new.user_id,prior_original,prior_cash,new.invoice_minor);
 if new.fx_snapshot is distinct from snapshot or new.amount_pence is distinct from(snapshot#>>'{tranche,portion_target_minor}')::bigint
 or prior_original+new.invoice_minor>lot.invoice_limit_minor or prior_cash+new.amount_pence>lot.cash_limit_minor
 or used_invoice+new.invoice_minor>(select original_total_minor from public.invoices where id=lot.invoice_id and user_id=new.user_id)
 or used_cash+new.amount_pence>(select signed_amount_pence from public.bank_transactions where id=lot.transaction_id and user_id=new.user_id) then raise exception 'FX evidence, invoice or cash capacity changed.';end if;
 return new;
end;$$;
revoke all on function public.require_dimensioned_settlement() from public,anon,authenticated,service_role;
drop trigger native_settlement_invoice on public.invoice_settlements;
create trigger dimensioned_settlement_invoice before insert on public.invoice_settlements for each row execute function public.require_dimensioned_settlement();

create function public.approve_fx_invoice_allocations(p_intent jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid();i jsonb;entry jsonb;prior public.settlement_requests;payload text;lot public.fx_conversion_lots;rev public.invoice_revisions;
 version_no integer;original bigint;cash bigint;snapshot jsonb;ids jsonb:='[]';rows jsonb:='[]';event uuid;total_cash bigint:=0;result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review FX settlement.';end if;
 i:=public.validate_fx_settlement_intent(p_intent);
 payload:=encode(sha256(convert_to(jsonb_build_object('action','fx-allocate/1','intent',i)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.settlement_requests where user_id=owner_id and request_id=(i->>'request_id')::uuid;
 if found then if prior.payload_hash is distinct from payload then raise exception 'FX settlement request changed.';end if;return prior.result;end if;
 lock table public.invoices,public.invoice_revisions,public.bank_transactions,public.financial_records,public.record_imports,
 public.fx_document_fact_families,public.fx_document_fact_revisions,public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 if public.fx_settlement_review_stamp() is distinct from i->>'expected_stamp' then raise exception 'FX settlement context changed.';end if;
 for entry in select value from jsonb_array_elements(i->'allocations') loop
  select * into lot from jsonb_populate_record(null::public.fx_conversion_lots,public.bind_fx_conversion_lot(owner_id,(entry->>'conversion_lot_id')::uuid,(entry->>'invoice_id')::uuid,(entry->>'invoice_revision_id')::uuid,(entry->>'conversion_evidence_revision_id')::uuid));
  if lot.transaction_id is distinct from(i->>'receipt_id')::uuid or lot.transaction_version is distinct from(i->>'receipt_version')::integer
  or lot.invoice_fact_revision_id is distinct from(entry->>'invoice_evidence_revision_id')::uuid
  or lot.conversion_family_id is distinct from(entry->>'conversion_evidence_id')::uuid
  or not exists(select 1 from public.fx_document_fact_revisions where id=lot.invoice_fact_revision_id and user_id=owner_id and family_id=(entry->>'invoice_evidence_id')::uuid)
  or lot.rate is distinct from entry->'rate' or lot.conversion_date is distinct from(entry->>'conversion_date')::date then raise exception 'Reviewed FX proof identities or receipt meaning changed.';end if;
  select count(*)::integer into version_no from public.invoice_settlements where user_id=owner_id and conversion_lot_id=lot.id;
  if version_no is distinct from(entry->>'conversion_lot_version')::integer then raise exception 'FX lot history changed.';end if;
  select coalesce(sum(invoice_minor),0),coalesce(sum(amount_pence),0) into original,cash from public.active_dimensioned_invoice_allocations where user_id=owner_id and conversion_lot_id=lot.id;
  snapshot:=public.fx_allocation_snapshot(lot.id,owner_id,original,cash,(entry->>'invoice_minor')::bigint);
  if(entry->>'cash_minor')::bigint is distinct from(snapshot#>>'{tranche,portion_target_minor}')::bigint then raise exception 'Reviewed FX cash differs from cumulative conversion.';end if;
  select * into rev from public.invoice_revisions where id=lot.invoice_revision_id and user_id=owner_id;
  insert into public.invoice_settlements(user_id,invoice_id,transaction_id,amount_pence,event_kind,request_id,invoice_snapshot,author,rationale,
   settlement_kind,invoice_minor,invoice_currency,invoice_revision_id,conversion_lot_id,lot_event_ordinal,fx_snapshot)
  values(owner_id,lot.invoice_id,lot.transaction_id,(entry->>'cash_minor')::bigint,'allocation',(i->>'request_id')::uuid,rev.snapshot,owner_id,i->>'rationale',
   'fx_gbp_cash',(entry->>'invoice_minor')::bigint,lot.invoice_currency,lot.invoice_revision_id,lot.id,version_no+1,snapshot) returning id into event;
  ids:=ids||jsonb_build_array(event);total_cash:=total_cash+(entry->>'cash_minor')::bigint;
  rows:=rows||jsonb_build_array(jsonb_build_object('allocation_id',event,'invoice_id',lot.invoice_id,'invoice_currency',lot.invoice_currency,'invoice_minor',(entry->>'invoice_minor')::bigint,'cash_currency','GBP','cash_minor',(entry->>'cash_minor')::bigint,'lot_id',lot.id,'lot_version',version_no+1,'snapshot',snapshot));
 end loop;
 result:=jsonb_build_object('schema_version','fx-settlement-result/1','allocation_ids',ids,'rows',rows,'allocated_cash_pence',total_cash,'recognized_income_change_pence',0,'recognized_expense_change_pence',0);
 insert into public.settlement_requests(user_id,request_id,payload_hash,result) values(owner_id,(i->>'request_id')::uuid,payload,result);
 return result;
end;$$;
revoke all on function public.approve_fx_invoice_allocations(jsonb) from public,anon,authenticated,service_role;

create function public.reverse_fx_conversion_lot(p_lot uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid();prior public.settlement_requests;payload text;lot public.fx_conversion_lots;a public.invoice_settlements;event uuid;ordinal integer;
 ids jsonb:='[]';original bigint:=0;cash bigint:=0;result jsonb;
begin
 if owner_id is null or p_lot is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
 or p_stamp is null or length(p_stamp)<>32 or p_stamp !~ '^[a-f0-9]{32}$' then raise exception 'Review the complete FX lot reversal.';end if;
 payload:=encode(sha256(convert_to(jsonb_build_object('action','fx-reverse-lot/1','lot',p_lot,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.settlement_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash is distinct from payload then raise exception 'FX reversal request changed.';end if;return prior.result;end if;
 lock table public.invoices,public.bank_transactions,public.financial_records,public.record_imports,public.fx_document_fact_revisions,
 public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 if public.fx_settlement_review_stamp() is distinct from p_stamp then raise exception 'FX reversal context changed.';end if;
 select * into lot from public.fx_conversion_lots where id=p_lot and user_id=owner_id;
 if not found then raise exception 'Owned FX lot unavailable.';end if;
 if(select count(*) from public.active_dimensioned_invoice_allocations where user_id=owner_id and conversion_lot_id=lot.id)>10000 then raise exception 'Complete FX reversal exceeds the review limit.';end if;
 select count(*)::integer into ordinal from public.invoice_settlements where user_id=owner_id and conversion_lot_id=lot.id;
 for a in select * from public.active_dimensioned_invoice_allocations where user_id=owner_id and conversion_lot_id=lot.id order by lot_event_ordinal desc loop
  ordinal:=ordinal+1;
  insert into public.invoice_settlements(user_id,invoice_id,transaction_id,amount_pence,event_kind,reverses_id,request_id,invoice_snapshot,author,rationale,
   settlement_kind,invoice_minor,invoice_currency,invoice_revision_id,conversion_lot_id,lot_event_ordinal,fx_snapshot)
  values(owner_id,a.invoice_id,a.transaction_id,a.amount_pence,'reversal',a.id,p_request,a.invoice_snapshot,owner_id,btrim(p_reason),
   'fx_gbp_cash',a.invoice_minor,a.invoice_currency,a.invoice_revision_id,lot.id,ordinal,a.fx_snapshot) returning id into event;
  ids:=ids||jsonb_build_array(event);original:=original+a.invoice_minor;cash:=cash+a.amount_pence;
 end loop;
 if jsonb_array_length(ids)=0 then raise exception 'No active FX portions remain in this lot.';end if;
 result:=jsonb_build_object('schema_version','fx-lot-reversal-result/1','lot_id',lot.id,'reversal_ids',ids,'released_invoice_currency',lot.invoice_currency,'released_invoice_minor',original,'released_cash_currency','GBP','released_cash_pence',cash,'lot_version',ordinal,'recognized_income_change_pence',0,'recognized_expense_change_pence',0);
 insert into public.settlement_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end;$$;
revoke all on function public.reverse_fx_conversion_lot(uuid,text,text,uuid) from public,anon,authenticated,service_role;

-- Native completed requests recover first. Fresh FX reversal never enters native
-- paid-state synchronization or interprets original units as pounds.
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.reverse_invoice_allocation(uuid,text,uuid)'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.reverse_invoice_allocation(','FUNCTION public.reverse_invoice_allocation_pre_fx(');
 if copied=definition then raise exception 'Inspect reverse_invoice_allocation before copying its compatibility base.';end if;
 execute copied;
end;$$;
revoke all on function public.reverse_invoice_allocation_pre_fx(uuid,text,uuid) from public,anon,authenticated,service_role;
create or replace function public.reverse_invoice_allocation(p_allocation uuid,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null then raise exception 'Sign in to reverse allocations.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 if exists(select 1 from public.settlement_requests where user_id=owner_id and request_id=p_request) then return public.reverse_invoice_allocation_pre_fx(p_allocation,p_reason,p_request);end if;
 if exists(select 1 from public.invoice_settlements where id=p_allocation and user_id=owner_id and settlement_kind='fx_gbp_cash') then raise exception 'Review reversal of the complete FX conversion lot first.';end if;
 return public.reverse_invoice_allocation_pre_fx(p_allocation,p_reason,p_request);
end;$$;
revoke all on function public.reverse_invoice_allocation(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_invoice_allocation(uuid,text,uuid) to authenticated;

create function public.protect_active_fx_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;owners uuid[];source_id uuid;blocked boolean;
begin
 if tg_op='INSERT' then owners:=array[new.user_id];source_id:=new.bank_transaction_id;
 else
  owners:=array[old.user_id];
  if tg_op='UPDATE' then
   if to_jsonb(new) is not distinct from to_jsonb(old) then return new;end if;
   owners:=owners||new.user_id;
  end if;
 end if;
 -- Shared records can be inserted by privileged refund/classification paths.
 -- Protect both the old and new source link, not only status edits/deletion.
 if tg_table_name='financial_records' then
  if tg_op<>'INSERT' then source_id:=old.bank_transaction_id;end if;
  if source_id is null then
   if tg_op='DELETE' then return old;end if;
   if new.bank_transaction_id is null then return new;end if;
  end if;
 end if;
 for owner_id in select distinct v from unnest(owners) v where v is not null order by v loop
  perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 end loop;
 if tg_table_name='record_imports' then
  select exists(select 1 from public.active_dimensioned_invoice_allocations a join public.bank_transactions t on t.id=a.transaction_id and t.user_id=a.user_id
   where a.user_id=old.user_id and a.settlement_kind='fx_gbp_cash' and t.import_id=old.id) into blocked;
 elsif tg_table_name='bank_transactions' then
  select exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=old.user_id and transaction_id=old.id and settlement_kind='fx_gbp_cash') into blocked;
 else
  if tg_op='INSERT' then owner_id:=new.user_id;else owner_id:=old.user_id;end if;
  select exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=owner_id and transaction_id=source_id and settlement_kind='fx_gbp_cash') into blocked;
  if tg_op='UPDATE' then
   if not blocked then select exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=new.user_id and transaction_id=new.bank_transaction_id and settlement_kind='fx_gbp_cash') into blocked;end if;
  end if;
 end if;
 if blocked then raise exception 'Reverse active FX conversion lots before changing this source or recognised effect.';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function public.protect_active_fx_source() from public,anon,authenticated,service_role;
create trigger protect_active_fx_transaction before update or delete on public.bank_transactions for each row execute function public.protect_active_fx_source();
create trigger protect_active_fx_record before insert or update or delete on public.financial_records for each row execute function public.protect_active_fx_source();
create trigger protect_active_fx_import before update or delete on public.record_imports for each row execute function public.protect_active_fx_source();

-- Keep legacy import/refund read-back from presenting unsupported FX rows as GBP
-- native balances. A current dimensioned blocker catalog/UI is the next stage.
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.read_source_import_reversal_context(uuid)'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.read_source_import_reversal_context(','FUNCTION public.read_source_import_reversal_context_pre_fx(');
 if copied=definition then raise exception 'Inspect read_source_import_reversal_context before copying its compatibility base.';end if;
 execute copied;
end;$$;
revoke all on function public.read_source_import_reversal_context_pre_fx(uuid) from public,anon,authenticated,service_role;
create or replace function public.read_source_import_reversal_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;
begin
 context:=public.read_source_import_reversal_context_pre_fx(p_id);
 if exists(select 1 from public.active_dimensioned_invoice_allocations a where a.user_id=auth.uid() and a.settlement_kind='fx_gbp_cash'
  and a.transaction_id in(select(v->>'id')::uuid from jsonb_array_elements(context->'transactions') v)) then raise exception 'Review reversal of active FX conversion lots before this import.';end if;
 return context;
end;$$;
revoke all on function public.read_source_import_reversal_context(uuid) from public,anon,service_role;
grant execute on function public.read_source_import_reversal_context(uuid) to authenticated;

-- Current context now includes evidence provenance. The evidence writer's zero-
-- financial-effect assertion must compare the unchanged accounting/commercial
-- base, while its two full evidence-context freshness checks remain unchanged.
-- Retain the complete existing intent/hash/result/retry implementation.
do $$declare definition text;needle text:='public.reconciliation_export_stamp()';begin
 select pg_get_functiondef('public.review_fx_document_evidence(jsonb)'::regprocedure) into definition;
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Inspect evidence zero-effect assertions before FX stamp upgrade.';end if;
 execute replace(definition,needle,'public.reconciliation_export_stamp_pre_fx()');
end;$$;
revoke all on function public.review_fx_document_evidence(jsonb) from public,anon,service_role;
grant execute on function public.review_fx_document_evidence(jsonb) to authenticated;

-- Separate external document entitlement from actual GBP cash. No native paid/
-- delivery mutation and no inferred GBP invoice valuation are introduced.
create view public.external_invoice_settlement_balances with(security_invoker=true) as
select i.id,i.user_id,i.number,i.invoice_date,i.currency,r.id invoice_revision_id,i.original_total_minor,
 coalesce(a.original_minor,0)::bigint allocated_original_minor,
 (i.original_total_minor-coalesce(a.original_minor,0))::bigint outstanding_original_minor,
 'GBP'::text allocated_cash_currency,coalesce(a.cash_pence,0)::bigint allocated_cash_pence,
 case when coalesce(a.original_minor,0)=i.original_total_minor then 'settled' when coalesce(a.original_minor,0)>0 then 'part_paid' else 'unpaid' end settlement_state,
 exists(select 1 from public.invoice_settlements s where s.user_id=i.user_id and s.invoice_id=i.id) has_reconciliation_history
from public.invoices i join public.invoice_revisions r on r.invoice_id=i.id and r.user_id=i.user_id and r.version=i.external_revision and r.origin='preserved_external'
left join(select user_id,invoice_id,sum(invoice_minor) original_minor,sum(amount_pence) cash_pence from public.active_dimensioned_invoice_allocations where settlement_kind='fx_gbp_cash' group by user_id,invoice_id) a
 on a.invoice_id=i.id and a.user_id=i.user_id
where i.origin='preserved_external' and i.status='finalised';
revoke all on public.external_invoice_settlement_balances from public,anon,authenticated,service_role;
grant select on public.external_invoice_settlement_balances to authenticated,service_role;
