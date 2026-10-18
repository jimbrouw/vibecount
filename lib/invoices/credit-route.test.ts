import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
test("credit API authenticates, requires review, rejects stale balances and recovers preserved evidence before mutable reads", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    stdin: {
      resolveDir: root,
      contents: `export {POST} from './app/api/reconciliation/credits/route.ts';export {fixture} from 'test:db';`,
    },
    plugins: [
      {
        name: "inert-credit-transport",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(next\/server|next\/cache|@\/lib\/supabase\/server|test:db|@\/lib\/invoices\/credit-pdf)$/,
            },
            (args) => ({
              path:
                args.path === "@/lib/supabase/server" ? "test:db" : args.path,
              namespace: "test",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            loader: "js",
            contents:
              args.path === "next/server"
                ? `export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),{...init,headers:{'content-type':'application/json'}})}}`
                : args.path === "next/cache"
                  ? `export function revalidatePath(){}`
                  : args.path === "@/lib/invoices/credit-pdf"
                    ? `import {fixture} from 'test:db';export async function createCreditPdf(data){fixture.documents.push(data);return new TextEncoder().encode('Synthetic immutable credit PDF')}`
                    : `
export const fixture={signedIn:true,prior:null,balanceError:false,failUpload:false,failSave:false,uploads:[],rpc:[],documents:[],reads:[],balance:{id:'22222222-2222-4222-8222-222222222222',number:'SYNTHETIC-120',invoice_date:'2026-04-05',description:'Synthetic work',status:'finalised',currency:'GBP',updated_at:'2026-04-05',invoice_pence:12000,allocated_pence:12000,outstanding_pence:0,credited_pence:0,entitlement_pence:12000,refund_due_pence:0,net_pence:10000,vat_pence:2000,credited_net_pence:0,credited_vat_pence:0,vat_rate_bps:2000,vat_number_snapshot:'GB-SYNTHETIC',economics_version:1,balance_stamp:'a'.repeat(32),next_ordinal:1}};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'11111111-1111-4111-8111-111111111111'}:null},error:null})},from(table){fixture.reads.push(table);const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='invoice_credit_notes'?fixture.prior:fixture.balance,error:table==='invoice_credit_choices'&&fixture.balanceError?{}:null})};return q},storage:{from(){return {upload:async(path,bytes,options)=>{fixture.uploads.push({path,options});return {error:fixture.failUpload?{}:null}},download:async()=>({data:new Blob(['Synthetic immutable credit PDF']),error:null})}}},rpc:async(name,args)=>{fixture.rpc.push({name,args});return {error:fixture.failSave?{}:null}}}}
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
  const body = {
    invoiceId: f.balance.id,
    requestId: "33333333-3333-4333-8333-333333333333",
    stamp: f.balance.balance_stamp,
    amount: "30.00",
    creditDate: "2026-04-06",
    reason: "Reviewed credit",
    sellerName: "Synthetic supplier",
    sellerAddress: "",
    clientName: "Synthetic client",
    clientAddress: "",
    humanConfirmed: true,
  };
  const post = (patch = {}) =>
    m.POST(
      new Request("http://localhost/api/reconciliation/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, ...patch }),
      }),
    );
  f.signedIn = false;
  assert.equal((await post()).status, 401);
  f.signedIn = true;
  assert.equal((await post({ humanConfirmed: false })).status, 400);
  assert.equal((await post({ stamp: "c".repeat(32) })).status, 409);
  assert.equal(f.uploads.length, 0);
  assert.equal((await post({ amount: "30.001" })).status, 400);
  f.failUpload = true;
  assert.equal((await post()).status, 503);
  assert.equal(f.rpc.length, 0);
  f.failUpload = false;
  f.failSave = true;
  assert.equal((await post()).status, 409);
  f.failSave = false;
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  const args = f.rpc.at(-1).args;
  assert.equal(args.p_gross, 3000);
  assert.equal(args.p_document.netPence, 2500);
  assert.equal(args.p_document.vatPence, 500);
  assert.equal(args.p_document.vatRateBps, 2000);
  assert.ok(
    f.uploads.every(
      (u: { options: { upsert: boolean } }) => u.options.upsert === false,
    ),
  );
  f.prior = {
    document_snapshot: args.p_document,
    pdf_path: args.p_pdf_path,
    pdf_sha256: createHash("sha256")
      .update("Synthetic immutable credit PDF")
      .digest("hex"),
  };
  f.balanceError = true;
  f.reads = [];
  const writes = f.rpc.length;
  assert.equal((await post()).status, 200);
  assert.deepEqual(f.reads, ["invoice_credit_notes"]);
  assert.equal(f.rpc.length, writes);
  assert.equal((await post({ reason: "Changed payload" })).status, 409);
  f.prior.pdf_sha256 = "d".repeat(64);
  assert.equal((await post()).status, 503);
  f.prior = null;
  f.balanceError = false;
  f.balance.net_pence = null;
  f.balance.vat_pence = null;
  f.balance.economics_version = 0;
  const previous = f.uploads.length;
  assert.equal((await post()).status, 400);
  assert.equal(f.uploads.length, previous);
  assert.equal((await post({ unknownVatAcknowledged: true })).status, 200);
  assert.equal(f.rpc.at(-1).args.p_document.taxStatus, "unverified");
  assert.equal(f.rpc.at(-1).args.p_document.vatRateBps, null);
});
