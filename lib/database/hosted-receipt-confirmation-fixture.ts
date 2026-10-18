import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';

/** Exercise the captured human-confirmation RPC only in a disposable transaction. */
export async function verifyHostedReceiptConfirmation(db:PGlite){
 await db.exec('begin');
 try{
  const owner=randomUUID();await db.query('insert into auth.users(id) values($1)',[owner]);
  const category=(await db.query<{id:string}>("select id from record_categories where record_type='expense' and is_default order by id limit 1")).rows[0].id;
  const attachment=async()=>{const id=randomUUID();await db.query("insert into record_attachments(id,user_id,object_path,original_filename,content_type,size_bytes,receipt_state) values($1,$2,$3,'synthetic-receipt.pdf','application/pdf',100,'review')",[id,owner,owner+'/'+id]);return id};
  const originalAttachment=await attachment(),refundAttachment=await attachment(),matchedAttachment=await attachment();
  const manual=randomUUID();await db.query("insert into financial_records(id,user_id,record_type,record_date,description,amount,category_id,status) values($1,$2,'expense','2025-08-01','Synthetic manual cost',10,$3,'approved')",[manual,owner,category]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);await db.exec('set local role authenticated');
  const details={amountConfirmed:true,currency:'GBP',grossPence:63029,vatPence:null,businessUsePercent:30,categoryId:category,matchRecordId:null,refundOf:null,paymentStatus:'paid',kind:'expense',merchant:'Synthetic repair',documentDate:'2025-08-01',paymentDate:'2025-08-01'};
  const confirm=async(id:string,d:unknown)=>(await db.query<{id:string}>('select confirm_receipt_document($1,$2::jsonb) id',[id,JSON.stringify(d)])).rows[0].id;
  // Savepoints keep intentionally rejected calls from aborting the fixture.
  const reject=async(fn:()=>Promise<unknown>,pattern:RegExp)=>{await db.exec('savepoint rejected');await assert.rejects(fn(),pattern);await db.exec('rollback to savepoint rejected;release savepoint rejected')};
  await reject(()=>confirm(originalAttachment,{...details,amountConfirmed:false}),/Check amount/);
  const original=await confirm(originalAttachment,details);
  assert.equal(await confirm(originalAttachment,details),original,'Exact retries reuse the approved record');
  const row=(await db.query<{amount:string}>('select amount from financial_records where id=$1',[original])).rows[0];
  assert.equal(Number(row.amount),189.09,'Business allocation is rounded once at confirmation');
  const refundDetails={...details,grossPence:1000,businessUsePercent:100,kind:'refund',refundOf:original};
  const refund=await confirm(refundAttachment,refundDetails);
  assert.equal(Number((await db.query<{p:number}>('select cash_effect_pence(f) p from financial_records f where id=$1',[refund])).rows[0].p),-1000);
  await reject(()=>confirm(originalAttachment,{...details,grossPence:500}),/refund/i);
  await reject(()=>confirm(originalAttachment,{...details,paymentStatus:'unpaid',paymentDate:null}),/refund/i);
  assert.equal(Number((await db.query<{amount:string}>('select amount from financial_records where id=$1',[original])).rows[0].amount),189.09,'Rejected corrections preserve the approved original');
  await reject(()=>confirm(refundAttachment,{...refundDetails,grossPence:20000}),/Refunds|original approved/);
  await reject(()=>db.query('update financial_records set amount=200,gross_pence=20000 where id=$1',[refund]),/Refunds/);
  await reject(()=>db.query("update financial_records set status='excluded' where id=$1",[original]),/linked refunds/);
  await db.query("update financial_records set status='excluded' where id=$1",[refund]);
  assert.equal(await confirm(originalAttachment,{...details,grossPence:500}),original,'After explicit refund exclusion, original correction can proceed');
  assert.equal(Number((await db.query<{amount:string}>('select amount from financial_records where id=$1',[original])).rows[0].amount),1.5);

  assert.equal(await confirm(matchedAttachment,{...details,grossPence:1000,businessUsePercent:50,matchRecordId:manual}),manual,'Matching an existing manual cost reuses its record');
  assert.equal(Number((await db.query<{amount:string}>('select amount from financial_records where id=$1',[manual])).rows[0].amount),5,'Explicit mixed-use confirmation applies allocation once');
  assert.equal((await db.query('select id from financial_records')).rows.length,3,'Receipt matching does not create a duplicate cost');
  const other=randomUUID();await db.exec('reset role');await db.query('insert into auth.users(id) values($1)',[other]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);await db.exec('set local role authenticated');
  await reject(()=>confirm(originalAttachment,details),/Receipt not found/);
 }finally{await db.exec('rollback;reset role')}
}
