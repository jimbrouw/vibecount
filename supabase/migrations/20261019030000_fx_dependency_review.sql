-- Unsupported FX/refund combinations are blocked in both directions, including
-- original receipts whose active_refund_id scalar marker is deliberately null.
do $$declare definition text;needle text;replacement text;begin
 select pg_get_functiondef('public.bind_fx_conversion_lot(uuid,uuid,uuid,uuid,uuid)'::regprocedure) into definition;
 needle:='or tx.active_refund_id is not null';
 replacement:=needle||' or exists(select 1 from public.active_refunds ar where ar.user_id=p_owner and tx.id in(ar.original_transaction_id,ar.refund_transaction_id))';
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect FX receipt dependency check before upgrade.';end if;
 execute replace(definition,needle,replacement);
 select pg_get_functiondef('public.write_reviewed_refund_split(uuid,integer,jsonb,text,text,uuid)'::regprocedure) into definition;
 needle:='perform 1 from public.bank_transactions where user_id=owner_id and id=any(nodes) order by id for update;';
 replacement:='if exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=owner_id and settlement_kind=''fx_gbp_cash'' and transaction_id=any(nodes)) then raise exception ''Review and reverse linked FX lots before changing refund relationships.'';end if;'||chr(10)||needle;
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect complete refund creation endpoints before upgrade.';end if;
 execute replace(definition,needle,replacement);
 select pg_get_functiondef('public.reverse_refund_closure(text,uuid,text,text,uuid)'::regprocedure) into definition;
 -- This anchor is after retained-request recovery and complete node discovery.
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect complete refund reversal endpoints before upgrade.';end if;
 execute replace(definition,needle,replacement);
 select pg_get_functiondef('public.approve_invoice_refund_assignment(uuid,uuid,uuid,bigint,text,text,uuid)'::regprocedure) into definition;
 needle:='perform 1 from public.invoices where id=c.invoice_id and user_id=owner_id for update;';
 replacement:='if exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=owner_id and settlement_kind=''fx_gbp_cash'' and transaction_id=a.transaction_id) then raise exception ''Review and reverse linked FX lots before assigning returned cash.'';end if;'||chr(10)||needle;
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect invoice refund assignment dependencies before upgrade.';end if;
 execute replace(definition,needle,replacement);
end;$$;

create function public.protect_fx_refund_relationship() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));
 if exists(select 1 from public.active_dimensioned_invoice_allocations where user_id=new.user_id and settlement_kind='fx_gbp_cash' and transaction_id in(new.original_transaction_id,new.refund_transaction_id)) then raise exception 'Review and reverse linked FX lots before changing refund relationships.';end if;
 return new;
end;$$;
revoke all on function public.protect_fx_refund_relationship() from public,anon,authenticated,service_role;
create trigger protect_fx_refund_relationship before insert on public.refund_links for each row execute function public.protect_fx_refund_relationship();

-- Also cover the retained legacy single-original reversal path and future helpers.
create function public.protect_fx_refund_reversal() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));
 if exists(select 1 from public.refund_links r join public.active_dimensioned_invoice_allocations a on a.user_id=r.user_id and a.transaction_id in(r.original_transaction_id,r.refund_transaction_id)
  where r.user_id=new.user_id and r.id=new.refund_id and a.settlement_kind='fx_gbp_cash') then raise exception 'Review and reverse linked FX lots before changing refund relationships.';end if;
 return new;
end;$$;
revoke all on function public.protect_fx_refund_reversal() from public,anon,authenticated,service_role;
create trigger protect_fx_refund_reversal before insert on public.refund_reversals for each row execute function public.protect_fx_refund_reversal();

-- Preserve the retained V1 function body privately and replace the current OID.
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.read_fx_settlement_catalog()'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.read_fx_settlement_catalog(','FUNCTION public.read_fx_settlement_catalog_v1(');
 if copied=definition then raise exception 'Inspect FX catalog declaration before copying its retained base.';end if;execute copied;
