// Actual predecessor draft capture, synthetic metadata and disposable database only.
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { canonicalJson, prepareCalculation, type SavedCalculation } from '../tax/snapshot';
import { buildFilingPack, type FilingPackInput, type SavedFilingPack } from '../tax/filing-pack';
import type { CalculationInput } from '../tax/calculation';
export async function taxCurrencyFixture(db: PGlite) {
  const owner = randomUUID(), other = randomUUID(), client = randomUUID(), invoice = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query("insert into clients(id,user_id,name) values($1,$2,'PRIVATE_CLIENT')", [client, owner]);
  await db.query("insert into invoices(id,user_id,client_id,number,description,status,amount,invoice_date) values($1,$2,$3,'PRIVATE_REFERENCE','PRIVATE_DESCRIPTION','finalised',120,'2025-08-01')", [invoice, owner, client]);
  await db.query("insert into invoices(user_id,client_id,number,description,amount) values($1,$2,'PRIVATE_DRAFT','Synthetic unfinalised',0)", [owner, client]);
  const auth = async (id = owner) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); };
  const service = async () => { await db.exec('reset role;set role service_role'); };
  const input = async (year = 2025) => { await auth(); return (await db.query<{ r: CalculationInput }>('select read_tax_calculation_input($1) r', [year])).rows[0].r; };
  const before = prepareCalculation(await input());
  const calculationArgs = [owner, 2025, before.inputJson, before.resultJson, before.rulesJson, 'Synthetic incomplete draft', randomUUID()];
  await service();
  const calculation = (await db.query<{ r: string }>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r', calculationArgs)).rows[0].r;
  const packInput = async (id = calculation) => { await auth(); return (await db.query<{ r: FilingPackInput }>('select read_tax_filing_pack_input($1) r', [id])).rows[0].r; };
  const oldPackInput = await packInput(), request = randomUUID(), bundle = buildFilingPack(oldPackInput, [], request, false);
  const packArgs = [owner, calculation, canonicalJson(oldPackInput), canonicalJson(bundle), 'Synthetic incomplete pack', request];
  await service(); const pack = (await db.query<{ r: string }>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r', packArgs)).rows[0].r;
  await auth();
  const oldCalculation = (await db.query<SavedCalculation>('select * from tax_calculations where id=$1', [calculation])).rows[0];
  const oldPack = (await db.query<SavedFilingPack>('select * from filing_packs where id=$1', [pack])).rows[0];
  return { owner, other, client, invoice, auth, service, input, packInput, before, calculationArgs, calculation, packArgs, pack, oldCalculation, oldPack };
}
