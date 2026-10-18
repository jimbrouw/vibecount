import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
test("reminder drafting uses partial outstanding cash and rejects revised invoice details or lost schedule claims", async (t) => {
  const secret = process.env.CRON_SECRET,
    from = process.env.RESEND_FROM_EMAIL;
  process.env.CRON_SECRET = "synthetic-only";
  process.env.RESEND_FROM_EMAIL = "synthetic@example.invalid";
  t.after(() => {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    if (from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = from;
  });
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    stdin: {
      resolveDir: root,
      contents: `export {POST} from './app/api/reminders/due/route.ts';export {fixture} from 'test:db';`,
    },
    plugins: [
      {
        name: "inert-reminder-draft",
        setup(builder) {
          builder.onResolve(
            { filter: /^(next\/server|@\/lib\/supabase\/admin|test:db)$/ },
            (args) => ({
              path:
                args.path === "@/lib/supabase/admin" ? "test:db" : args.path,
              namespace: "test",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            loader: "js",
            contents:
              args.path === "next/server"
                ? `export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),{...init,headers:{'content-type':'application/json'}})}}`
                : `
export const fixture={balanceError:false,lostClaim:false,balance:{currency:'GBP',updated_at:'scheduled-version',outstanding_pence:75000,credited_pence:0},invoice:{origin:'native_gbp',currency:'GBP',id:'invoice',user_id:'owner',client_id:'client',number:'SYNTHETIC-1000',amount:'1000.00',invoice_date:'2026-04-05',due_date:'2026-05-05',payment_terms:'30 days',reminder_schedule:{},updated_at:'scheduled-version',clients:{name:'Synthetic client',email:'customer@example.invalid'}},drafts:[],claims:[]};
export function createAdminClient(){return {rpc:async(name,args)=>{fixture.claims.push({name,args});if(fixture.lostClaim)return {error:{message:'Scheduled invoice changed'},data:null};fixture.drafts.push(args);return {error:null,data:'draft'}},from(table){let mutation=false;const result=()=>({data:table==='invoice_payment_balances'?fixture.balance:table==='invoices'?(mutation?(fixture.lostClaim?null:{updated_at:'stopped-version'}):[fixture.invoice]):table==='user_settings'?{legal_name:'Synthetic supplier',payment_link_url:''}:{id:'draft'},count:0,error:table==='invoice_payment_balances'&&fixture.balanceError?{}:null});const q={select(){return q},eq(key,value){if(mutation)fixture.claims.push({key,value});return q},is(){return q},not(){return q},lte(){return q},limit(){return q},update(){mutation=true;return q},insert(value){fixture.drafts.push(value);return q},maybeSingle:async()=>result(),single:async()=>result(),then(resolve){return Promise.resolve(result()).then(resolve)}};return q}}}
`,
          }));
        },
      },
    ],
  });
  const m = await import(
      "data:text/javascript;base64," +
        Buffer.from(bundle.outputFiles[0].text).toString("base64")
    ),
    f = m.fixture;
  const run = (authenticated = true) =>
    m.POST(
      new Request("http://localhost/api/reminders/due", {
        method: "POST",
        headers: authenticated
          ? { authorization: "Bearer synthetic-only" }
          : {},
      }),
    );
  assert.equal((await run(false)).status, 401);
  assert.equal((await run()).status, 200);
  assert.equal(f.drafts.length, 1);
  const native=structuredClone(f.invoice),drafts=f.drafts.length,claims=f.claims.length;
  for(const patch of [{origin:'preserved_external',currency:'USD',amount:null},{origin:'preserved_external',currency:'GBP'},{origin:undefined},{amount:null}]){
    f.invoice={...native,...patch};await run();assert.equal(f.drafts.length,drafts);assert.equal(f.claims.length,claims);
  }
  f.invoice=native;

  assert.match(
    f.drafts[0].p_message,
    /£750.00 \(seven hundred and fifty pounds\)/,
  );
  assert.doesNotMatch(f.drafts[0].p_message, /£1,000/);
  assert.equal(f.drafts[0].p_amount, 75000);
  assert.equal(f.drafts[0].p_updated_at, "scheduled-version");
  assert.equal(f.drafts[0].p_from, "synthetic@example.invalid");
  assert.equal(f.drafts[0].p_owner, "owner");
  assert.equal(f.claims[0].name,"create_due_reminder");
  f.balance.updated_at = "new-customer-version";
  const stale = await (await run()).json();
  assert.equal(stale.failed, 1);
  assert.equal(f.drafts.length, 1);
  f.balance.updated_at = "scheduled-version";
  f.lostClaim = true;
  const lost = await (await run()).json();
  assert.equal(lost.failed, 1);
  assert.equal(f.drafts.length, 1);
  f.lostClaim = false;
  f.balance.outstanding_pence = 0;
  const settled = await (await run()).json();
  assert.equal(settled.skipped, 1);
  assert.equal(f.drafts.length, 1);
  f.balanceError = true;
  assert.equal((await (await run()).json()).failed, 1);
  assert.equal(f.drafts.length, 1);
});
