-- Receipt metadata extends the existing records and private evidence store.
alter table public.record_attachments
  add column content_hash text,
  add column receipt_state text check (receipt_state in ('reading','review','saved','failed','excluded')),
  add column extraction jsonb,
  add column reviewed jsonb,
  add column extraction_method text,
  add column receipt_error text;
create unique index receipt_hash_per_owner on public.record_attachments(user_id,content_hash)
  where content_hash is not null and status='active';

alter table public.financial_records
  add column document_date date,
  add column payment_date date,
  add column merchant text,
  add column currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  add column gross_pence bigint check (gross_pence > 0),
  add column vat_pence bigint check (vat_pence >= 0 and vat_pence <= gross_pence),
  add column business_use_percent integer not null default 100 check (business_use_percent between 1 and 100),
  add column payment_status text not null default 'legacy' check (payment_status in ('legacy','paid','unpaid')),
  add column expense_kind text not null default 'expense' check (expense_kind in ('expense','refund')),
  add column refund_of uuid,
  add constraint receipt_paid_date check (payment_status <> 'paid' or payment_date is not null),
  add constraint receipt_approval_fields check (source_type <> 'receipt_document' or status <> 'approved' or
    (currency='GBP' and document_date is not null and gross_pence is not null and merchant is not null and category_id is not null and
    payment_status in ('paid','unpaid') and amount=round(gross_pence::numeric*business_use_percent/100)/100 and
    record_date=case when payment_status='paid' then payment_date else document_date end)),
  add constraint receipt_refund_link check (expense_kind <> 'refund' or (refund_of is not null and payment_status='paid')),
  add constraint receipt_refund_same_user_fk foreign key (refund_of,user_id) references public.financial_records(id,user_id);
alter table public.financial_records drop constraint financial_records_source_type_valid;
alter table public.financial_records add constraint financial_records_source_type_valid
  check (source_type in ('manual','invoice','csv','bank_statement_pdf','receipt_document'));
create index financial_records_refund_of_idx on public.financial_records(refund_of) where refund_of is not null;

-- One calculation source for Records, dashboard expenses and Tax prep.
-- Legacy rows retain their existing record-date basis. Receipt rows use actual payment dates.
create view public.financial_record_reporting with (security_invoker=true) as
select r.*, (case when expense_kind='refund' then -amount else amount end) as reporting_amount
from public.financial_records r
where status='approved' and currency='GBP' and payment_status <> 'unpaid';
grant select on public.financial_record_reporting to authenticated;
create or replace view public.financial_record_quarter_summaries with (security_invoker=true) as
select user_id,tax_year_start,tax_quarter,
 coalesce(sum(reporting_amount) filter (where record_type='income'),0) as income_total,
 coalesce(sum(reporting_amount) filter (where record_type='expense'),0) as expense_total,
 count(*) filter (where record_type='income') as income_count,
 count(*) filter (where record_type='expense') as expense_count,
 coalesce(sum(reporting_amount) filter (where record_type='income'),0)-coalesce(sum(reporting_amount) filter (where record_type='expense'),0) as net_total
from public.financial_record_reporting group by user_id,tax_year_start,tax_quarter;

