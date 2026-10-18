-- Foreign reversal retains canonical excluded records through the classification writer.
create function public.read_foreign_import_reversal(p_import uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();imp public.record_imports;account public.financial_accounts;rows jsonb;result jsonb;before_stamp text;blocked boolean;
begin
 if owner_id is null then raise exception 'Sign in to review import reversal.';end if;
 select * into imp from public.record_imports where id=p_import and user_id=owner_id;
 select * into account from public.financial_accounts where id=imp.account_id and user_id=owner_id;
 if imp.id is null or account.id is null or imp.source_file_id is null then raise exception 'Owned preserved import unavailable.';end if;
 if account.currency='GBP' then return null;end if;
 if account.currency not in('USD','EUR','JPY','KWD') or imp.parser_version<>'mapped-csv/2' then raise exception 'Supported foreign import required.';end if;
 before_stamp:=public.foreign_classification_review_stamp(owner_id);
 if(select count(*) from public.bank_transactions where import_id=p_import and user_id=owner_id)>20000 then raise exception 'Complete reversal exceeds capacity.';end if;
 if exists(select 1 from public.bank_transactions t left join public.source_rows r on r.id=t.source_row_id and r.user_id=t.user_id and r.import_id=t.import_id
  where t.import_id=p_import and t.user_id=owner_id and(r.id is null or t.account_id<>account.id or t.currency<>account.currency or t.signed_amount_pence is not null or t.original_signed_minor is null or t.original_signed_minor=0 or t.source_units_ruleset<>'vibecount-currencies/1'))
 then raise exception 'Complete foreign source closure unavailable.';end if;
 -- Inspect every retained effect, not merely the canonical pointer or approved subset.
 if exists(select 1 from public.financial_records f left join public.bank_transactions t on t.id=f.bank_transaction_id and t.user_id=f.user_id
  where f.user_id=owner_id and(f.import_id=p_import or t.import_id=p_import)
  and(t.id is null or t.import_id<>p_import or f.import_id is distinct from p_import or t.recognized_record_id is distinct from f.id or f.effect_sign<>1 or f.refund_link_id is not null or f.invoice_id is not null
   or f.record_date<>t.transaction_date or f.record_type<>(case when t.original_signed_minor>0 then 'income' else 'expense' end) or f.status not in('approved','excluded')))
 then raise exception 'Complete canonical foreign effects unavailable.';end if;
 if exists(select 1 from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
  left join public.classification_decisions d on d.transaction_id=t.id and d.user_id=t.user_id and d.version=t.decision_version
  left join public.foreign_classification_requests q on q.request_id=d.foreign_request_id and q.user_id=d.user_id
  where t.user_id=owner_id and t.import_id=p_import and((t.recognized_record_id is not null and f.id is null)
   or(t.decision_version>0 and(q.request_id is null or(t.classification,t.business_use_bps,t.category_id,t.recognized_record_id) is distinct from(d.classification,d.business_use_bps,d.category_id,(q.result->>'record_id')::uuid)))
   or(f.status='approved' and(d.recognized_pence is null or f.amount*100<>d.recognized_pence or f.category_id is distinct from d.category_id))
   or(f.status='excluded' and d.recognized_pence is distinct from 0))) then raise exception 'Foreign decision ancestry is inconsistent.';end if;
 blocked:=imp.status not in('review','committed') or exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.import_id=p_import and(
  t.active_transfer_id is not null or t.active_refund_id is not null
  or exists(select 1 from public.active_dimensioned_invoice_allocations a where a.user_id=owner_id and a.transaction_id=t.id)
  or exists(select 1 from public.active_transfer_pairs a where a.user_id=owner_id and t.id in(a.outgoing_transaction_id,a.incoming_transaction_id))
  or exists(select 1 from public.active_refunds a where a.user_id=owner_id and t.id in(a.original_transaction_id,a.refund_transaction_id))
  or exists(select 1 from public.active_duplicate_decisions a where a.user_id=owner_id and t.id in(a.transaction_id,a.retained_transaction_id))));
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'source_row_id',t.source_row_id,'date',t.transaction_date,'currency',t.currency,'original_signed_minor',t.original_signed_minor,
  'decision_version',t.decision_version,'classification',t.classification,'record_id',t.recognized_record_id,'record_type',case when t.original_signed_minor>0 then 'income' else 'expense' end,
  'approved_pence',case when f.status='approved' then(f.amount*100)::bigint else 0 end,'valuation_revision_id',d.bank_valuation_revision_id,'classification_request_id',d.foreign_request_id) order by t.id),'[]'::jsonb) into rows
 from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
 left join public.classification_decisions d on d.transaction_id=t.id and d.user_id=t.user_id and d.version=t.decision_version
 where t.user_id=owner_id and t.import_id=p_import;
 result:=jsonb_build_object('schema_version','foreign-import-reversal/1','owner_id',owner_id,'import_id',p_import,'import_status',imp.status,'currency',account.currency,'blocked',blocked,'sources',rows);
 -- All displayed effects and ancestry are in the digest; classification/source changes are also covered.
 result:=result||jsonb_build_object('stamp',md5(jsonb_build_array(result,before_stamp)::text));
 if before_stamp is distinct from public.foreign_classification_review_stamp(owner_id) or octet_length(result::text)>2200000 then raise exception 'Stable complete reversal unavailable.';end if;
 return result;
