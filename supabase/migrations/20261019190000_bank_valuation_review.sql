-- Human review access to the existing private valuation writer. No financial posting.
create function public.read_bank_valuation_review(p_transaction uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();t public.bank_transactions;head public.bank_valuation_revisions;
 source jsonb;documents jsonb;result jsonb;stamp text;can_change boolean:=true;
begin
 if owner_id is null then raise exception 'Sign in to review a bank valuation.';end if;
 select * into t from public.bank_transactions where id=p_transaction and user_id=owner_id;
 if not found or t.currency not in('USD','EUR','JPY','KWD') or t.signed_amount_pence is not null then raise exception 'Choose an owned foreign observation.';end if;
 if (select count(*) from public.evidence_documents where user_id=owner_id)>1000
 or (select count(*) from public.bank_transactions where user_id=owner_id)>20000
 then raise exception 'Valuation review exceeds current bounded capacity.';end if;
 stamp:=public.bank_valuation_review_stamp(owner_id);
 select r.* into head from public.bank_valuation_revisions r join public.bank_valuation_families f on f.id=r.family_id and f.user_id=r.user_id
 where f.user_id=owner_id and f.transaction_id=t.id order by r.ordinal desc limit 1;
 begin source:=public.bank_valuation_economic_source(owner_id,t.id);exception when others then source:=null;end;
 begin perform public.bank_valuation_assert_unencumbered(owner_id,t.id);exception when others then can_change:=false;end;
 select coalesce(jsonb_agg(s.source order by s.id),'[]'::jsonb) into documents from (
  select d.id,public.fx_document_source(owner_id,d.id,false) source from public.evidence_documents d where d.user_id=owner_id
 ) s where s.source is not null;
 result:=jsonb_build_object('schema_version','bank-valuation-review/1','owner_id',owner_id,'stamp',stamp,
 'transaction',jsonb_build_object('id',t.id,'decision_version',t.decision_version,'currency',t.currency,'original_signed_minor',t.original_signed_minor),
 'source',source,'head',case when head.id is null then null else to_jsonb(head) end,
 'head_current',case when head.id is null then false else public.bank_valuation_source_current(owner_id,head.id) end,
 'can_change',can_change,'documents',documents);
 if stamp is distinct from public.bank_valuation_review_stamp(owner_id) or octet_length(result::text)>2000000 then raise exception 'Complete stable valuation review unavailable.';end if;
 return result;
end;$$;
revoke all on function public.read_bank_valuation_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_bank_valuation_review(uuid) to authenticated;

create function public.review_bank_valuation(p_intent jsonb,p_original_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();i jsonb;prior public.bank_valuation_requests;document_hash text;
begin
 if owner_id is null then raise exception 'Sign in to review a bank valuation.';end if;
 i:=public.validate_bank_valuation_intent(p_intent);
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.bank_valuation_requests where user_id=owner_id and request_id=(i->>'request_id')::uuid;
 if found then
  if prior.intent is distinct from i then raise exception 'Bank valuation request changed.';end if;
  return prior.result;
 end if;
 if i->>'state'='reviewed' then
  select file_hash into document_hash from public.evidence_documents where id=(i->>'document_id')::uuid and user_id=owner_id;
  if document_hash is null or p_original_sha256 is distinct from document_hash then raise exception 'Review the matching local original document.';end if;
 elsif p_original_sha256 is distinct from '' then raise exception 'Original identity check applies to reviewed valuation only.';end if;
 return public.record_bank_valuation(owner_id,i);
end;$$;
revoke all on function public.review_bank_valuation(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.review_bank_valuation(jsonb,text) to authenticated;
