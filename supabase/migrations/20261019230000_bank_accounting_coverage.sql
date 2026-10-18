-- Keep source coverage V1 unchanged for native consumers and historical replay.
-- V2 adds complete foreign accounting proofs; it never asserts available GBP bank cash.
create function public.bank_accounting_coverage_for_owner(p_owner uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare source jsonb;rows jsonb;families jsonb;revisions jsonb;decisions jsonb;blocked jsonb;result jsonb;
begin
 source:=public.bank_source_coverage_for_owner(p_owner);
 if(select coalesce(sum(decision_version),0) from public.bank_transactions where user_id=p_owner and currency<>'GBP')>20000 then raise exception 'Complete accounting history exceeds coverage capacity.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'account_id',t.account_id,'import_id',t.import_id,'transaction_date',t.transaction_date,'tax_year_start',t.tax_year_start,
  'signed_amount_pence',t.signed_amount_pence,'original_signed_minor',t.original_signed_minor,'source_units_ruleset',t.source_units_ruleset,'currency',t.currency,
  'description','','reference','','classification',t.classification,'business_use_bps',t.business_use_bps,'category_id',t.category_id,'recognized_record_id',t.recognized_record_id,
  'dedupe_status',t.dedupe_status,'decision_version',t.decision_version,'active_transfer_id',t.active_transfer_id,'active_refund_id',t.active_refund_id,'active_duplicate_decision_id',t.active_duplicate_decision_id,
  'duplicate_decision',(select jsonb_build_object('id',d.id,'retained_transaction_id',d.retained_transaction_id) from public.duplicate_decisions d where d.id=t.active_duplicate_decision_id and d.user_id=p_owner),
  'source_row_id',t.source_row_id,'source_rows',jsonb_build_object('row_number',r.row_number,'row_hash',r.row_hash),
  'record_imports',jsonb_build_object('id',i.id,'user_id',i.user_id,'source_file_id',i.source_file_id,'file_hash',i.file_hash,'parser_version',i.parser_version),
  'record',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'amount',f.amount::text,'status',f.status,'record_type',f.record_type,'effect_sign',f.effect_sign,'refund_link_id',f.refund_link_id,'bank_transaction_id',f.bank_transaction_id,'record_date',f.record_date,'category_id',f.category_id,'project_id',f.project_id) order by f.id),'[]'::jsonb) from public.financial_records f where f.user_id=p_owner and f.bank_transaction_id=t.id),
  'refund_portions','[]'::jsonb) order by t.id),'[]'::jsonb) into rows
 from public.bank_transactions t left join public.source_rows r on r.id=t.source_row_id and r.user_id=t.user_id left join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
 where t.user_id=p_owner and t.currency<>'GBP';
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'user_id',f.user_id,'transaction_id',f.transaction_id) order by f.id),'[]'::jsonb) into families
 from public.bank_valuation_families f where f.user_id=p_owner;
 if(select count(*) from public.bank_valuation_revisions where user_id=p_owner)>20000 then raise exception 'Complete valuation history exceeds coverage capacity.';end if;
 select coalesce(jsonb_agg(to_jsonb(v)-'fingerprint' order by v.id),'[]'::jsonb) into revisions from public.bank_valuation_revisions v where v.user_id=p_owner;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'user_id',d.user_id,'transaction_id',d.transaction_id,'import_id',d.import_id,'version',d.version,'classification',d.classification,
  'business_use_bps',d.business_use_bps,'category_id',d.category_id,'rationale',d.rationale,'recognized_pence',d.recognized_pence,'author',d.author,'evidence_status',d.evidence_status,
  'bank_valuation_revision_id',d.bank_valuation_revision_id,'foreign_request_id',d.foreign_request_id,'created_at',d.created_at,
  'request',(select jsonb_build_object('user_id',q.user_id,'request_id',q.request_id,'transaction_id',q.transaction_id,'version',q.version,'intent',q.intent,'result',q.result,'created_at',q.created_at)
   from public.foreign_classification_requests q where q.user_id=p_owner and q.request_id=d.foreign_request_id)) order by d.id),'[]'::jsonb) into decisions
 from public.classification_decisions d join public.bank_transactions t on t.id=d.transaction_id and t.user_id=d.user_id where d.user_id=p_owner and t.currency<>'GBP';
 select coalesce(jsonb_agg(t.id order by t.id),'[]'::jsonb) into blocked from public.bank_transactions t where t.user_id=p_owner and t.currency<>'GBP' and(
  t.active_refund_id is not null or t.active_transfer_id is not null
  or exists(select 1 from public.active_dimensioned_invoice_allocations a where a.user_id=p_owner and a.transaction_id=t.id)
  or exists(select 1 from public.active_transfer_pairs a where a.user_id=p_owner and t.id in(a.outgoing_transaction_id,a.incoming_transaction_id))
  or exists(select 1 from public.active_refunds a where a.user_id=p_owner and t.id in(a.original_transaction_id,a.refund_transaction_id)));
 result:=jsonb_build_object('schema_version','vibecount.bank-source-coverage/2','source_coverage',source,'foreign_rows',rows,'valuation_families',families,'valuation_revisions',revisions,'classification_decisions',decisions,'blocked_transaction_ids',blocked);
 if octet_length(result::text)>4000000 then raise exception 'Complete accounting coverage exceeds review capacity.';end if;
 return result;
end;$$;
revoke all on function public.bank_accounting_coverage_for_owner(uuid) from public,anon,authenticated,service_role;
create function public.read_bank_accounting_coverage() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Sign in to review accounting coverage.';end if;return public.bank_accounting_coverage_for_owner(auth.uid());end;$$;
revoke all on function public.read_bank_accounting_coverage() from public,anon,authenticated,service_role;
grant execute on function public.read_bank_accounting_coverage() to authenticated;