end;$$;
revoke all on function public.read_foreign_import_reversal(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_foreign_import_reversal(uuid) to authenticated;

create function public.reverse_foreign_import_reviewed(p_import uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();prior public.source_import_reversal_requests;payload text;context jsonb;s jsonb;child jsonb;children jsonb:='[]';result jsonb;income bigint:=0;expense bigint:=0;child_request uuid;
begin
 if owner_id is null or p_import is null or p_request is null or p_stamp is null or p_stamp!~'^[a-f0-9]{32}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the complete import reversal and reason.';end if;
 payload:=encode(sha256(convert_to(jsonb_build_object('action','reverse_foreign_import/1','import',p_import,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.source_import_reversal_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash is distinct from payload then raise exception 'Import reversal request changed.';end if;return prior.result;end if;
 perform public.freeze_bank_valuation_inputs();
 lock table public.classification_decisions,public.foreign_classification_requests,public.record_categories,public.duplicate_decisions,public.duplicate_reversals,public.source_import_reversal_requests in share mode nowait;
 context:=public.read_foreign_import_reversal(p_import);
 if context is null or context->>'stamp' is distinct from p_stamp or context->'blocked' is distinct from 'false'::jsonb then raise exception 'Import reversal review changed or has dependent relationships.';end if;
 for s in select value from jsonb_array_elements(context->'sources') loop
  if s->>'record_type'='income' then income:=income+(s->>'approved_pence')::bigint;else expense:=expense+(s->>'approved_pence')::bigint;end if;
  child_request:=gen_random_uuid();
  child:=public.review_foreign_classification(jsonb_build_object('schema_version','foreign-classification-intent/1','transaction_id',s->'id','transaction_version',s->'decision_version',
   'valuation_revision_id',null,'classification','Unknown','category_id',null,'business_use_bps',0,'rounding_policy','gbp_business_share_half_up/1','treatment_reviewed',false,
   'expected_stamp',public.foreign_classification_review_stamp(owner_id),'rationale',btrim(p_reason),'request_id',child_request,'human_confirmed',true));
  children:=children||jsonb_build_array(jsonb_build_object('transaction_id',s->'id','request_id',child_request,'result',child));
 end loop;
 update public.record_imports set status='discarded',committed_at=null where id=p_import and user_id=owner_id;
 insert into public.source_import_events(user_id,import_id,event,reason,author) values(owner_id,p_import,'reversed',btrim(p_reason),owner_id);
 result:=jsonb_build_object('schema_version','foreign-import-reversal-result/1','import_id',p_import,'reviewed_stamp',p_stamp,'income_delta_pence',-income,'expense_delta_pence',-expense,'profit_delta_pence',expense-income,'children',children);
 insert into public.source_import_reversal_requests(user_id,request_id,import_id,payload_hash,result) values(owner_id,p_request,p_import,payload,result);
 return result;
end;$$;
revoke all on function public.reverse_foreign_import_reviewed(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reverse_foreign_import_reviewed(uuid,text,text,uuid) to authenticated;
