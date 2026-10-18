create function public.foreign_classification_review_stamp(p_owner uuid) returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_array('foreign-classification-review/1',public.bank_valuation_review_stamp(p_owner),
  (select jsonb_agg(jsonb_build_array(id,name,record_type,user_id,is_default) order by id) from public.record_categories where user_id=p_owner or(user_id is null and is_default)))::text);
$$;
revoke all on function public.foreign_classification_review_stamp(uuid) from public,anon,authenticated,service_role;
-- Completed requests retain their original fingerprint and recover before this freshness check.
do $$declare definition text;changed text;begin
 select pg_get_functiondef('public.review_foreign_classification(jsonb)'::regprocedure) into definition;
 changed:=replace(definition,'public.bank_valuation_review_stamp(owner_id)','public.foreign_classification_review_stamp(owner_id)');
 if changed=definition then raise exception 'Expected foreign classification freshness check missing.';end if;execute changed;
end;$$;

create function public.read_foreign_classification_review(p_transaction uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();t public.bank_transactions;f public.financial_records;context jsonb;categories jsonb;result jsonb;stamp text;eligible boolean;import_status text;
begin
 if owner_id is null then raise exception 'Sign in to review foreign classification.';end if;
 stamp:=public.foreign_classification_review_stamp(owner_id);context:=public.read_bank_valuation_review(p_transaction);
 select * into t from public.bank_transactions where id=p_transaction and user_id=owner_id;
 select status into import_status from public.record_imports where id=t.import_id and user_id=owner_id;
 select * into f from public.financial_records where id=t.recognized_record_id and user_id=owner_id;
 if(t.recognized_record_id is not null and(f.id is null or f.bank_transaction_id is distinct from t.id or f.effect_sign<>1 or f.refund_link_id is not null))
 or exists(select 1 from public.financial_records where user_id=owner_id and bank_transaction_id=t.id and status='approved' and id is distinct from t.recognized_record_id)
 then raise exception 'Current foreign posting identity is inconsistent.';end if;
 if(select count(*) from public.record_categories where user_id=owner_id or(user_id is null and is_default))>1000 then raise exception 'Complete category review exceeds capacity.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',public.tax_pack_safe_text(name),'record_type',record_type) order by id),'[]'::jsonb) into categories
 from public.record_categories where user_id=owner_id or(user_id is null and is_default);
 eligible:=import_status in('review','committed') and t.active_transfer_id is null and t.active_refund_id is null
 and not exists(select 1 from public.active_invoice_allocations where user_id=owner_id and transaction_id=t.id)
 and not exists(select 1 from public.transfer_pairs p where p.user_id=owner_id and t.id in(p.outgoing_transaction_id,p.incoming_transaction_id) and not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=owner_id))
 and not exists(select 1 from public.refund_links l where l.user_id=owner_id and t.id in(l.original_transaction_id,l.refund_transaction_id) and not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=owner_id));
 result:=jsonb_build_object('schema_version','foreign-classification-review/1','stamp',stamp,'valuation',context,'can_classify',coalesce(eligible,false),
 'current',jsonb_build_object('classification',t.classification,'business_use_bps',t.business_use_bps,'category_id',t.category_id,'record_id',t.recognized_record_id,
 'recognized_pence',case when f.status='approved' then (f.amount*100)::bigint else 0 end), 'categories',categories);
 if stamp is distinct from public.foreign_classification_review_stamp(owner_id) or octet_length(result::text)>2200000 then raise exception 'Stable classification review unavailable.';end if;
 return result;
end;$$;
revoke all on function public.read_foreign_classification_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_foreign_classification_review(uuid) to authenticated;

create function public.confirm_foreign_classification(p_intent jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to review foreign classification.';end if;
 return public.review_foreign_classification(p_intent);
end;$$;
revoke all on function public.confirm_foreign_classification(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirm_foreign_classification(jsonb) to authenticated;
