// Synthetic predecessor history only; never uses a hosted database or actual balances.
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { financeFixture } from '../finance/test-fixture';
import { londonPlanningDate } from '../finance/defaults';
import { prepareFinancePlan } from '../finance/snapshot';
import type { PlanRevision, PlanContext } from '../finance/server';
export async function financeCurrencyFixture(db: PGlite) {
  const owner = randomUUID(), other = randomUUID(), client = randomUUID(), bank = randomUUID(), document = randomUUID(), today = londonPlanningDate();
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query("insert into clients(id,user_id,name) values($1,$2,'PRIVATE_CLIENT')", [client, owner]);
  await db.query("insert into invoices(user_id,client_id,number,description,amount,status) values($1,$2,'PRIVATE_NATIVE','PRIVATE_DESCRIPTION',120,'finalised'),($1,$2,'PRIVATE_DRAFT','Synthetic draft',0,'draft')", [owner, client]);
  await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,masked_identifier) values($1,$2,'Synthetic reviewed bank','starling','bank','1234')", [bank, owner]);
  await db.query("insert into evidence_documents(id,user_id,file_hash,media_type,size_bytes,object_path,key_id) values($1,$2,$3,'application/pdf',100,'PRIVATE_EVIDENCE_PATH','SYNTHETIC_KEY')", [document, owner, 'a'.repeat(64)]);
  const catalog = { accounts: [{ id: bank, user_id: owner, label: 'Synthetic reviewed bank', provider: 'starling', account_type: 'bank', currency: 'GBP', masked_identifier: '1234' }], documents: [{ id: document, user_id: owner, file_sha256: 'a'.repeat(64), media_type: 'application/pdf', size_bytes: 100 }] };
  const plan = financeFixture(today); plan.assets[0].account_id = bank; plan.assets[0].document_id = document;
  const auth = async (id = owner) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); };
  const service = async () => { await db.exec('reset role;set role service_role'); };
  await auth();
  const beforeContext = (await db.query<{ c: { owner_id: string; ordinal: number; stamp: string } }>('select read_finance_plan_context() c')).rows[0].c;
  const legacy = prepareFinancePlan(owner, plan, today, catalog), args = [owner, beforeContext.ordinal, beforeContext.stamp, legacy.inputJson, legacy.resultJson, legacy.rulesJson, 'Synthetic retained draft', randomUUID()];
  await service(); const id = (await db.query<{ r: string }>('select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) r', args)).rows[0].r;
  await auth(); const old = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [id])).rows[0];
  const context = async () => { await auth(); return (await db.query<{ c: PlanContext }>('select read_finance_plan_context() c')).rows[0].c; };
  return { owner, other, client, bank, document, today, catalog, plan, auth, service, beforeContext, legacy, args, id, old, context };
}
