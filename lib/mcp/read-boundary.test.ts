import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
let sequence = 0;
async function harness() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', stdin: { resolveDir: root, contents: `
export {GET as invoices} from './app/api/mcp/tools/list-invoices/route.ts';
export {GET as expenses} from './app/api/mcp/tools/list-expenses/route.ts';
export {GET as uncategorised} from './app/api/mcp/tools/list-uncategorised/route.ts';
export {GET as summary} from './app/api/mcp/tools/get-pl-summary/route.ts';
export {logAgentAction as actualLog} from './lib/mcp/auth.ts';
export {fixture} from 'test:fixture';` }, plugins: [{ name: 'inert-parked-read', setup(b) {
    b.onResolve({ filter: /^(next\/server|@\/lib\/supabase\/admin|@\/lib\/mcp\/auth|test:fixture)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/server' ? 'export class NextResponse extends Response {static json(body,init){return new Response(JSON.stringify(body),init)}}' : a.path === '@/lib/mcp/auth' ? `import {fixture} from 'test:fixture';export async function validateAgentToken(header,scope){fixture.auth.push({header,scope});return fixture.denied?{ok:false,status:403,error:'Denied'}:{ok:true,session:{id:'session',user_id:'owner'}}}export async function logAgentAction(input){fixture.audit.push(input);if(fixture.auditThrows)throw new Error('PRIVATE_AUDIT');return !fixture.auditFails;}` : a.path === '@/lib/supabase/admin' ? `import {fixture} from 'test:fixture';export function createAdminClient(){if(fixture.noDb)return null;return{from(table){let columns,options,filters=[],limit,values;const q={select(c,o){columns=c;options=o;return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},order(){return q},limit(n){limit=n;return q},insert(v){values=v;return q},then(resolve,reject){fixture.reads.push({table,columns,options,filters,limit,values});if(fixture.queryThrows)return Promise.reject(new Error('PRIVATE_DATABASE')).then(resolve,reject);const data=table==='invoices'?fixture.invoices:table==='financial_records'?fixture.records:table==='financial_record_quarter_summaries'?fixture.quarters:[];return Promise.resolve({data:fixture.missing?null:data,error:fixture.queryFails?{message:'PRIVATE_QUERY'}:null,count:fixture.countOverride===undefined?data.length:fixture.countOverride}).then(resolve,reject)}};return q}}}` : `
