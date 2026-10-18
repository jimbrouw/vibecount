create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  label text not null check (length(btrim(label)) between 1 and 80),
  provider text not null check (provider in ('starling','nationwide','amex','generic')),
  account_type text not null check (account_type in ('bank','credit_card')),
  currency text not null default 'GBP' check (currency = 'GBP'),
  masked_identifier text not null check (masked_identifier ~ '^[A-Za-z0-9]{1,4}$'),
  created_at timestamptz not null default now(), unique(id,user_id)
);
create index accounts_user_created on public.financial_accounts(user_id,created_at,id);
alter table public.financial_accounts enable row level security;
revoke all on public.financial_accounts from public,anon,authenticated;
create policy accounts_owner_read on public.financial_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy accounts_owner_insert on public.financial_accounts for insert to authenticated with check (user_id = (select auth.uid()));
grant select,insert on public.financial_accounts to authenticated;

-- Ciphertext only. No authenticated Storage policies: originals cannot be fetched by browser agents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('source-evidence','source-evidence',false,1100000,array['application/octet-stream']);

create table public.source_upload_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  account_id uuid not null, file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  object_path text not null unique, key_id text not null,
  size_bytes integer not null check (size_bytes between 1 and 1000000),
  state text not null default 'pending' check (state in ('pending','uploaded','linked','duplicate','failed')),
  created_at timestamptz not null default now(),
  foreign key (account_id,user_id) references public.financial_accounts(id,user_id), unique(id,user_id)
);
create table public.record_source_files (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  account_id uuid not null, file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  object_path text not null unique, key_id text not null, size_bytes integer not null,
  created_at timestamptz not null default now(),
  foreign key (account_id,user_id) references public.financial_accounts(id,user_id),
  unique(user_id,account_id,file_hash), unique(id,user_id), unique(id,user_id,account_id,file_hash)
);
alter table public.source_upload_attempts enable row level security;
alter table public.record_source_files enable row level security;
-- Only the authenticated server's privileged path may write source evidence.
revoke all on public.source_upload_attempts, public.record_source_files from public,anon,authenticated;
grant select,insert,update on public.source_upload_attempts to service_role;
grant select,insert on public.record_source_files to service_role;

alter table public.record_imports
  add column account_id uuid,
  add column source_file_id uuid,
  add column file_hash text,
  add column parser_version text,
  add column coverage_start date,
  add column coverage_end date,
  add constraint imports_account_owner_fk foreign key(account_id,user_id) references public.financial_accounts(id,user_id),
  add constraint imports_source_owner_fk foreign key(source_file_id,user_id,account_id,file_hash) references public.record_source_files(id,user_id,account_id,file_hash),
  add constraint imports_source_hash check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
  add constraint imports_source_complete check (
    (source_file_id is null and account_id is null and file_hash is null and parser_version is null and coverage_start is null and coverage_end is null)
    or (source_file_id is not null and account_id is not null and file_hash is not null and parser_version is not null and coverage_start is not null and coverage_end is not null and coverage_start<=coverage_end)
  );
create unique index imports_account_file_unique on public.record_imports(user_id,account_id,file_hash) where file_hash is not null;