end;$$;
revoke all on function public.read_fx_settlement_catalog_v1() from public,anon,authenticated,service_role;
create or replace function public.read_fx_settlement_catalog() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb;receipts jsonb;begin
 context:=public.read_fx_settlement_catalog_v1();
 select coalesce(jsonb_agg(v||jsonb_build_object('active_refund_count',(select count(*) from public.active_refunds r where r.user_id=auth.uid() and(v->>'id')::uuid in(r.original_transaction_id,r.refund_transaction_id))) order by v->>'id'),'[]') into receipts from jsonb_array_elements(context->'receipts') v;
 context:=context||jsonb_build_object('schema_version','fx-settlement-catalog/2','receipts',receipts);
 if octet_length(context::text)>2000000 then raise exception 'Complete FX settlement context exceeds the safe payload limit.';end if;
 return context;
end;$$;
revoke all on function public.read_fx_settlement_catalog() from public,anon,service_role;
grant execute on function public.read_fx_settlement_catalog() to authenticated;

-- Full retained-lot summaries for any affected source, including zero cash.
create function public.fx_dependency_blockers(p_owner uuid,p_nodes uuid[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if p_owner is null or p_owner is distinct from auth.uid() or cardinality(p_nodes)>20000 then raise exception 'Complete owned FX dependency scope unavailable.';end if;
 with selected as(select distinct conversion_lot_id from public.active_dimensioned_invoice_allocations where user_id=p_owner and settlement_kind='fx_gbp_cash' and transaction_id=any(p_nodes)),
 active as(select conversion_lot_id,count(*) active_count,sum(invoice_minor) original_minor,sum(amount_pence) cash_pence from public.active_dimensioned_invoice_allocations where user_id=p_owner and settlement_kind='fx_gbp_cash' group by conversion_lot_id),
 history as(select conversion_lot_id,count(*) version from public.invoice_settlements where user_id=p_owner and conversion_lot_id is not null group by conversion_lot_id)
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'user_id',l.user_id,'invoice_id',l.invoice_id,'invoice_revision_id',l.invoice_revision_id,'receipt_id',l.transaction_id,
  'import_id',t.import_id,'source_row_id',t.source_row_id,'invoice_currency',l.invoice_currency,'original_minor',a.original_minor,'cash_currency','GBP','cash_pence',a.cash_pence,'active_count',a.active_count,'version',h.version) order by l.id),'[]') into result
 from selected s join public.fx_conversion_lots l on l.id=s.conversion_lot_id and l.user_id=p_owner
 join public.bank_transactions t on t.id=l.transaction_id and t.user_id=l.user_id
 join active a on a.conversion_lot_id=l.id join history h on h.conversion_lot_id=l.id;
 if jsonb_array_length(result)>10000 or octet_length(result::text)>2000000 then raise exception 'Complete FX dependencies exceed the review limit.';end if;
 return result;
end;$$;
revoke all on function public.fx_dependency_blockers(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.read_source_import_reversal_context_v2(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();context jsonb;nodes uuid[];blockers jsonb;sources jsonb;result jsonb;begin
 -- The private base may contain mixed allocation rows. Never present its native
 -- financial calculations when FX is present anywhere in the connected graph.
 context:=public.read_source_import_reversal_context_pre_fx(p_id);
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into nodes from(
  select(v->>'id')::uuid id from jsonb_array_elements(context->'transactions') v
  union select id from public.bank_transactions where user_id=owner_id and import_id=p_id
  union select(v->>'bank_transaction_id')::uuid from jsonb_array_elements(context->'effects') v where v->>'bank_transaction_id' is not null
 ) s;
 blockers:=public.fx_dependency_blockers(owner_id,nodes);
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'import_id',t.import_id,'source_row_id',t.source_row_id,'transaction_date',t.transaction_date) order by t.id),'[]') into sources
 from public.bank_transactions t where t.user_id=owner_id and t.id=any(nodes);
 if jsonb_array_length(sources)<>cardinality(nodes) then raise exception 'Complete affected sources unavailable.';end if;
 result:=jsonb_build_object('schema_version','source-import-reversal-context/2','owner_id',owner_id,'import_id',p_id,'import_status',context->'import_status','financial_stamp',context->'financial_stamp',
  'blocked',jsonb_array_length(blockers)>0,'counts',jsonb_build_object('sources',cardinality(nodes),'fx_blockers',jsonb_array_length(blockers)),
  'sources',sources,'fx_blockers',blockers,'native_context',case when jsonb_array_length(blockers)=0 then context else null end);
 if octet_length(result::text)>2000000 then raise exception 'Complete import review exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.read_source_import_reversal_context_v2(uuid) from public,anon,service_role;
grant execute on function public.read_source_import_reversal_context_v2(uuid) to authenticated;