-- Row locks make double-clicks/retries one record, including concurrent confirmations.
create function public.confirm_receipt_document(attachment_id uuid, details jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare
 evidence public.record_attachments%rowtype;
 target public.financial_records%rowtype;
 original public.financial_records%rowtype;
 result_id uuid;
 gross bigint; vat bigint; allocation integer; effective_date date; cost numeric;
 category uuid; matched uuid; reversal uuid; paid text; kind text;
begin
 if auth.uid() is null then raise exception 'Sign in to confirm expenses'; end if;
 select * into evidence from public.record_attachments where id=attachment_id and user_id=auth.uid() and status='active' for update;
 if not found or evidence.receipt_state is null then raise exception 'Receipt not found'; end if;
 if details->>'amountConfirmed' is distinct from 'true' or details->>'currency' is distinct from 'GBP' then raise exception 'Check amount and GBP currency'; end if;
 gross := (details->>'grossPence')::bigint;
 vat := (details->>'vatPence')::bigint;
 allocation := (details->>'businessUsePercent')::integer;
 category := (details->>'categoryId')::uuid;
 matched := (details->>'matchRecordId')::uuid;
 reversal := (details->>'refundOf')::uuid;
 paid := details->>'paymentStatus'; kind := details->>'kind';
 if gross is null or gross <= 0 or gross > 99999999999 or allocation is null or allocation not between 1 and 100 or
    (vat is not null and (vat<0 or vat>gross)) or paid is null or paid not in ('paid','unpaid') or kind is null or kind not in ('expense','refund') or
    coalesce(length(btrim(details->>'merchant')),0)=0 or details->>'documentDate' is null then raise exception 'Check expense details'; end if;
 if not exists(select 1 from public.record_categories where id=category and record_type='expense' and (user_id=auth.uid() or is_default)) then raise exception 'Choose an expense category'; end if;
 effective_date := case when paid='paid' then (details->>'paymentDate')::date else (details->>'documentDate')::date end;
 if effective_date is null then raise exception 'Add the actual payment date'; end if;
 cost := round(gross::numeric*allocation/100)/100;
 if kind='refund' then
   select * into original from public.financial_records where id=reversal and user_id=auth.uid() and record_type='expense' and expense_kind='expense' and status='approved' for update;
   if not found or paid<>'paid' or cost>original.amount then raise exception 'Link refund to its original approved expense'; end if;
   if cost + coalesce((select sum(amount) from public.financial_records where refund_of=reversal and status='approved' and id is distinct from evidence.record_id),0)>original.amount then raise exception 'Refunds exceed the original expense'; end if;
 end if;
 if evidence.record_id is not null then
   select * into target from public.financial_records where id=evidence.record_id and user_id=auth.uid() for update;
   if not found then raise exception 'Linked record no longer exists'; end if;
   if matched is not null and matched<>target.id then raise exception 'Receipt already linked to another record'; end if;
   -- An unchanged retry is read-only; corrections use the same record.
   if evidence.reviewed=details and target.status='approved' then return target.id; end if;
 elsif matched is not null then
   select * into target from public.financial_records where id=matched and user_id=auth.uid() and status='approved' and record_type='expense' for update;
   if not found then raise exception 'Matching expense not found'; end if;
 end if;
 if target.id is not null and target.source_type <> 'receipt_document' then
   if kind<>'expense' or target.expense_kind<>'expense' or target.amount<>cost or paid<>'paid' or abs(effective_date-target.record_date)>3 or target.currency<>'GBP' then
     raise exception 'Amount or date differs from the matching expense; correct it first';
   end if;
   if target.gross_pence is not null and (target.gross_pence<>gross or target.business_use_percent<>allocation) then raise exception 'Evidence conflicts with existing expense details'; end if;
   -- Evidence attachment enriches the existing record without creating a second cost.
   update public.financial_records set document_date=(details->>'documentDate')::date,
     payment_date=record_date, merchant=details->>'merchant',gross_pence=gross,vat_pence=vat,
     business_use_percent=allocation,payment_status='paid' where id=target.id;
   result_id := target.id;
 elsif target.id is not null then
   if target.source_reference <> attachment_id::text then raise exception 'Use the original receipt to correct this expense'; end if;
   update public.financial_records set record_date=effective_date,document_date=(details->>'documentDate')::date,
     payment_date=case when paid='paid' then effective_date else null end,merchant=details->>'merchant',
     description=details->>'merchant',amount=cost,gross_pence=gross,vat_pence=vat,business_use_percent=allocation,
     category_id=category,payment_status=paid,expense_kind=kind,refund_of=reversal,status='approved',approved_at=now()
     where id=target.id;
   result_id:=target.id;
 else
   insert into public.financial_records(user_id,record_type,record_date,document_date,payment_date,merchant,description,
     currency,amount,gross_pence,vat_pence,business_use_percent,category_id,payment_status,expense_kind,refund_of,source_type,source_reference,status,approved_at)
   values(auth.uid(),'expense',effective_date,(details->>'documentDate')::date,case when paid='paid' then effective_date else null end,
     details->>'merchant',details->>'merchant','GBP',cost,gross,vat,allocation,category,paid,kind,reversal,'receipt_document',attachment_id::text,'approved',now()) returning id into result_id;
 end if;
 update public.record_attachments set record_id=result_id,receipt_state='saved',reviewed=details,receipt_error=null where id=attachment_id and user_id=auth.uid();
 return result_id;
end $$;
revoke all on function public.confirm_receipt_document(uuid,jsonb) from public,anon;
grant execute on function public.confirm_receipt_document(uuid,jsonb) to authenticated;


