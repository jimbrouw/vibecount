-- Version the current filing contract; retained V5 packs remain verifiable.
alter function public.tax_filing_pack_input_for_owner(uuid,uuid) rename to tax_filing_pack_input_v5_for_owner;
revoke all on function public.tax_filing_pack_input_v5_for_owner(uuid,uuid) from public,anon,authenticated,service_role;
create function public.tax_filing_pack_input_for_owner(p_owner uuid,p_calculation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;documents jsonb;begin
 result:=public.tax_filing_pack_input_v5_for_owner(p_owner,p_calculation);
 select coalesce(jsonb_agg(d||jsonb_build_object('source_available',public.evidence_original_available(p_owner,'document',(d->>'id')::uuid)) order by n),'[]'::jsonb)
 into documents from jsonb_array_elements(result->'documents') with ordinality entries(d,n);
 result:=result||jsonb_build_object('schema_version','filing-pack-input/6','documents',documents);
 if octet_length(result::text)>4000000 then raise exception 'Complete filing input exceeds direct review capacity.';end if;
 return result;
end $$;
revoke all on function public.tax_filing_pack_input_for_owner(uuid,uuid) from public,anon,authenticated,service_role;

do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.capture_filing_pack(uuid,uuid,text,text,text,uuid)'::regprocedure) into definition;
 if position('filing-pack-input/5' in definition)=0 or position('draft-filing-pack/6' in definition)=0 then raise exception 'Inspect filing capture predecessor.';end if;
 definition:=replace(replace(definition,'filing-pack-input/5','filing-pack-input/6'),'draft-filing-pack/6','draft-filing-pack/7');
 needle:='for review in select * from jsonb_array_elements(output->''reviews'') loop';
 if position(needle in definition)=0 then raise exception 'Inspect filing completeness guard position.';end if;
 definition:=replace(definition,needle,$guard$
 if exists(select 1 from jsonb_array_elements(input_data->'documents') d where d->>'source_available' is distinct from 'true')
 and (output->>'review_status'='draft_reviewed' or output->>'completeness_attested'='true') then
  raise exception 'Unavailable original documents prevent completeness attestation.';
 end if;
 $guard$||needle);
 execute definition;
end $$;