create table public.source_rows (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  import_id uuid not null, row_number integer not null check(row_number >= 2),
  row_hash text not null check(row_hash ~ '^[0-9a-f]{64}$'),
  raw_encrypted text not null, created_at timestamptz not null default now(),
  foreign key(import_id,user_id) references public.record_imports(id,user_id),
  unique(import_id,row_number), unique(id,user_id)
);
alter table public.source_rows enable row level security;
revoke all on public.source_rows from public,anon,authenticated;
create policy source_row_owner_read on public.source_rows for select to authenticated using(user_id = (select auth.uid()));
grant select(id,user_id,import_id,row_number,row_hash,created_at) on public.source_rows to authenticated;
grant select,insert on public.source_rows to service_role;

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  account_id uuid not null, import_id uuid not null, source_row_id uuid not null unique,
  transaction_date date not null, signed_amount_pence bigint not null check(signed_amount_pence <> 0 and abs(signed_amount_pence) <= 999999999999),
  currency text not null check(currency = 'GBP'), description text not null, reference text not null default '',
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  dedupe_status text not null default 'clear' check(dedupe_status in ('clear','needs_review','duplicate')),
  classification text not null default 'Unknown' check(classification in ('Business','Personal','Mixed','Transfer','Refund','Unknown')),
  business_use_bps integer not null default 0 check(business_use_bps between 0 and 10000),
  category_id uuid references public.record_categories(id),
  decision_version integer not null default 0,
  recognized_record_id uuid,
  tax_year_start integer generated always as (case when transaction_date >= make_date(extract(year from transaction_date)::integer,4,6)
    then extract(year from transaction_date)::integer else extract(year from transaction_date)::integer - 1 end) stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(account_id,user_id) references public.financial_accounts(id,user_id),
  foreign key(import_id,user_id) references public.record_imports(id,user_id),
  foreign key(source_row_id,user_id) references public.source_rows(id,user_id), unique(id,user_id)
);
create index transactions_account_fingerprint on public.bank_transactions(user_id,account_id,fingerprint);
create index transactions_import on public.bank_transactions(user_id,import_id,id);
alter table public.bank_transactions enable row level security;
revoke all on public.bank_transactions from public,anon,authenticated;
create policy transaction_owner_read on public.bank_transactions for select to authenticated using(user_id=(select auth.uid()));
grant select on public.bank_transactions to authenticated;
grant select,insert,update on public.bank_transactions to service_role;

alter table public.financial_records
  add column bank_transaction_id uuid unique,
  add constraint records_bank_transaction_owner_fk foreign key(bank_transaction_id,user_id) references public.bank_transactions(id,user_id);
alter table public.bank_transactions add constraint bank_transactions_recognized_record_owner_fk
  foreign key(recognized_record_id,user_id) references public.financial_records(id,user_id);

create table public.classification_decisions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  transaction_id uuid not null, import_id uuid not null, version integer not null,
  classification text not null check(classification in ('Business','Personal','Mixed','Transfer','Refund','Unknown')),
  business_use_bps integer not null check(business_use_bps between 0 and 10000),
  category_id uuid references public.record_categories(id), rationale text not null,
  recognized_pence bigint not null, author uuid not null references auth.users(id),
  evidence_status text not null default 'provisional', created_at timestamptz not null default now(),
  foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),
  foreign key(import_id,user_id) references public.record_imports(id,user_id), unique(transaction_id,version)
);
create index decisions_owner_import on public.classification_decisions(user_id,import_id,id);
alter table public.classification_decisions enable row level security;
revoke all on public.classification_decisions from public,anon,authenticated;
create policy decision_owner_read on public.classification_decisions for select to authenticated using(user_id=(select auth.uid()));
grant select on public.classification_decisions to authenticated;
grant select,insert on public.classification_decisions to service_role;

create table public.source_import_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  import_id uuid not null, event text not null check(event in ('imported','reimported','reversed','reopened')),
  reason text not null default '', author uuid not null references auth.users(id), created_at timestamptz not null default now(),
  foreign key(import_id,user_id) references public.record_imports(id,user_id)
);
create index source_events_owner_import on public.source_import_events(user_id,import_id,created_at);
alter table public.source_import_events enable row level security;
revoke all on public.source_import_events from public,anon,authenticated;
create policy source_events_owner_read on public.source_import_events for select to authenticated using(user_id=(select auth.uid()));
grant select on public.source_import_events to authenticated;
grant select,insert on public.source_import_events to service_role;

create function public.reject_source_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Original source evidence and decision history are immutable.'; end; $$;
create trigger immutable_source_file before update or delete on public.record_source_files for each row execute function public.reject_source_mutation();
create trigger immutable_source_row before update or delete on public.source_rows for each row execute function public.reject_source_mutation();
create trigger immutable_decision before update or delete on public.classification_decisions for each row execute function public.reject_source_mutation();
create trigger immutable_source_event before update or delete on public.source_import_events for each row execute function public.reject_source_mutation();

