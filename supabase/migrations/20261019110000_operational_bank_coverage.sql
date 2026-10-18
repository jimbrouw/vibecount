-- Operational source coverage, not tax readiness or certification of retained bytes.
-- Retain V1 for explicit historical replay; preserve current entry-point OIDs/ACLs.
do $$declare definition text;changed text;begin
 select pg_get_functiondef('public.financial_review_catalog(uuid,integer,date)'::regprocedure) into definition;
 if position('vibecount.financial-review/1' in definition)=0 then raise exception 'Inspect the predecessor review catalog.';end if;
 changed:=replace(definition,'FUNCTION public.financial_review_catalog(','FUNCTION public.financial_review_catalog_v1(');
 if changed=definition then raise exception 'Inspect the predecessor function declaration.';end if;execute changed;
end;$$;
revoke all on function public.financial_review_catalog_v1(uuid,integer,date) from public,anon,authenticated,service_role;

create or replace function public.financial_review_catalog(p_owner uuid,p_year integer,p_as_of date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare legacy jsonb;bank jsonb;payload jsonb;result jsonb;summary jsonb;
begin
 legacy:=public.financial_review_catalog_v1(p_owner,p_year,p_as_of);
 bank:=public.bank_source_coverage_for_owner(p_owner);
 with sources as materialized(
  select s.*,t.business_use_bps,
   case when s.cash_date<make_date(p_year,7,6) then 1 when s.cash_date<make_date(p_year,10,6) then 2 when s.cash_date<make_date(p_year+1,1,6) then 3 else 4 end quarter,
   s.representation<>'native_gbp' unsupported,
   (not s.source_complete or not s.source_available) unavailable,
   (s.representation<>'native_gbp' or not s.source_complete or not s.source_available
    or s.dedupe_status='needs_review' or(s.dedupe_status<>'duplicate' and(s.classification='Unknown'
     or exists(select 1 from public.financial_records f where f.bank_transaction_id=s.id and f.user_id=p_owner and f.status in('draft','review'))
     or(s.classification in('Business','Mixed') and t.business_use_bps>0 and abs(t.signed_amount_pence)*t.business_use_bps>=5000 and s.approved_record_count=0)))) unresolved
  from jsonb_to_recordset(bank->'observations') as s(id uuid,cash_date date,tax_year_start integer,import_status text,representation text,source_complete boolean,source_available boolean,dedupe_status text,classification text,approved_record_count integer)
  join public.bank_transactions t on t.id=s.id and t.user_id=p_owner
  where s.tax_year_start=p_year and s.import_status is distinct from 'discarded'
 ),quarters as(
  select q.value||jsonb_build_object('source_count',(select count(*) from sources where quarter=(q.value->>'quarter')::integer),
   'unresolved_source_count',(select count(*) from sources where quarter=(q.value->>'quarter')::integer and unresolved),
   'unsupported_source_count',(select count(*) from sources where quarter=(q.value->>'quarter')::integer and unsupported),
   'source_unavailable_count',(select count(*) from sources where quarter=(q.value->>'quarter')::integer and unavailable)) value
  from jsonb_array_elements(legacy->'quarters') q
 )
 select jsonb_build_object('source_count',(select count(*) from sources),'unresolved_source_count',(select count(*) from sources where unresolved),
  'unsupported_source_count',(select count(*) from sources where unsupported),'source_unavailable_count',(select count(*) from sources where unavailable),
  'quarters',(select jsonb_agg(value order by(value->>'quarter')::integer) from quarters)) into summary;
 payload:=legacy||summary||jsonb_build_object('schema_version','vibecount.financial-review/2',
  'coverage','operational_ledger_invoice_and_bank_source_review_only; source_bytes_and_tax_completeness_not_certified','bank_source_coverage',bank);
 result:=payload||jsonb_build_object('stamp',encode(sha256(convert_to(jsonb_build_object('legacy_stamp',legacy->>'stamp','review',payload-'stamp')::text,'UTF8')),'hex'));
 if octet_length(result::text)>2000000 then raise exception 'Complete operational review exceeds the safe payload limit.';end if;
 return result;
end;$$;

alter table public.quarterly_readiness_checks
 add column unsupported_source_count integer,
 add column source_unavailable_count integer,
 add column bank_coverage_stamp text;

create function public.freeze_financial_review_inputs() returns void language plpgsql set search_path='' as $$
begin
 -- Includes account/import/file/row/observation/record, document registration/object
 -- and valuation history inputs. Extra relationship locks retain the shared lock order.
 perform public.freeze_bank_valuation_inputs();
 lock table public.invoices,public.invoice_credit_notes,public.invoice_credit_reversals,
 public.invoice_refund_assignments,public.invoice_refund_assignment_reversals in share mode nowait;
end;$$;
revoke all on function public.freeze_financial_review_inputs() from public,anon,authenticated,service_role;

create or replace function public.capture_quarter_readiness(p_owner uuid,p_year integer,p_quarter integer,p_as_of date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare catalog jsonb;q jsonb;needs_attention boolean;note text;
begin
 if p_quarter is null or p_quarter not between 1 and 4 or p_owner is null or not exists(select 1 from auth.users where id=p_owner) then raise exception 'Invalid readiness scope.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 perform public.freeze_financial_review_inputs();
 catalog:=public.financial_review_catalog(p_owner,p_year,p_as_of);
 select value into q from jsonb_array_elements(catalog->'quarters') where(value->>'quarter')::integer=p_quarter;
 needs_attention:=(q->>'uncategorised_count')::integer>0 or(q->>'review_count')::integer>0 or(q->>'unresolved_source_count')::integer>0
  or(q->>'unsupported_source_count')::integer>0 or(q->>'source_unavailable_count')::integer>0
  or(catalog->>'external_invoice_count')::integer>0 or(catalog->>'native_overdue_count')::integer>0 or(q->>'approved_count')::integer=0;
 note:='Operational review only; retained bytes and tax/source completeness are not certified. Native overdue: '||(catalog->>'native_overdue_count')||'; unsupported external invoice balances: '||(catalog->>'external_invoice_count')
  ||'; unresolved quarter sources: '||(q->>'unresolved_source_count')||'; unsupported quarter sources: '||(q->>'unsupported_source_count')||'; unavailable source metadata: '||(q->>'source_unavailable_count')
  ||'; source counters overlap; uncategorised approved: '||(q->>'uncategorised_count')||'; awaiting review: '||(q->>'review_count')||case when(q->>'approved_count')::integer=0 then '; no approved quarter activity' else '' end||'.';
 insert into public.quarterly_readiness_checks(user_id,tax_year_start,tax_quarter,checked_at,uncategorised_count,review_count,overdue_invoice_count,net_profit_pence,status,notes,coverage_version,source_stamp,external_invoice_count,unresolved_source_count,checked_as_of,unsupported_source_count,source_unavailable_count,bank_coverage_stamp)
 values(p_owner,p_year,p_quarter,now(),(q->>'uncategorised_count')::integer,(q->>'review_count')::integer,(catalog->>'native_overdue_count')::integer,(q->>'net_pence')::bigint,case when needs_attention then 'needs_attention' else 'ok' end,note,'vibecount.financial-review/2',catalog->>'stamp',(catalog->>'external_invoice_count')::integer,(q->>'unresolved_source_count')::integer,p_as_of,(q->>'unsupported_source_count')::integer,(q->>'source_unavailable_count')::integer,catalog->'bank_source_coverage'->>'stamp')
 on conflict(user_id,tax_year_start,tax_quarter) do update set checked_at=excluded.checked_at,uncategorised_count=excluded.uncategorised_count,review_count=excluded.review_count,overdue_invoice_count=excluded.overdue_invoice_count,net_profit_pence=excluded.net_profit_pence,status=excluded.status,notes=excluded.notes,coverage_version=excluded.coverage_version,source_stamp=excluded.source_stamp,external_invoice_count=excluded.external_invoice_count,unresolved_source_count=excluded.unresolved_source_count,checked_as_of=excluded.checked_as_of,unsupported_source_count=excluded.unsupported_source_count,source_unavailable_count=excluded.source_unavailable_count,bank_coverage_stamp=excluded.bank_coverage_stamp;
 return jsonb_build_object('owner_id',p_owner,'tax_year_start',p_year,'tax_quarter',p_quarter,'coverage_version','vibecount.financial-review/2','status',case when needs_attention then 'needs_attention' else 'ok' end);
end;$$;
