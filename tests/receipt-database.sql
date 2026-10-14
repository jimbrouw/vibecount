-- Run through the authenticated database management connection. Everything rolls back.
-- These are synthetic Auth rows and JWT contexts, not real browser sign-ins.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','receipt-rollback-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','receipt-rollback-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.record_categories(id,user_id,name,record_type,is_default) values
 ('20000000-0000-4000-8000-000000000001',auth.uid(),'VIBECOUNT TEST ONLY office','expense',false);
insert into public.record_attachments(id,user_id,object_path,original_filename,content_type,size_bytes,content_hash,receipt_state) values
 ('30000000-0000-4000-8000-000000000001',auth.uid(),auth.uid()||'/receipts/test.pdf','VIBECOUNT TEST ONLY.pdf','application/pdf',100,'test-hash','review'),
 ('30000000-0000-4000-8000-000000000002',auth.uid(),auth.uid()||'/receipts/unpaid.pdf','VIBECOUNT TEST ONLY unpaid.pdf','application/pdf',100,'test-unpaid-hash','review'),
 ('30000000-0000-4000-8000-000000000003',auth.uid(),auth.uid()||'/receipts/match.pdf','VIBECOUNT TEST ONLY match.pdf','application/pdf',100,'test-match-hash','review'),
 ('30000000-0000-4000-8000-000000000004',auth.uid(),auth.uid()||'/receipts/refund.pdf','VIBECOUNT TEST ONLY refund.pdf','application/pdf',100,'test-refund-hash','review');
do $$
declare d jsonb; r uuid; repeated uuid; bank uuid; reversal uuid; n numeric; total_rows integer;
begin
 d := jsonb_build_object('merchant','VIBECOUNT TEST ONLY merchant','documentDate','2026-04-05','paymentDate','2026-04-06','paymentStatus','paid',
 'currency','GBP','grossPence',12000,'vatPence',2000,'businessUsePercent',50,'categoryId','20000000-0000-4000-8000-000000000001','kind','expense','amountConfirmed',true);
 r := public.confirm_receipt_document('30000000-0000-4000-8000-000000000001',d);
 repeated := public.confirm_receipt_document('30000000-0000-4000-8000-000000000001',d);
 if r<>repeated or (select count(*) from public.financial_records)<>1 then raise exception 'Duplicate confirmation failed'; end if;
 if not exists(select 1 from public.financial_records where id=r and amount=60 and document_date='2026-04-05' and payment_date='2026-04-06' and tax_year_start=2026) then raise exception 'Payment year or allocation incorrect'; end if;
 if (select count(*) from public.financial_record_changes where record_id=r)<>1 then raise exception 'Idempotent retry wrote an audit update'; end if;
 -- Correction preserves record ID and audit history; moving actual payment to 5 April changes year.
 repeated:=public.confirm_receipt_document('30000000-0000-4000-8000-000000000001',d||'{"paymentDate":"2026-04-05"}');
 if r<>repeated or not exists(select 1 from public.financial_records where id=r and tax_year_start=2025) then raise exception 'Correction/year failed'; end if;
 perform public.confirm_receipt_document('30000000-0000-4000-8000-000000000001',d);
 if (select count(*) from public.financial_record_changes where record_id=r)<>3 then raise exception 'Correction history missing'; end if;
 begin
   perform public.confirm_receipt_document('30000000-0000-4000-8000-000000000001',d||'{"currency":"EUR"}');
   raise exception 'FOREIGN CURRENCY ACCEPTED';
 exception when raise_exception then if sqlerrm='FOREIGN CURRENCY ACCEPTED' then raise; end if; end;
 begin
   perform public.confirm_receipt_document('30000000-0000-4000-8000-000000000001',d-'amountConfirmed');
   raise exception 'AMOUNT CHECK BYPASSED';
 exception when raise_exception then if sqlerrm='AMOUNT CHECK BYPASSED' then raise; end if; end;
 perform public.confirm_receipt_document('30000000-0000-4000-8000-000000000002',d||'{"paymentStatus":"unpaid","paymentDate":null}');
 select sum(expense_total) into n from public.financial_record_quarter_summaries;
 if n<>60 then raise exception 'Unpaid counted in totals'; end if;
 insert into public.financial_records(user_id,record_type,record_date,description,amount,category_id,source_type,status)
 values(auth.uid(),'expense','2026-04-06','VIBECOUNT TEST ONLY bank fixture',120,'20000000-0000-4000-8000-000000000001','bank_statement_pdf','approved') returning id into bank;
 select count(*) into total_rows from public.financial_records;
 repeated:=public.confirm_receipt_document('30000000-0000-4000-8000-000000000003',d||jsonb_build_object('businessUsePercent',100,'matchRecordId',bank));
 if bank<>repeated or (select count(*) from public.financial_records)<>total_rows then raise exception 'Evidence matching added another expense'; end if;
 reversal:=public.confirm_receipt_document('30000000-0000-4000-8000-000000000004',d||jsonb_build_object('grossPence',2400,'vatPence',400,'kind','refund','refundOf',r));
 select sum(expense_total) into n from public.financial_record_quarter_summaries;
 if n<>168 then raise exception 'Refund total incorrect: %',n; end if;
 perform public.confirm_receipt_document('30000000-0000-4000-8000-000000000003',d||jsonb_build_object('businessUsePercent',50,'matchRecordId',bank));
 select sum(expense_total) into n from public.financial_record_quarter_summaries;
 if n<>108 then raise exception 'Mixed bank allocation/correction incorrect: %',n; end if;
 if (select sum(reporting_amount) from public.financial_record_reporting where record_type='expense')<>n then raise exception 'Reporting sources differ'; end if;
 begin
  insert into public.record_attachments(user_id,object_path,original_filename,content_type,size_bytes,content_hash,receipt_state)
  values(auth.uid(),auth.uid()||'/receipts/duplicate.pdf','VIBECOUNT TEST ONLY duplicate.pdf','application/pdf',100,'test-hash','review');
  raise exception 'DUPLICATE HASH ACCEPTED';
 exception when unique_violation then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
begin
 if (select count(*) from public.record_attachments)<>0 or (select count(*) from public.financial_record_reporting)<>0 or (select count(*) from public.financial_record_changes)<>0 then raise exception 'Cross-user read leak'; end if;
 begin
  perform public.confirm_receipt_document('30000000-0000-4000-8000-000000000001','{}');
  raise exception 'CROSS USER CONFIRM ACCEPTED';
 exception when raise_exception then if sqlerrm='CROSS USER CONFIRM ACCEPTED' then raise; end if; end;
 begin
  insert into public.record_attachments(user_id,object_path,original_filename,content_type,size_bytes,receipt_state)
  values('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001/receipts/forged.pdf','VIBECOUNT TEST ONLY forged.pdf','application/pdf',100,'review');
  raise exception 'CROSS USER INSERT ACCEPTED';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: idempotency, correction history, payment tax-year boundaries, mixed use, unpaid, foreign currency, confirmation gate, evidence match, refunds, duplicate hash, owner isolation. Rolled back.' as result;
rollback;