create function public.protect_transaction_source() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Source transactions must be reversed, not deleted.'; end if;
  if (new.user_id,new.account_id,new.import_id,new.source_row_id,new.transaction_date,new.signed_amount_pence,new.currency,new.description,new.reference,new.fingerprint)
    is distinct from (old.user_id,old.account_id,old.import_id,old.source_row_id,old.transaction_date,old.signed_amount_pence,old.currency,old.description,old.reference,old.fingerprint)
  then raise exception 'Normalized source facts are immutable.'; end if;
  return new;
end; $$;
create trigger immutable_transaction_source before update or delete on public.bank_transactions for each row execute function public.protect_transaction_source();

create function public.protect_import_source() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'DELETE' and current_user in ('anon','authenticated') and
    (new.source_file_id is not null or new.account_id is not null or new.file_hash is not null or new.parser_version is not null or new.coverage_start is not null or new.coverage_end is not null)
  then raise exception 'Source provenance requires a reviewed action through server ingestion.'; end if;
  if tg_op='INSERT' then return new; end if;
  if old.source_file_id is not null then
    if current_user in ('anon','authenticated') then raise exception 'Retained imports require a reviewed action.'; end if;
    if tg_op='DELETE' then raise exception 'Retained source imports cannot be deleted.'; end if;
    if (new.user_id,new.account_id,new.source_file_id,new.file_hash,new.parser_version,new.original_filename,new.metadata,new.coverage_start,new.coverage_end)
      is distinct from (old.user_id,old.account_id,old.source_file_id,old.file_hash,old.parser_version,old.original_filename,old.metadata,old.coverage_start,old.coverage_end)
    then raise exception 'Original import provenance is immutable.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger protect_retained_import before insert or update or delete on public.record_imports for each row execute function public.protect_import_source();

create function public.protect_source_posting() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and (new.bank_transaction_id is not null or (tg_op='UPDATE' and old.bank_transaction_id is not null)
    or exists(select 1 from public.record_imports where id=new.import_id and source_file_id is not null))
  then raise exception 'Source-linked records require a reviewed classification.'; end if;
  return new;
end; $$;
create trigger reviewed_source_posting before insert or update on public.financial_records for each row execute function public.protect_source_posting();

-- Server-only ingest: never called directly with browser-supplied normalized values.
create function public.ingest_source_csv(p_owner uuid,p_attempt uuid,p_filename text,p_parser text,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  attempt public.source_upload_attempts; existing_id uuid; file_id uuid; new_import_id uuid;
  r jsonb; source_id uuid; dupe text; row_count integer;
begin
  select * into attempt from public.source_upload_attempts where id=p_attempt and user_id=p_owner for update;
  if not found or attempt.state not in ('uploaded','linked','duplicate') then raise exception 'Uploaded source not found.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Expected source rows.'; end if;
  row_count := jsonb_array_length(p_rows);
  if row_count < 1 or row_count > 5000 then raise exception 'Import must contain 1 to 5000 rows.'; end if;
  -- Serialize the account, not just the file: simultaneous overlapping files must
  -- see one another's committed fingerprints before assigning a clear status.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text||attempt.account_id::text,0));
  select id into existing_id from public.record_imports where user_id=p_owner and account_id=attempt.account_id and file_hash=attempt.file_hash;
  if existing_id is not null then
    update public.source_upload_attempts set state='duplicate' where id=p_attempt;
    insert into public.source_import_events(user_id,import_id,event,author) values(p_owner,existing_id,'reimported',p_owner);
    return jsonb_build_object('import_id',existing_id,'created',false,'transactions',0);
  end if;
  if not exists(select 1 from storage.objects where bucket_id='source-evidence' and name=attempt.object_path) then
    raise exception 'Encrypted source object is missing.';
  end if;
  insert into public.record_source_files(user_id,account_id,file_hash,object_path,key_id,size_bytes)
    values(p_owner,attempt.account_id,attempt.file_hash,attempt.object_path,attempt.key_id,attempt.size_bytes) returning id into file_id;
  insert into public.record_imports(user_id,source_type,original_filename,status,account_id,source_file_id,file_hash,parser_version,metadata,coverage_start,coverage_end)
    values(p_owner,'csv',p_filename,'review',attempt.account_id,file_id,attempt.file_hash,p_parser,
      jsonb_build_object('row_count',row_count,'mapping',p_mapping,'currency','GBP'),
      (select min((value->>'date')::date) from jsonb_array_elements(p_rows)),
      (select max((value->>'date')::date) from jsonb_array_elements(p_rows))) returning id into new_import_id;
  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.source_rows(user_id,import_id,row_number,row_hash,raw_encrypted)
      values(p_owner,new_import_id,(r->>'row_number')::integer,r->>'row_hash',r->>'raw_encrypted') returning id into source_id;
    dupe := case when exists(select 1 from public.bank_transactions where user_id=p_owner and account_id=attempt.account_id
      and fingerprint=r->>'fingerprint' and bank_transactions.import_id<>new_import_id) then 'needs_review' else 'clear' end;
    insert into public.bank_transactions(user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,reference,fingerprint,dedupe_status)
      values(p_owner,attempt.account_id,new_import_id,source_id,(r->>'date')::date,(r->>'signed_pence')::bigint,
        r->>'currency',r->>'description',r->>'reference',r->>'fingerprint',dupe);
  end loop;
  update public.source_upload_attempts set state='linked' where id=p_attempt;
  insert into public.source_import_events(user_id,import_id,event,author) values(p_owner,new_import_id,'imported',p_owner);
  return jsonb_build_object('import_id',new_import_id,'created',true,'transactions',row_count);
end; $$;
revoke all on function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) to service_role;
grant select,insert,update on public.record_imports to service_role;

