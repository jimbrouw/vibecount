-- Match gross bank charges before allocating the business share; corrections keep one record.
create or replace function public.confirm_receipt_document(attachment_id uuid, details jsonb)
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
   if kind<>'expense' or target.expense_kind<>'expense' or (target.amount<>cost and target.amount<>gross::numeric/100 and evidence.record_id is null) or paid<>'paid' or abs(effective_date-target.record_date)>3 or target.currency<>'GBP' then
     raise exception 'Amount or date differs from the matching expense; correct it first';
   end if;
   if target.gross_pence is not null and (target.gross_pence<>gross or (evidence.record_id is null and target.business_use_percent<>allocation)) then raise exception 'Evidence conflicts with existing expense details'; end if;
   -- Evidence attachment enriches the existing record without creating a second cost.
   update public.financial_records set document_date=(details->>'documentDate')::date,
     record_date=effective_date,payment_date=effective_date, merchant=details->>'merchant',gross_pence=gross,vat_pence=vat,amount=cost,category_id=category,
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


