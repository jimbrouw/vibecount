-- Private stage-B binding. No public financial approval/settlement is enabled here.
create table public.fx_conversion_lots (
 id uuid primary key,user_id uuid not null references auth.users(id),invoice_id uuid not null,invoice_revision_id uuid not null,
 invoice_fact_revision_id uuid not null,conversion_document_id uuid not null,conversion_family_id uuid not null,conversion_fact_revision_id uuid not null,
 transaction_id uuid not null,transaction_version integer not null check(transaction_version between 0 and 2147483647),
 ruleset_id text not null references public.fx_currency_rulesets(id),invoice_currency text not null,
 cash_currency text not null check(cash_currency='GBP'),invoice_limit_minor bigint not null check(invoice_limit_minor between 1 and 999999999999),
 cash_limit_minor bigint not null check(cash_limit_minor between 0 and 999999999999),rate jsonb not null,
 conversion_date date not null,evidence_date date not null,source_snapshot jsonb not null,
 author uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,user_id),
 unique(user_id,conversion_family_id),unique(user_id,conversion_fact_revision_id),
 unique(user_id,invoice_revision_id,transaction_id,conversion_document_id,rate,conversion_date),
 foreign key(invoice_id,user_id) references public.invoices(id,user_id),
 foreign key(invoice_revision_id,user_id) references public.invoice_revisions(id,user_id),
 foreign key(invoice_fact_revision_id,user_id) references public.fx_document_fact_revisions(id,user_id),
 foreign key(conversion_document_id,user_id) references public.evidence_documents(id,user_id),
 foreign key(conversion_family_id,user_id) references public.fx_document_fact_families(id,user_id),
 foreign key(conversion_fact_revision_id,user_id) references public.fx_document_fact_revisions(id,user_id),
 foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),
 check(author=user_id),check(ruleset_id='vibecount-currencies/1'),check(invoice_currency in('GBP','USD','EUR','JPY','KWD')),
 check(jsonb_typeof(rate)='object' and jsonb_typeof(source_snapshot)='object')
);
alter table public.fx_conversion_lots enable row level security;
revoke all on public.fx_conversion_lots from public,anon,authenticated,service_role;
grant select on public.fx_conversion_lots to authenticated,service_role;
create policy fx_lots_owner_read on public.fx_conversion_lots for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_fx_conversion_lots before update or delete on public.fx_conversion_lots for each row execute function public.reject_source_mutation();
create index fx_lots_invoice on public.fx_conversion_lots(user_id,invoice_id);
create index fx_lots_receipt on public.fx_conversion_lots(user_id,transaction_id);

-- Always revalidate current meaning. Historical request recovery belongs to the
-- future enclosing approval RPC, before calling this helper. No app role can call it.
create function public.bind_fx_conversion_lot(p_owner uuid,p_lot uuid,p_invoice uuid,p_revision uuid,p_conversion uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices;rev public.invoice_revisions;fact public.fx_document_fact_revisions;parent public.fx_document_fact_revisions;
 tx public.bank_transactions;record public.financial_records;prior public.fx_conversion_lots;bound public.fx_conversion_lots;data jsonb;limit_invoice bigint;limit_cash bigint;conversion jsonb;
begin
 if p_owner is null or p_owner is distinct from auth.uid() or p_lot is null or p_invoice is null or p_revision is null or p_conversion is null then raise exception 'Review owned exact FX lot sources.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 lock table public.invoices,public.invoice_revisions,public.bank_transactions,public.financial_records,public.record_imports,
 public.fx_document_fact_families,public.fx_document_fact_revisions,public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 select * into inv from public.invoices where id=p_invoice and user_id=p_owner and origin='preserved_external' and status='finalised';
 select * into rev from public.invoice_revisions where id=p_revision and user_id=p_owner and invoice_id=p_invoice and origin='preserved_external';
 if inv.id is null or rev.id is null or rev.version is distinct from inv.external_revision or rev.source_fact_revision_id is distinct from inv.source_fact_revision_id then raise exception 'Review the current canonical external revision.';end if;
 perform public.validate_external_invoice_revision(rev.id,p_owner);
 select * into parent from public.fx_document_fact_revisions where id=inv.source_fact_revision_id and user_id=p_owner and kind='invoice' and state='verified';
 select * into fact from public.fx_document_fact_revisions where id=p_conversion and user_id=p_owner and kind='conversion' and state='verified';
 if parent.id is null or fact.id is null or not parent.human_read_original or not fact.human_read_original
 or parent.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.user_id=p_owner and r.family_id=parent.family_id order by ordinal desc limit 1)
 or fact.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.user_id=p_owner and r.family_id=fact.family_id order by ordinal desc limit 1)
 or fact.invoice_evidence_revision_id is distinct from parent.id
 or not public.fx_document_fact_source_current(parent.id,p_owner) or not public.fx_document_fact_source_current(fact.id,p_owner)
 or public.fx_document_source(p_owner,parent.document_id,true) is distinct from parent.source_snapshot->'document_source'
 or public.fx_document_source(p_owner,fact.document_id,false) is distinct from fact.source_snapshot->'document_source' then raise exception 'Review current verified invoice and conversion evidence.';end if;
 data:=public.validate_fx_document_fact_data('conversion',fact.data);
 limit_invoice:=(data->>'invoice_portion_minor')::bigint;limit_cash:=(data->>'gbp_cash_portion_pence')::bigint;
 conversion:=public.fx_convert_minor(limit_invoice,data->'rate',fact.ruleset_id);
 if data->'rate'->>'source_currency' is distinct from inv.currency or data->'rate'->>'target_currency'<>'GBP'
 or limit_invoice>inv.original_total_minor or(conversion->>'target_minor')::bigint<>limit_cash then raise exception 'Documented conversion exceeds original invoice or uses different units.';end if;
 select * into tx from public.bank_transactions where id=fact.transaction_id and user_id=p_owner;
 select * into record from public.financial_records where id=tx.recognized_record_id and user_id=p_owner;
 if tx.id is null or tx.currency<>'GBP' or tx.signed_amount_pence<=0 or tx.decision_version is distinct from fact.transaction_version
 or tx.classification<>'Business' or tx.business_use_bps<>10000 or tx.dedupe_status<>'clear' or tx.active_transfer_id is not null or tx.active_refund_id is not null
 or not exists(select 1 from public.record_imports i where i.id=tx.import_id and i.user_id=p_owner and i.status in('review','committed'))
 or record.id is null or record.record_type<>'income' or record.status<>'approved' or record.effect_sign<>1 or record.bank_transaction_id is distinct from tx.id
 or record.amount*100<>tx.signed_amount_pence or limit_cash>tx.signed_amount_pence then raise exception 'Review the complete source-linked GBP receipt before binding its conversion.';end if;
 select * into prior from public.fx_conversion_lots where id=p_lot;
 if found then
  if(prior.user_id,prior.invoice_id,prior.invoice_revision_id,prior.conversion_fact_revision_id,prior.transaction_id,prior.transaction_version)
   is distinct from(p_owner,p_invoice,p_revision,p_conversion,tx.id,tx.decision_version) then raise exception 'Conversion lot identity already binds different sources.';end if;
  return to_jsonb(prior);
 end if;
 if exists(select 1 from public.fx_conversion_lots where user_id=p_owner and conversion_family_id=fact.family_id) then raise exception 'Reuse the single conversion-family lot; do not reset cumulative rounding.';end if;
 insert into public.fx_conversion_lots(id,user_id,invoice_id,invoice_revision_id,invoice_fact_revision_id,conversion_document_id,conversion_family_id,conversion_fact_revision_id,transaction_id,transaction_version,
 ruleset_id,invoice_currency,cash_currency,invoice_limit_minor,cash_limit_minor,rate,conversion_date,evidence_date,source_snapshot,author)
 values(p_lot,p_owner,inv.id,rev.id,parent.id,fact.document_id,fact.family_id,fact.id,tx.id,tx.decision_version,fact.ruleset_id,inv.currency,'GBP',limit_invoice,limit_cash,conversion->'rate',
 (data->>'conversion_date')::date,(data->>'evidence_date')::date,jsonb_build_object('canonical_invoice',rev.snapshot,'invoice_evidence',parent.source_snapshot,'conversion_evidence',fact.source_snapshot,'conversion_data',data),p_owner) returning * into bound;
 return to_jsonb(bound);