create function public.review_bank_transaction(p_id uuid,p_version integer,p_classification text,p_category uuid,p_bps integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  tx public.bank_transactions; owner_id uuid := auth.uid(); kind text; amount_pence bigint := 0;
  posting_id uuid; new_version integer;
begin
  if owner_id is null then raise exception 'Sign in to review transactions.'; end if;
  select * into tx from public.bank_transactions where id=p_id and user_id=owner_id for update;
  if not found then raise exception 'Transaction not found.'; end if;
  if not exists(select 1 from public.record_imports where id=tx.import_id and user_id=owner_id and status<>'discarded') then
    raise exception 'This import is reversed. Reopen it for review first.';
  end if;
  if tx.decision_version is distinct from p_version then raise exception 'Decision changed. Reload and review again.'; end if;
  if p_classification is null or p_classification not in ('Business','Personal','Mixed','Transfer','Refund','Unknown') then raise exception 'Choose a classification.'; end if;
  if p_rationale is null or length(btrim(p_rationale)) not between 1 and 1000 then raise exception 'Add a short reason.'; end if;
  kind := case when tx.signed_amount_pence > 0 then 'income' else 'expense' end;
  if p_classification in ('Business','Mixed') then
    if tx.dedupe_status <> 'clear' then raise exception 'Resolve possible duplicates before including this transaction.'; end if;
    if p_classification='Business' and p_bps is distinct from 10000 then raise exception 'Business use must be 100 percent.'; end if;
    if p_classification='Mixed' and (kind<>'expense' or p_bps is null or p_bps<=0 or p_bps>=10000) then raise exception 'Mixed expenses require a percentage between 0 and 100.'; end if;
    if not exists(select 1 from public.record_categories where id=p_category and record_type=kind and (user_id=owner_id or is_default)) then raise exception 'Choose an owned category of the correct type.'; end if;
    amount_pence := round(abs(tx.signed_amount_pence)::numeric*p_bps/10000)::bigint;
    if amount_pence=0 then raise exception 'Business amount rounds to zero.'; end if;
    insert into public.financial_records(user_id,record_type,record_date,description,amount,category_id,import_id,source_type,source_reference,status,approved_at,bank_transaction_id)
      values(owner_id,kind,tx.transaction_date,tx.description,amount_pence::numeric/100,p_category,tx.import_id,'csv','Transaction '||tx.id::text,'approved',now(),tx.id)
      on conflict(bank_transaction_id) do update set amount=excluded.amount,category_id=excluded.category_id,status='approved',approved_at=now()
      returning id into posting_id;
  else
    if p_bps is distinct from 0 or p_category is not null then raise exception 'Excluded/unresolved classifications require zero business percentage and no category.'; end if;
    posting_id := tx.recognized_record_id;
    if posting_id is not null then update public.financial_records set status='excluded',approved_at=null where id=posting_id and user_id=owner_id; end if;
  end if;
  new_version := tx.decision_version+1;
  insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
    values(owner_id,tx.id,tx.import_id,new_version,p_classification,p_bps,p_category,btrim(p_rationale),amount_pence,owner_id);
  update public.bank_transactions set classification=p_classification,business_use_bps=p_bps,category_id=p_category,
    decision_version=new_version,recognized_record_id=posting_id,updated_at=now() where id=tx.id;
  return jsonb_build_object('version',new_version,'recognized_pence',amount_pence,'record_id',posting_id);
end; $$;
revoke all on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) from public,anon;
grant execute on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) to authenticated;