export const fixture={denied:false,noDb:false,queryFails:false,queryThrows:false,missing:false,auditFails:false,auditThrows:false,auth:[],audit:[],reads:[],countOverride:undefined,
invoices:[{id:'invoice',user_id:'owner',status:'finalised',origin:'native_gbp',currency:'GBP',amount:'123.45',original_total_minor:null,currency_ruleset_id:null,source_fact_revision_id:null,source_fact_family_id:null,number:'INV-1',invoice_date:'2026-04-05',due_date:null,delivery_status:'draft',paid_at:null,clients:{name:'Client',user_id:'owner'}}],
records:[{id:'record',user_id:'owner',record_type:'expense',status:'approved',record_date:'2026-04-05',description:'Synthetic purchase',amount:'30.01',effect_sign:1,record_categories:{name:'Software',user_id:null,is_default:true}}],
quarters:[{user_id:'owner',tax_year_start:new Date().getUTCMonth()>3||new Date().getUTCMonth()===3&&new Date().getUTCDate()>=6?new Date().getUTCFullYear():new Date().getUTCFullYear()-1,tax_quarter:1,income_total:'100.01',expense_total:'-30.01',net_total:'130.02',income_count:1,expense_count:1}]};` }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n// fixture ' + ++sequence).toString('base64'));
}
const request = (query = '') => new Request('https://example.invalid/parked' + query, { headers: { Authorization: 'Bearer synthetic' } });
test('parked native invoice read retains wire values, exact pennies, owned joins and bounded query', async () => {
  const m = await harness(), f = m.fixture, response = await m.invoices(request('?status=finalised&limit=3'));
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(await response.json(), { invoices: [{ id: 'invoice', number: 'INV-1', invoice_date: '2026-04-05', due_date: null, amount_pence: 12345, status: 'finalised', delivery_status: 'draft', paid: false, client: 'Client' }], count: 1 });
  assert.deepEqual(f.reads[0].filters, [['user_id', 'owner'], ['status', 'finalised']]); assert.equal(f.reads[0].limit, 3);
  assert.match(f.reads[0].columns, /origin,currency,amount,original_total_minor/); assert.equal(f.audit.length, 1);
  f.invoices[0].amount = '0.00'; f.invoices[0].status = 'draft'; f.invoices[0].clients = [{ name: 'Owned', user_id: 'owner' }];
  assert.equal((await (await m.invoices(request())).json()).invoices[0].amount_pence, 0);
});
test('unsupported external GBP and foreign, incomplete native identity, precision, foreign and duplicate rows withhold all invoices', async () => {
  for (const change of ['GBP', 'USD', 'JPY', 'KWD', 'missing', 'null', 'contradictory', 'precision', 'overflow', 'foreign', 'join', 'duplicate']) {
    const m = await harness(), f = m.fixture, r = f.invoices[0];
    if (['GBP', 'USD', 'JPY', 'KWD'].includes(change)) Object.assign(r, { origin: 'preserved_external', currency: change, amount: null, original_total_minor: 10001, currency_ruleset_id: 'vibecount-currencies/1', source_fact_revision_id: '11111111-1111-4111-8111-111111111111', source_fact_family_id: '22222222-2222-4222-8222-222222222222' });
    if (change === 'missing') delete r.origin; if (change === 'null') r.amount = null; if (change === 'contradictory') r.original_total_minor = 1;
    if (change === 'precision') r.amount = '1.001'; if (change === 'overflow') r.amount = '900719925474099.99'; if (change === 'foreign') r.user_id = 'other'; if (change === 'join') r.clients.user_id = 'other'; if (change === 'duplicate') f.invoices.push({ ...r });
    const response = await m.invoices(request()); assert.equal(response.status, 503, change); assert.doesNotMatch(await response.text(), /INV-1|12345|invoices":/); assert.equal(f.audit.length, 0);
  }
});
test('signed recognised GBP refunds reduce expenses and retain uncategorised statuses without raw bank numbers', async () => {
  const m = await harness(), f = m.fixture, r = f.records[0]; r.effect_sign = -1; r.description = 'Refund 12345678';
  const response = await m.expenses(request()); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.expenses[0].amount_pence, -3001); assert.doesNotMatch(body.expenses[0].description, /12345678/); assert.equal(body.expenses[0].category, 'Software');
  assert.match(f.reads[0].columns, /effect_sign/);
  r.status = 'review'; r.record_type = 'income';
  const uncategorised = await m.uncategorised(request()); assert.equal(uncategorised.status, 200); assert.equal((await uncategorised.json()).records[0].amount_pence, -3001);
});
test('invalid record signs, missing/negative/unsafe magnitudes and foreign related metadata never become valid effects', async () => {
  for (const change of ['sign', 'missing', 'negative', 'precision', 'overflow', 'owner', 'category', 'status']) {
    const m = await harness(), f = m.fixture, r = f.records[0];
    if (change === 'sign') r.effect_sign = 0; if (change === 'missing') delete r.effect_sign; if (change === 'negative') r.amount = '-1.00'; if (change === 'precision') r.amount = '1.001'; if (change === 'overflow') r.amount = '900719925474099.99'; if (change === 'owner') r.user_id = 'other'; if (change === 'category') Object.assign(r.record_categories, { user_id: 'other', is_default: false }); if (change === 'status') r.status = 'excluded';
    assert.equal((await m.expenses(request())).status, 503, change); assert.equal(f.audit.length, 0);
  }
});
test('profit summary retains exact signed view arithmetic and rejects incomplete, duplicate or malformed quarters', async () => {
  const m = await harness(), f = m.fixture, response = await m.summary(request()); assert.equal(response.status, 200);
  const body = await response.json(); assert.deepEqual(body.quarters, [{ quarter: 1, income_pence: 10001, expense_pence: -3001, net_profit_pence: 13002, record_count: 2 }]); assert.match(body.caveat, /estimates/);
  assert.deepEqual(f.reads[0].options, { count: 'exact' });
  for (const change of ['null', 'precision', 'net', 'count', 'quarter', 'duplicate', 'owner', 'year', 'truncated']) {
    const n = await harness(), q = n.fixture.quarters[0];
    if (change === 'null') q.income_total = null; if (change === 'precision') q.income_total = '1.001'; if (change === 'net') q.net_total = '0.00'; if (change === 'count') q.income_count = -1; if (change === 'quarter') q.tax_quarter = 5; if (change === 'duplicate') n.fixture.quarters.push({ ...q }); if (change === 'owner') q.user_id = 'other'; if (change === 'year') q.tax_year_start--; if (change === 'truncated') n.fixture.countOverride = 4;
    assert.equal((await n.summary(request())).status, 503, change);
  }
});
test('all parked reads deny auth, missing/error reads and failed audit rather than empty success', async () => {
  for (const route of ['invoices', 'expenses', 'uncategorised', 'summary']) {
    for (const failure of ['denied', 'noDb', 'queryFails', 'queryThrows', 'missing', 'auditFails', 'auditThrows']) {
      const m = await harness(); m.fixture[failure] = true;
      const response = await m[route](request()); assert.equal(response.status, failure === 'denied' ? 403 : 503, route + failure); assert.doesNotMatch(await response.text(), /PRIVATE_|INV-1|Synthetic purchase/);
      if (failure === 'denied') assert.equal(m.fixture.reads.length, 0);
    }
    const m = await harness(); m.fixture.invoices = []; m.fixture.records = []; m.fixture.quarters = [];
    assert.equal((await m[route](request())).status, 200, 'genuine empty ' + route);
  }
});
test('invalid list bounds/status reject before querying, and audit helper reports actual insert failure', async () => {
  for (const route of ['invoices', 'expenses']) for (const query of ['?limit=0', '?limit=-1', '?limit=1.5', '?limit=NaN', '?limit=Infinity', '?limit=101', '?limit=1&limit=2', ...(route === 'invoices' ? ['?status=paid', '?status=', '?status=draft&status=finalised'] : [])]) {
    const m = await harness(); assert.equal((await m[route](request(query))).status, 400, query); assert.equal(m.fixture.reads.length, 0);
  }
  const m = await harness(), input = { userId: 'owner', sessionId: 'session', tool: 'list_invoices', scopeUsed: 'read:invoices', paramsSummary: 'bounded', resultStatus: 'ok' };
  assert.equal(await m.actualLog(input), true); m.fixture.queryFails = true; assert.equal(await m.actualLog(input), false); m.fixture.noDb = true; assert.equal(await m.actualLog(input), false);
});
