-- Read-only V3 review envelopes. Historical readers/writers and admission remain unchanged.
create function public.bank_observation_has_native_source(p_owner uuid,p_id uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.bank_transactions t
 join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
 join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id and i.account_id=t.account_id
 join public.source_rows r on r.id=t.source_row_id and r.user_id=t.user_id and r.import_id=t.import_id
 join public.record_source_files f on f.id=i.source_file_id and f.user_id=t.user_id and f.account_id=t.account_id and f.file_hash=i.file_hash
 where t.user_id=p_owner and t.id=p_id and a.currency=t.currency and a.account_type in('bank','credit_card')
 and public.bank_observation_is_native(p_owner,t.id));
$$;
revoke all on function public.bank_observation_has_native_source(uuid,uuid) from public,anon,authenticated,service_role;

create function public.native_bank_source_context(p_owner uuid,p_ids uuid[]) returns jsonb
language plpgsql stable set search_path='' as $$
declare sources jsonb;payload jsonb;result jsonb;
begin
 if p_owner is null or p_owner is distinct from auth.uid() or p_ids is null or cardinality(p_ids)>20000
 or array_position(p_ids,null) is not null or cardinality(p_ids)<>(select count(distinct n) from unnest(p_ids) n)
 then raise exception 'Complete distinct owned source scope required.';end if;
 with rows as (
 select t.id,t.user_id,t.account_id,t.import_id,t.source_row_id,t.transaction_date cash_date,t.currency,
 t.signed_amount_pence::text signed_amount_pence,t.original_signed_minor::text original_signed_minor,t.source_units_ruleset ruleset_id,
 a.currency account_currency,a.account_type,t.classification,t.decision_version,t.dedupe_status,i.status import_status,
 i.file_hash file_sha256,r.row_hash row_sha256,i.parser_version,
 (a.id is not null and i.id is not null and r.id is not null and f.id is not null and i.account_id=t.account_id and r.import_id=t.import_id
 and f.account_id=t.account_id and f.file_hash=i.file_hash and a.currency=t.currency) source_complete,
 exists(select 1 from storage.objects o where o.bucket_id='source-evidence' and o.name=f.object_path) source_available,
 public.bank_observation_has_native_source(p_owner,t.id) native_eligible
 from public.bank_transactions t
 left join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
 left join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
 left join public.source_rows r on r.id=t.source_row_id and r.user_id=t.user_id
 left join public.record_source_files f on f.id=i.source_file_id and f.user_id=t.user_id
 where t.user_id=p_owner and t.id=any(p_ids)
 )select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into sources from rows s;
 if jsonb_array_length(sources)<>cardinality(p_ids) then raise exception 'Complete owned source endpoints unavailable.';end if;
 payload:=jsonb_build_object('schema_version','native-bank-source-context/1','owner_id',p_owner,'financial_stamp',public.reconciliation_export_stamp(),
 'blocked',exists(select 1 from jsonb_array_elements(sources) s where not(s->>'native_eligible')::boolean),
 'counts',jsonb_build_object('sources',cardinality(p_ids),'native_sources',(select count(*) from jsonb_array_elements(sources) s where(s->>'native_eligible')::boolean),
 'native_blockers',(select count(*) from jsonb_array_elements(sources) s where not(s->>'native_eligible')::boolean),
 'unavailable_sources',(select count(*) from jsonb_array_elements(sources) s where not(s->>'source_available')::boolean)), 'sources',sources);
 result:=payload||jsonb_build_object('source_stamp',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 if octet_length(result::text)>2000000 then raise exception 'Complete source scope exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.native_bank_source_context(uuid,uuid[]) from public,anon,authenticated,service_role;

-- Raw graph discovery precedes joins/native projections; missing endpoints survive to parity checks.
create function public.native_bank_graph_nodes(p_owner uuid,p_kind text,p_id uuid,p_transfers boolean,p_effects boolean) returns uuid[]
language plpgsql stable set search_path='' as $$
declare nodes uuid[];
begin
 if p_owner is null or p_owner is distinct from auth.uid() or p_id is null or p_kind is null or p_kind not in('original','refund','import')
 or p_transfers is null or p_effects is null then raise exception 'Choose an owned source graph.';end if;
 if p_kind='import' then
 if not exists(select 1 from public.record_imports where id=p_id and user_id=p_owner) then raise exception 'Owned source graph unavailable.';end if;
 elsif not exists(select 1 from public.bank_transactions where id=p_id and user_id=p_owner) then raise exception 'Owned source graph unavailable.';end if;
 with recursive edges as materialized(
 select original_transaction_id a,refund_transaction_id b from public.active_refunds where user_id=p_owner
 union select outgoing_transaction_id,incoming_transaction_id from public.active_transfer_pairs where user_id=p_owner and p_transfers
 ),component(id) as (
 select id from public.bank_transactions where user_id=p_owner and(case when p_kind='import' then import_id=p_id else id=p_id end)
 union select bank_transaction_id from public.financial_records where p_effects and p_kind='import' and user_id=p_owner and import_id=p_id and bank_transaction_id is not null
 union select case when e.a=c.id then e.b else e.a end from component c join edges e on c.id in(e.a,e.b)
 )select coalesce(array_agg(id order by id),'{}'::uuid[]) into nodes from(select id from component limit 20001) bounded;
 if cardinality(nodes)>20000 or array_position(nodes,null) is not null then raise exception 'Complete source graph exceeds the safe review limit or has missing endpoints.';end if;
 return nodes;
end;$$;
revoke all on function public.native_bank_graph_nodes(uuid,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;

create function public.read_refund_reversal_graph_v3(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();nodes uuid[];sources jsonb;dependencies jsonb;context jsonb;result jsonb;blocked boolean;
begin
 nodes:=public.native_bank_graph_nodes(owner_id,p_kind,p_id,false,false);
 sources:=public.native_bank_source_context(owner_id,nodes);
 dependencies:=public.fx_source_dependency_context(owner_id,nodes);
 blocked:=(sources->>'blocked')::boolean or(dependencies->>'blocked')::boolean;
 if not blocked then
 context:=public.read_refund_reversal_graph(p_kind,p_id);
 if context->>'stamp' is distinct from sources->>'financial_stamp' or
 (select coalesce(array_agg((s->>'id')::uuid order by s->>'id'),'{}'::uuid[]) from jsonb_array_elements(context->'transactions') s) is distinct from nodes
 then raise exception 'Complete refund operation sources changed.';end if;
 end if;
 result:=jsonb_build_object('schema_version','refund-reversal-context/3','kind',p_kind,'id',p_id,'source_context',sources,'dependencies',dependencies,'blocked',blocked,'native_context',context);
 if octet_length(result::text)>2000000 then raise exception 'Complete refund review exceeds the safe payload limit.';end if;return result;
end;$$;
revoke all on function public.read_refund_reversal_graph_v3(text,uuid) from public,anon,service_role;
grant execute on function public.read_refund_reversal_graph_v3(text,uuid) to authenticated;

create function public.read_source_import_reversal_context_v3(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();nodes uuid[];operation_nodes uuid[];refund_nodes uuid[];sources jsonb;dependencies jsonb;context jsonb;result jsonb;state text;blocked boolean;
begin
 if owner_id is null or not exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and source_file_id is not null) then raise exception 'Owned preserved import unavailable.';end if;
 select status into state from public.record_imports where id=p_id and user_id=owner_id;
 nodes:=public.native_bank_graph_nodes(owner_id,'import',p_id,true,true);
 sources:=public.native_bank_source_context(owner_id,nodes);dependencies:=public.fx_source_dependency_context(owner_id,nodes);
 -- Preserve the existing operation projection independently of the broader eligibility fence.
 refund_nodes:=public.native_bank_graph_nodes(owner_id,'import',p_id,false,false);
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into operation_nodes from(
 select unnest(refund_nodes) id
 union select p.outgoing_transaction_id from public.active_transfer_pairs p where p.user_id=owner_id and exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.import_id=p_id and t.id in(p.outgoing_transaction_id,p.incoming_transaction_id))
 union select p.incoming_transaction_id from public.active_transfer_pairs p where p.user_id=owner_id and exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.import_id=p_id and t.id in(p.outgoing_transaction_id,p.incoming_transaction_id))
 ) expected;
 if not(operation_nodes<@nodes) or array_position(operation_nodes,null) is not null then raise exception 'Complete import operation source scope unavailable.';end if;
 blocked:=(sources->>'blocked')::boolean or(dependencies->>'blocked')::boolean;
 if not blocked then
 context:=public.read_source_import_reversal_context_pre_fx(p_id);
 if context->>'financial_stamp' is distinct from sources->>'financial_stamp' or
 (select coalesce(array_agg((s->>'id')::uuid order by s->>'id'),'{}'::uuid[]) from jsonb_array_elements(context->'transactions') s) is distinct from operation_nodes
 then raise exception 'Complete import operation sources changed.';end if;
 end if;
 result:=jsonb_build_object('schema_version','source-import-reversal-context/3','owner_id',owner_id,'import_id',p_id,'import_status',state,
 'source_context',sources,'dependencies',dependencies,'operation_source_ids',to_jsonb(operation_nodes),'blocked',blocked,'native_context',context);
 if octet_length(result::text)>2000000 then raise exception 'Complete import review exceeds the safe payload limit.';end if;return result;
end;$$;
revoke all on function public.read_source_import_reversal_context_v3(uuid) from public,anon,service_role;
grant execute on function public.read_source_import_reversal_context_v3(uuid) to authenticated;

-- Copy the native projection privately and restrict its CTE BEFORE native arithmetic.
-- Do not change the retained V1/V2 catalog or any writer that depends on its shape.
do $$declare definition text;needle text;changed text;begin
 select pg_get_functiondef('public.read_refund_split_catalog(uuid)'::regprocedure) into definition;
 changed:=replace(definition,'FUNCTION public.read_refund_split_catalog(p_refund uuid)','FUNCTION public.read_refund_split_catalog_native(p_refund uuid, p_nodes uuid[])');
 if changed=definition then raise exception 'Inspect native split projection declaration.';end if;
 needle:='t.user_id=owner_id and (t.id=p_refund or';
 if(length(changed)-length(replace(changed,needle,'')))/length(needle)<>2 then raise exception 'Inspect native split scope before extending.';end if;
 changed:=replace(changed,needle,'t.user_id=owner_id and t.id=any(p_nodes) and (t.id=p_refund or');execute changed;
end;$$;
revoke all on function public.read_refund_split_catalog_native(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.read_refund_split_catalog_v3(p_refund uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();cash bigint;nodes uuid[];native_nodes uuid[];sources jsonb;dependencies jsonb;context jsonb;result jsonb;blocked boolean;selected_native boolean;
begin
 if owner_id is null or p_refund is null then raise exception 'Choose owned refund cash.';end if;
 select signed_amount_pence into cash from public.bank_transactions where user_id=owner_id and id=p_refund;
 if not found then raise exception 'Owned refund source unavailable.';end if;
 selected_native:=public.bank_observation_has_native_source(owner_id,p_refund);
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into nodes from(select t.id from public.bank_transactions t
 where t.user_id=owner_id and(t.id=p_refund or not public.bank_observation_has_native_source(owner_id,t.id) or(t.signed_amount_pence>0)<>(cash>0)) limit 10001) bounded;
 if cardinality(nodes)>10000 then raise exception 'Complete split source inventory exceeds the safe review limit.';end if;
 sources:=public.native_bank_source_context(owner_id,nodes);dependencies:=public.fx_source_dependency_context(owner_id,nodes);
 blocked:=not selected_native or exists(select 1 from jsonb_array_elements(dependencies->'fx_blockers') b where b->>'receipt_id'=p_refund::text);
 if not blocked then
 select coalesce(array_agg((s->>'id')::uuid order by s->>'id'),'{}'::uuid[]) into native_nodes from jsonb_array_elements(sources->'sources') s where(s->>'native_eligible')::boolean;
 context:=public.read_refund_split_catalog_native(p_refund,native_nodes);
 if context->>'stamp' is distinct from sources->>'financial_stamp' or
 (select coalesce(array_agg((s->>'id')::uuid order by s->>'id'),'{}'::uuid[]) from jsonb_array_elements(context->'transactions') s) is distinct from native_nodes
 then raise exception 'Complete native split choices changed.';end if;
 end if;
 result:=jsonb_build_object('schema_version','refund-split-catalog/3','refund_id',p_refund,'source_context',sources,'dependencies',dependencies,'selected_native_eligible',selected_native,'blocked',blocked,'native_context',context);
 if octet_length(result::text)>2000000 then raise exception 'Complete split review exceeds the safe payload limit.';end if;return result;
end;$$;
revoke all on function public.read_refund_split_catalog_v3(uuid) from public,anon,service_role;
grant execute on function public.read_refund_split_catalog_v3(uuid) to authenticated;

create function public.read_refund_assignment_context_v2(p_allocation uuid,p_refund uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();receipt uuid;original uuid;cash uuid;nodes uuid[];sources jsonb;dependencies jsonb;result jsonb;
begin
 if owner_id is null or p_allocation is null or p_refund is null then raise exception 'Choose owned native allocation and refund.';end if;
 select transaction_id into receipt from public.active_dimensioned_invoice_allocations where user_id=owner_id and id=p_allocation and settlement_kind='native_gbp';
 if not found then raise exception 'Owned native allocation unavailable.';end if;
 select original_transaction_id,refund_transaction_id into original,cash from public.active_refunds where user_id=owner_id and id=p_refund;
 if not found or original is distinct from receipt or original=cash then raise exception 'Owned matching refund unavailable.';end if;
 select array_agg(distinct n order by n) into nodes from unnest(array[receipt,original,cash]) n;
 sources:=public.native_bank_source_context(owner_id,nodes);dependencies:=public.fx_source_dependency_context(owner_id,nodes);
 result:=jsonb_build_object('schema_version','refund-assignment-context/2','allocation_id',p_allocation,'refund_id',p_refund,'source_context',sources,'dependencies',dependencies,
 'blocked',(sources->>'blocked')::boolean or(dependencies->>'blocked')::boolean);
 if octet_length(result::text)>2000000 then raise exception 'Complete assignment review exceeds the safe payload limit.';end if;return result;
end;$$;
revoke all on function public.read_refund_assignment_context_v2(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_refund_assignment_context_v2(uuid,uuid) to authenticated;