create function public.source_import_summary(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('transactions',count(t.id),
    'income_pence',coalesce(sum(case when f.status='approved' and t.signed_amount_pence>0 then f.amount*100 else 0 end),0),
    'expense_pence',coalesce(sum(case when f.status='approved' and t.signed_amount_pence<0 then f.amount*100 else 0 end),0),
    'stamp',md5(coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'')))
  from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
  where t.import_id=p_id and t.user_id=(select auth.uid());
$$;
revoke all on function public.source_import_summary(uuid) from public,anon;
grant execute on function public.source_import_summary(uuid) to authenticated;

create function public.reverse_source_import(p_id uuid,p_stamp text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); imp public.record_imports; tx public.bank_transactions; summary jsonb; changed integer:=0;
begin
  if owner_id is null then raise exception 'Sign in to reverse an import.'; end if;
  select * into imp from public.record_imports where id=p_id and user_id=owner_id and source_file_id is not null for update;
  if not found then raise exception 'Preserved import not found.'; end if;
  if imp.status='discarded' then return 0; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Add a reversal reason.'; end if;
  perform 1 from public.bank_transactions where import_id=p_id and user_id=owner_id order by id for update;
  summary:=public.source_import_summary(p_id);
  if (summary->>'stamp') is distinct from p_stamp then raise exception 'Import decisions changed. Review the totals again.'; end if;
  for tx in select * from public.bank_transactions where import_id=p_id and user_id=owner_id order by id loop
    if tx.recognized_record_id is not null then
      update public.financial_records set status='excluded',approved_at=null where id=tx.recognized_record_id and user_id=owner_id;
    end if;
    insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author)
      values(owner_id,tx.id,p_id,tx.decision_version+1,'Unknown',0,null,'Import reversed: '||btrim(p_reason),0,owner_id);
    update public.bank_transactions set classification='Unknown',business_use_bps=0,category_id=null,decision_version=decision_version+1,updated_at=now() where id=tx.id;
    changed:=changed+1;
  end loop;
  update public.record_imports set status='discarded',committed_at=null where id=p_id;
  insert into public.source_import_events(user_id,import_id,event,reason,author) values(owner_id,p_id,'reversed',btrim(p_reason),owner_id);
  return changed;
end; $$;
revoke all on function public.reverse_source_import(uuid,text,text) from public,anon;
grant execute on function public.reverse_source_import(uuid,text,text) to authenticated;

create function public.reopen_source_import(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is null then raise exception 'Sign in to reopen an import.'; end if;
  update public.record_imports set status='review' where id=p_id and user_id=owner_id and source_file_id is not null and status='discarded';
  if not found then raise exception 'Reversed import not found.'; end if;
  insert into public.source_import_events(user_id,import_id,event,author) values(owner_id,p_id,'reopened',owner_id);
end; $$;
revoke all on function public.reopen_source_import(uuid) from public,anon;
grant execute on function public.reopen_source_import(uuid) to authenticated;
