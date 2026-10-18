-- Complete native source scope at event-only boundaries. Foreign admission stays closed.
-- No financial history, request payload or reporting serializer is rewritten.
create function public.assert_native_duplicate_scope(p_owner uuid,p_subject uuid,p_retained uuid) returns void
language plpgsql set search_path='' as $$
declare source public.bank_transactions;nodes uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into source from public.bank_transactions where id=p_subject and user_id=p_owner;
 if not found then raise exception 'Owned duplicate source unavailable.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||source.account_id::text,0));
 select array_agg(id order by id) into nodes from (select id from (
  select id from public.bank_transactions where user_id=p_owner and account_id=source.account_id and fingerprint=source.fingerprint
  union select p_subject union select p_retained where p_retained is not null
 ) scope limit 20001) s;
 perform public.assert_native_bank_scope(p_owner,nodes);
end;$$;
revoke all on function public.assert_native_duplicate_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.assert_native_import_scope(p_owner uuid,p_import uuid) returns void
language plpgsql set search_path='' as $$
declare nodes uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 if not exists(select 1 from public.record_imports where id=p_import and user_id=p_owner and source_file_id is not null) then raise exception 'Owned preserved import unavailable.';end if;
 with recursive edges as materialized(
  select outgoing_transaction_id a,incoming_transaction_id b from public.active_transfer_pairs where user_id=p_owner
  union select original_transaction_id,refund_transaction_id from public.active_refunds where user_id=p_owner
 ),nodes(id) as (
  select id from public.bank_transactions where user_id=p_owner and import_id=p_import
  union select bank_transaction_id from public.financial_records where user_id=p_owner and import_id=p_import and bank_transaction_id is not null
  union select case when e.a=n.id then e.b else e.a end from nodes n join edges e on n.id in(e.a,e.b)
 ) select coalesce(array_agg(id order by id),'{}'::uuid[]) into nodes from (select id from nodes limit 20001) bounded;
 perform public.assert_native_bank_scope(p_owner,nodes);
end;$$;
revoke all on function public.assert_native_import_scope(uuid,uuid) from public,anon,authenticated,service_role;

-- Resolve actual owned relationships, never submitted snapshots or native-only balance views.
create function public.guard_native_bank_event() returns trigger
language plpgsql security invoker set search_path='' as $$
declare nodes uuid[];pair public.transfer_pairs;refund public.refund_links;assignment public.invoice_refund_assignments;allocation public.invoice_settlements;decision public.duplicate_decisions;
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));
 if tg_table_name='transfer_pairs' then
  nodes:=array[new.outgoing_transaction_id,new.incoming_transaction_id];
 elsif tg_table_name='transfer_reversals' then
  select * into pair from public.transfer_pairs where id=new.pair_id and user_id=new.user_id;
  if not found then raise exception 'Owned transfer parent unavailable.';end if;
  nodes:=array[pair.outgoing_transaction_id,pair.incoming_transaction_id];
 elsif tg_table_name='refund_links' then
  nodes:=array[new.original_transaction_id,new.refund_transaction_id];
 elsif tg_table_name='refund_reversals' then
  select * into refund from public.refund_links where id=new.refund_id and user_id=new.user_id;
  if not found then raise exception 'Owned refund parent unavailable.';end if;
  nodes:=array[refund.original_transaction_id,refund.refund_transaction_id];
 elsif tg_table_name in('invoice_refund_assignments','invoice_refund_assignment_reversals') then
  if tg_table_name='invoice_refund_assignments' then assignment:=new;
  else
   select * into assignment from public.invoice_refund_assignments where id=new.assignment_id and user_id=new.user_id;
   if not found then raise exception 'Owned returned-cash parent unavailable.';end if;
  end if;
  select * into allocation from public.invoice_settlements where id=assignment.allocation_id and user_id=new.user_id;
  if not found then raise exception 'Owned returned-cash allocation unavailable.';end if;
  select * into refund from public.refund_links where id=assignment.refund_id and user_id=new.user_id;
  if not found or allocation.transaction_id is distinct from refund.original_transaction_id then raise exception 'Owned returned-cash sources disagree.';end if;
  nodes:=array[allocation.transaction_id,refund.original_transaction_id,refund.refund_transaction_id];
 elsif tg_table_name='duplicate_decisions' then
  perform public.assert_native_duplicate_scope(new.user_id,new.transaction_id,new.retained_transaction_id);return new;
 elsif tg_table_name='duplicate_reversals' then
  select * into decision from public.duplicate_decisions where id=new.decision_id and user_id=new.user_id;
  if not found then raise exception 'Owned identity parent unavailable.';end if;
  perform public.assert_native_duplicate_scope(new.user_id,decision.transaction_id,decision.retained_transaction_id);return new;
 else raise exception 'Unsupported native bank event boundary.';
 end if;
 select array_agg(distinct id order by id) into nodes from unnest(nodes) id;
 perform public.assert_native_bank_scope(new.user_id,nodes);
 return new;