end;$$;
revoke all on function public.bind_fx_conversion_lot(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Immutable source closure also protects future internal callers from inserting
-- a recipe whose limits or ancestry differ from the retained evidence.
create function public.validate_fx_conversion_lot_history() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rev public.invoice_revisions;parent public.fx_document_fact_revisions;fact public.fx_document_fact_revisions;data jsonb;converted jsonb;
begin
 select * into rev from public.invoice_revisions where id=new.invoice_revision_id and user_id=new.user_id and invoice_id=new.invoice_id and origin='preserved_external';
 select * into parent from public.fx_document_fact_revisions where id=new.invoice_fact_revision_id and user_id=new.user_id and kind='invoice' and state='verified' and human_read_original;
 select * into fact from public.fx_document_fact_revisions where id=new.conversion_fact_revision_id and user_id=new.user_id and kind='conversion' and state='verified' and human_read_original;
 if rev.id is null or parent.id is null or fact.id is null then raise exception 'Preserve exact conversion lot source closure.';end if;
 perform public.validate_external_invoice_revision(rev.id,new.user_id);
 data:=public.validate_fx_document_fact_data('conversion',fact.data);converted:=public.fx_convert_minor((data->>'invoice_portion_minor')::bigint,data->'rate',fact.ruleset_id);
 if(new.invoice_fact_revision_id,new.conversion_document_id,new.conversion_family_id,new.transaction_id,new.transaction_version,new.ruleset_id,new.invoice_currency,new.cash_currency,new.invoice_limit_minor,new.cash_limit_minor,new.rate,new.conversion_date,new.evidence_date)
 is distinct from(rev.source_fact_revision_id,fact.document_id,fact.family_id,fact.transaction_id,fact.transaction_version,fact.ruleset_id,parent.data->>'currency','GBP',(data->>'invoice_portion_minor')::bigint,(data->>'gbp_cash_portion_pence')::bigint,converted->'rate',(data->>'conversion_date')::date,(data->>'evidence_date')::date)
 or fact.invoice_evidence_revision_id is distinct from parent.id
 or converted->'rate'->>'source_currency' is distinct from parent.data->>'currency'
 or new.invoice_limit_minor>(parent.data->>'original_total_minor')::bigint
 or new.source_snapshot is distinct from jsonb_build_object('canonical_invoice',rev.snapshot,'invoice_evidence',parent.source_snapshot,'conversion_evidence',fact.source_snapshot,'conversion_data',data)
 then raise exception 'Preserve exact conversion lot source closure.';end if;
 return new;
end;$$;
revoke all on function public.validate_fx_conversion_lot_history() from public,anon,authenticated,service_role;
create trigger validate_fx_lot_history before insert on public.fx_conversion_lots for each row execute function public.validate_fx_conversion_lot_history();
