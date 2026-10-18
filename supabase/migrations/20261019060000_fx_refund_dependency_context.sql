-- Read-only dependency preparation. Existing writers, request fingerprints,
-- grants and native reader identities remain unchanged.
create function public.fx_source_dependency_context(p_owner uuid,p_nodes uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare sources jsonb;blockers jsonb;result jsonb;
begin
 if p_owner is null or p_owner is distinct from auth.uid() or p_nodes is null or cardinality(p_nodes)>20000
  or exists(select 1 from unnest(p_nodes) n where n is null)
  or (select count(distinct n) from unnest(p_nodes) n)<>cardinality(p_nodes)
 then raise exception 'Complete distinct owned dependency scope required.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'import_id',t.import_id,'source_row_id',t.source_row_id,'transaction_date',t.transaction_date) order by t.id),'[]') into sources
 from public.bank_transactions t where t.user_id=p_owner and t.id=any(p_nodes);
 if jsonb_array_length(sources)<>cardinality(p_nodes) then raise exception 'Complete owned dependency sources unavailable.';end if;
 blockers:=public.fx_dependency_blockers(p_owner,p_nodes);
 result:=jsonb_build_object('schema_version','fx-source-dependencies/1','owner_id',p_owner,'financial_stamp',public.reconciliation_export_stamp(),
  'blocked',jsonb_array_length(blockers)>0,'counts',jsonb_build_object('sources',cardinality(p_nodes),'fx_blockers',jsonb_array_length(blockers)),
  'sources',sources,'fx_blockers',blockers);
 if octet_length(result::text)>2000000 then raise exception 'Complete dependency review exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.fx_source_dependency_context(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.read_fx_source_dependencies(p_nodes uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_nodes is null or cardinality(p_nodes)<1 or cardinality(p_nodes)>101 then raise exception 'Choose one to 101 owned refund endpoints.';end if;
 return public.fx_source_dependency_context(auth.uid(),p_nodes);
end;$$;
revoke all on function public.read_fx_source_dependencies(uuid[]) from public,anon,service_role;
grant execute on function public.read_fx_source_dependencies(uuid[]) to authenticated;

create function public.read_refund_split_catalog_v2(p_refund uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;nodes uuid[];dependencies jsonb;result jsonb;
begin
 context:=public.read_refund_split_catalog(p_refund);
 select array_agg((v->>'id')::uuid order by v->>'id') into nodes from jsonb_array_elements(context->'transactions') v;
 dependencies:=public.fx_source_dependency_context(auth.uid(),nodes);
 if dependencies->>'financial_stamp' is distinct from context->>'stamp' then raise exception 'Refund catalog dependency snapshot changed.';end if;
 result:=jsonb_build_object('schema_version','refund-split-catalog/2','refund_id',p_refund,'dependencies',dependencies,'native_context',context);
 if octet_length(result::text)>2000000 then raise exception 'Complete refund catalog exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.read_refund_split_catalog_v2(uuid) from public,anon,service_role;
grant execute on function public.read_refund_split_catalog_v2(uuid) to authenticated;

create function public.read_refund_reversal_graph_v2(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;nodes uuid[];dependencies jsonb;result jsonb;
begin
 context:=public.read_refund_reversal_graph(p_kind,p_id);
 select coalesce(array_agg((v->>'id')::uuid order by v->>'id'),'{}'::uuid[]) into nodes from jsonb_array_elements(context->'transactions') v;
 dependencies:=public.fx_source_dependency_context(auth.uid(),nodes);
 if dependencies->>'financial_stamp' is distinct from context->>'stamp' then raise exception 'Refund reversal dependency snapshot changed.';end if;
 result:=jsonb_build_object('schema_version','refund-reversal-context/2','kind',p_kind,'id',p_id,'dependencies',dependencies,
  'native_context',case when (dependencies->>'blocked')::boolean then null else context end);
 if octet_length(result::text)>2000000 then raise exception 'Complete refund reversal exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.read_refund_reversal_graph_v2(text,uuid) from public,anon,service_role;
grant execute on function public.read_refund_reversal_graph_v2(text,uuid) to authenticated;

create function public.read_refund_assignment_fx_context(p_allocation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();receipt uuid;result jsonb;
begin
 if owner_id is null or p_allocation is null then raise exception 'Choose an owned active native receipt allocation.';end if;
 select transaction_id into receipt from public.active_dimensioned_invoice_allocations
 where id=p_allocation and user_id=owner_id and settlement_kind='native_gbp';
 if not found then raise exception 'Owned active native receipt allocation unavailable.';end if;
 result:=jsonb_build_object('schema_version','refund-assignment-context/1','allocation_id',p_allocation,
  'dependencies',public.fx_source_dependency_context(owner_id,array[receipt]));
 if octet_length(result::text)>2000000 then raise exception 'Complete assignment dependencies exceed the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.read_refund_assignment_fx_context(uuid) from public,anon,service_role;
grant execute on function public.read_refund_assignment_fx_context(uuid) to authenticated;
