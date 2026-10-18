-- Close the concurrent document-registration window after source capture.
-- Preserve intent/fingerprint/result bytes and exact recovery before live checks.
create or replace function public.review_fx_document_evidence(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<fx_review>>
declare owner_id uuid:=auth.uid();family_id uuid;request_id uuid;doc_id uuid;parent_id uuid;tx_id uuid;tx_version integer;expected integer;
 fact_kind text;fact_state text;reason text;reviewed_stamp text;attested boolean;data jsonb;payload text;prior public.fx_document_fact_requests;
 family public.fx_document_fact_families;previous public.fx_document_fact_revisions;parent public.fx_document_fact_revisions;tx public.bank_transactions;
 doc jsonb;source jsonb;revision uuid:=gen_random_uuid();result jsonb;financial_before text;doc_ids uuid[];
begin
 if owner_id is null then raise exception 'Sign in to review FX document facts.';end if;
 if jsonb_typeof(p_intent) is distinct from 'object' then raise exception 'Review an exact FX evidence intent.';end if;
 if(select count(*) from jsonb_object_keys(p_intent))<>15 or not(p_intent ?& array['schema_version','ruleset_id','family_id','expected_ordinal','kind','state','document_id','invoice_evidence_revision_id','transaction_id','transaction_version','data','human_read_original','expected_stamp','rationale','request_id']) then raise exception 'Review exact FX evidence fields.';end if;
 if p_intent->>'schema_version' is distinct from 'fx-document-fact-intent/1' or p_intent->>'ruleset_id' is distinct from 'vibecount-currencies/1' then raise exception 'Review supported evidence and currency rules.';end if;
 family_id:=public.fx_fact_uuid(p_intent->'family_id',false);request_id:=public.fx_fact_uuid(p_intent->'request_id',false);
 doc_id:=public.fx_fact_uuid(p_intent->'document_id',true);parent_id:=public.fx_fact_uuid(p_intent->'invoice_evidence_revision_id',true);tx_id:=public.fx_fact_uuid(p_intent->'transaction_id',true);
 if jsonb_typeof(p_intent->'expected_ordinal') is distinct from 'number' or p_intent->>'expected_ordinal' !~ '^(0|[1-9][0-9]{0,9})$' or(p_intent->>'expected_ordinal')::numeric>2147483646 then raise exception 'Review the expected evidence ordinal.';end if;
 expected:=(p_intent->>'expected_ordinal')::integer;fact_kind:=p_intent->>'kind';fact_state:=p_intent->>'state';reason:=btrim(p_intent->>'rationale');reviewed_stamp:=p_intent->>'expected_stamp';
 if fact_kind is null or fact_kind not in('invoice','conversion') or fact_state is null or fact_state not in('provisional','verified','withdrawn')
  or jsonb_typeof(p_intent->'rationale') is distinct from 'string' or reason is null or length(reason) not between 1 and 1000
  or jsonb_typeof(p_intent->'expected_stamp') is distinct from 'string' or length(reviewed_stamp)<>32 or reviewed_stamp !~ '^[a-f0-9]{32}$'
  or jsonb_typeof(p_intent->'human_read_original') is distinct from 'boolean' then raise exception 'Review typed evidence state, context and reason.';end if;
 attested:=(p_intent->>'human_read_original')::boolean;
 if fact_state='verified' and not attested then raise exception 'A human must check the original document before verifying these facts.';end if;
 if fact_state='withdrawn' then
  if attested or doc_id is not null or parent_id is not null or tx_id is not null or p_intent->'transaction_version'<>'null'::jsonb or p_intent->'data'<>'null'::jsonb then raise exception 'Withdrawal retains the old exact evidence snapshot.';end if;
  data:=null;
 else
  if doc_id is null then raise exception 'Choose an owned registered evidence item.';end if;
  data:=public.validate_fx_document_fact_data(fact_kind,p_intent->'data');
  if fact_kind='invoice' then
   if parent_id is not null or tx_id is not null or p_intent->'transaction_version'<>'null'::jsonb then raise exception 'Invoice facts do not classify a receipt.';end if;
  else
   if parent_id is null or tx_id is null or jsonb_typeof(p_intent->'transaction_version') is distinct from 'number'
    or p_intent->>'transaction_version' !~ '^(0|[1-9][0-9]{0,9})$' or(p_intent->>'transaction_version')::numeric>2147483647 then raise exception 'Pin the exact invoice evidence and receipt version.';end if;
   tx_version:=(p_intent->>'transaction_version')::integer;
  end if;
 end if;
 -- Canonical intent preserves stable retries despite UUID case or rational reduction.
 p_intent:=p_intent||jsonb_build_object('family_id',family_id,'request_id',request_id,'document_id',doc_id,'invoice_evidence_revision_id',parent_id,'transaction_id',tx_id,'transaction_version',tx_version,'expected_ordinal',expected,'rationale',reason,'data',data);
 payload:=encode(sha256(convert_to(jsonb_build_object('method','review_fx_document_evidence/1','intent',p_intent-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.fx_document_fact_requests where user_id=owner_id and fx_document_fact_requests.request_id=fx_review.request_id;
 if found then if prior.payload_hash<>payload then raise exception 'FX evidence request changed.';end if;return prior.result;end if;
 if public.fx_evidence_review_stamp() is distinct from reviewed_stamp then raise exception 'FX evidence or financial context changed. Review again.';end if;
 financial_before:=public.reconciliation_export_stamp();
 select * into family from public.fx_document_fact_families where id=family_id and user_id=owner_id;
 if family.id is not null and family.kind<>fact_kind then raise exception 'Preserve the evidence family kind.';end if;
 select * into previous from public.fx_document_fact_revisions r where r.family_id=fx_review.family_id and r.user_id=owner_id order by r.ordinal desc limit 1;
 if coalesce(previous.ordinal,0)<>expected then raise exception 'Evidence family revision changed.';end if;
 if fact_state='withdrawn' then
  if previous.id is null then raise exception 'Choose existing evidence to withdraw.';end if;
  doc_id:=previous.document_id;parent_id:=previous.invoice_evidence_revision_id;tx_id:=previous.transaction_id;tx_version:=previous.transaction_version;data:=previous.data;source:=previous.source_snapshot;
 else
  if fact_kind='conversion' then
   select * into parent from public.fx_document_fact_revisions where id=parent_id and user_id=owner_id and kind='invoice' and state='verified';
   if parent.id is null or parent.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.user_id=owner_id and r.family_id=parent.family_id order by r.ordinal desc limit 1) then raise exception 'Choose the current verified invoice facts.';end if;
  end if;
  perform 1 from public.fx_document_fact_families f where f.user_id=owner_id and f.id in(family_id,parent.family_id) order by f.id for update;
  doc_ids:=array[doc_id];if parent.id is not null then doc_ids:=array_append(doc_ids,parent.document_id);end if;
  perform 1 from public.evidence_documents d where d.user_id=owner_id and d.id=any(doc_ids) order by d.id for share;
  perform 1 from storage.objects o join public.evidence_documents d on o.bucket_id='document-evidence' and o.name=d.object_path where d.user_id=owner_id and d.id=any(doc_ids) order by o.id for share of o;
  if tx_id is not null then perform 1 from public.bank_transactions t where t.id=tx_id and t.user_id=owner_id for update;end if;
  if public.fx_evidence_review_stamp() is distinct from reviewed_stamp then raise exception 'FX evidence or financial context changed after source locks.';end if;
  doc:=public.fx_document_source(owner_id,doc_id,fact_kind='invoice');
  if doc is null or(doc->>'available')::boolean is distinct from true then raise exception 'Preserve an owned registered PDF or image before fact review.';end if;
  source:=jsonb_build_object('document_source',doc);
  if fact_kind='conversion' then
   if not public.fx_document_fact_source_current(parent.id,owner_id) then raise exception 'Invoice evidence source is unavailable or changed.';end if;
   select t.* into tx from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
    where t.id=tx_id and t.user_id=owner_id and t.currency='GBP' and t.signed_amount_pence>0 and i.status in('review','committed');
   if tx.id is null or tx.decision_version<>tx_version then raise exception 'Review the current owned positive GBP receipt.';end if;
   if data->'rate'->>'source_currency' is distinct from parent.data->>'currency' or(data->>'invoice_portion_minor')::bigint>(parent.data->>'original_total_minor')::bigint
    or(data->>'gbp_cash_portion_pence')::bigint>tx.signed_amount_pence then raise exception 'Document portions exceed the invoice or observed cash.';end if;
   source:=source||jsonb_build_object('invoice_evidence',jsonb_build_object('id',parent.id,'family_id',parent.family_id,'ordinal',parent.ordinal,'data',parent.data,'document_id',parent.document_id),
    'receipt',jsonb_build_object('id',tx.id,'import_id',tx.import_id,'source_row_id',tx.source_row_id,'transaction_date',tx.transaction_date,'signed_amount_pence',tx.signed_amount_pence,'currency',tx.currency,'decision_version',tx.decision_version,'classification',tx.classification,'dedupe_status',tx.dedupe_status));
  end if;
  if fact_state='verified' and fact_kind='invoice' and exists(select 1 from(
    select distinct on(r.family_id) r.* from public.fx_document_fact_revisions r where r.user_id=owner_id and r.kind='invoice' order by r.family_id,r.ordinal desc
   ) s where s.family_id<>fx_review.family_id and s.state='verified' and s.document_id=doc_id and lower(s.data->>'invoice_reference')=lower(fx_review.data->>'invoice_reference')) then raise exception 'Revise the existing reviewed invoice facts for this document reference.';end if;
 end if;
 -- Recheck after source selection: new immutable registrations can commit under
 -- the intake lock while FOR SHARE document locks permit their FK references.
 -- Check before our own revision/family inserts alter the evidence stamp.
 if public.fx_evidence_review_stamp() is distinct from reviewed_stamp then raise exception 'FX evidence or financial context changed during source capture. Review again.';end if;
 if family.id is null then insert into public.fx_document_fact_families(id,user_id,kind) values(family_id,owner_id,fact_kind);end if;
 insert into public.fx_document_fact_revisions(id,user_id,family_id,kind,ordinal,state,ruleset_id,document_id,invoice_evidence_revision_id,transaction_id,transaction_version,data,source_snapshot,reviewed_stamp,rationale,human_read_original,author,request_id)
 values(revision,owner_id,family_id,fact_kind,expected+1,fact_state,'vibecount-currencies/1',doc_id,parent_id,tx_id,tx_version,data,source,reviewed_stamp,reason,attested,owner_id,request_id);
 if public.reconciliation_export_stamp() is distinct from financial_before then raise exception 'Evidence preparation must not change financial state.';end if;
 result:=jsonb_build_object('family_id',family_id,'revision_id',revision,'ordinal',expected+1,'state',fact_state,'kind',fact_kind,'financial_action','evidence_preparation_only','recognized_income_change_pence',0,'recognized_expense_change_pence',0,'canonical_invoice_change',0,'settlement_change',0);
 insert into public.fx_document_fact_requests(user_id,request_id,payload_hash,result) values(owner_id,request_id,payload,result);
 return result;
end;$$;
revoke all on function public.review_fx_document_evidence(jsonb) from public,anon,service_role;
grant execute on function public.review_fx_document_evidence(jsonb) to authenticated;