end;$$;
revoke all on function public.guard_native_bank_event() from public,anon,authenticated,service_role;
create trigger native_bank_event before insert on public.transfer_pairs for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.transfer_reversals for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.refund_links for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.refund_reversals for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.invoice_refund_assignments for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.invoice_refund_assignment_reversals for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.duplicate_decisions for each row execute function public.guard_native_bank_event();
create trigger native_bank_event before insert on public.duplicate_reversals for each row execute function public.guard_native_bank_event();

-- Checked body edits retain OIDs/ACLs and request-first recovery. FX settlement logic is unchanged.
do $$declare definition text;needle text;replacement text;signature text;begin
 select pg_get_functiondef('public.require_dimensioned_settlement()'::regprocedure) into definition;
 needle:='  return new;'||chr(10)||' end if;'||chr(10)||' if new.settlement_kind is distinct';
 replacement:='  perform pg_advisory_xact_lock(hashtextextended(''reconciliation:''||new.user_id::text,0)); perform public.assert_native_bank_scope(new.user_id,array[new.transaction_id]);'||chr(10)||needle;
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect native-only dimensioned settlement branch.';end if;
 execute replace(definition,needle,replacement);
 select pg_get_functiondef('public.approve_invoice_allocations_v1(uuid,integer,jsonb,text,uuid,bigint)'::regprocedure) into definition;
 needle:='if not found then raise exception ''Receipt not found.''; end if;';
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect retry-first native receipt core.';end if;
 execute replace(definition,needle,needle||' perform public.assert_native_bank_scope(owner_id,array[p_transaction]);');
 select pg_get_functiondef('public.approve_invoice_refund_assignment(uuid,uuid,uuid,bigint,text,text,uuid)'::regprocedure) into definition;
 needle:='if not found then raise exception ''Choose an active customer refund of this original receipt.''; end if;';
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect retry-first returned-cash source lookup.';end if;
 execute replace(definition,needle,needle||' perform public.assert_native_bank_scope(owner_id,array[r.original_transaction_id,r.refund_transaction_id]);');
 foreach signature in array array['public.approve_duplicate_decision(uuid,uuid,text,text,text,uuid)','public.reverse_duplicate_decision(uuid,text,text,uuid)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  needle:='perform pg_advisory_xact_lock(hashtextextended(owner_id::text||t.account_id::text,0));';
  replacement:=needle||case when signature like '%approve_duplicate%' then ' perform public.assert_native_duplicate_scope(owner_id,p_transaction,p_retained);' else ' perform public.assert_native_duplicate_scope(owner_id,d.transaction_id,d.retained_transaction_id);' end;
  if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Inspect retry-first duplicate account lock: %',signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
 select pg_get_functiondef('public.reverse_source_import(uuid,text,text)'::regprocedure) into definition;
 needle:='summary:=public.source_import_summary(p_id);';
 -- Two summary reads exist; guard only the first fresh read, following discarded recovery.
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Inspect legacy import reversal entry.';end if;
 execute overlay(definition placing 'perform public.assert_native_import_scope(owner_id,p_id); '||needle from position(needle in definition) for length(needle));
 select pg_get_functiondef('public.reverse_source_import_reviewed(uuid,text,text,uuid)'::regprocedure) into definition;
 needle:='ctx:=public.read_source_import_reversal_context(p_id);';
 if(length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Inspect reviewed import reversal entry.';end if;
 execute overlay(definition placing 'perform public.assert_native_import_scope(owner_id,p_id); '||needle from position(needle in definition) for length(needle));
end;$$;
