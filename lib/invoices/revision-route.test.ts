import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { invoiceDefaults, invoiceSellerReview } from "../settings-public.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function harness() {
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    stdin: {
      resolveDir: root,
      contents: `export {POST} from './app/api/invoices/pdf/route.ts';export {GET as download} from './app/api/invoices/download/route.ts';export {GET as share} from './app/api/invoices/share-url/route.ts';export {fixture} from 'test:db';`,
    },
    plugins: [
      {
        name: "inert-invoice-transport",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(next\/server|@\/lib\/supabase\/server|test:db|@\/lib\/invoices\/pdf|@\/lib\/pdf\/settings-branding)$/,
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
                ? `export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),{...init,headers:{'content-type':'application/json'}})}static redirect(url){return new Response(null,{status:307,headers:{location:url}})}}`
                : args.path === "@/lib/invoices/pdf"
                  ? `import {fixture} from 'test:db';export async function createInvoicePdf(data){fixture.renders.push(data);return new TextEncoder().encode('Synthetic immutable PDF')}`
                  : args.path === "@/lib/pdf/settings-branding"
                    ? `export async function loadPdfBranding(){return {primaryColor:'',accentColor:''}}`
                    : `
 export const fixture={signedIn:true,existing:null,prior:null,credits:[],settings:{vat_registered:true,vat_rate:20,vat_number:'GB-SYNTHETIC',invoice_number_prefix:'DEMO'},uploads:[],renders:[],rpc:[],failUpload:false,failSave:false};
 export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid'}:null},error:null})},from(table){const result=()=>({data:table==='invoices'?fixture.existing:table==='user_settings'?fixture.settings:table==='invoice_revisions'?fixture.prior:table==='invoice_credit_notes'?fixture.credits:table==='invoice_settlements'?[]:[{id:'client',name:'Synthetic client',email:'',address:'',company_number:'',vat_number:''}],count:0,error:null});const q={select(){return q},limit(){return q},eq(){return q},update(){return q},insert(){return q},single:async()=>result(),maybeSingle:async()=>result(),then(resolve){return Promise.resolve(result()).then(resolve)}};return q},storage:{from(){return {upload:async(path,bytes,options)=>{fixture.uploads.push({path,options,bytes:[...bytes]});return {error:fixture.failUpload?{message:'synthetic failure'}:null}},download:async()=>({data:new Blob(['Synthetic immutable PDF']),error:null}),createSignedUrl:async(path)=>({data:{signedUrl:'https://synthetic.invalid/'+path},error:null})}}},rpc:async(name,args)=>{fixture.rpc.push({name,args});return {data:{id:args.p_invoice,updated_at:'2026-01-02T00:00:00Z'},error:fixture.failSave?{code:'P0001'}:null}}}}`,
          }));
        },
      },
    ],
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text).toString("base64")
  );
}

test("invoice API calculates saved VAT server-side, preserves before publishing, and fails closed", async () => {
  const m = await harness(),
    f = m.fixture;
  const body = {
    humanConfirmed: true,
    invoiceId: "ABCDEFAB-2222-4222-8222-222222222222",
    revisionId: "33333333-3333-4333-8333-333333333333",
    clientName: "Synthetic client",
    invoiceDate: "05/04/2026",
    description: "Synthetic work",
    amount: "100.00",
    paymentTerms: "30 days",
    vatEnabled: true,
    vatPence: 2000,
    vatRate: "20",
    vatNumber: "GB-SYNTHETIC",
    reason: "Original invoice",
    sellerReview: invoiceSellerReview(invoiceDefaults(f.settings)),
    expectedUpdated: null as string | null,
  };
  const post = (patch = {}) =>
    m.POST(
      new Request("http://localhost/api/invoices/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, ...patch }),
      }),
    );
  f.signedIn = false;
  assert.equal((await post()).status, 401);
  f.signedIn = true;
  assert.equal((await post({ humanConfirmed: false })).status, 400);
  assert.equal((await post({invoiceId:[body.invoiceId]})).status,400);assert.equal((await post({revisionId:[body.revisionId]})).status,400);
  for (const vat of [-1, 1.5, 999999])
    assert.equal((await post({ vatPence: vat })).status, 409);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.rpc.length, 0);
  const ok = await post();
  assert.equal(ok.status, 200);
  assert.equal(f.uploads[0].options.upsert, false);
  assert.equal(f.rpc[0].name, "save_invoice_revision");
  assert.equal(f.rpc[0].args.p_data.net_pence, 10000);
  assert.equal(f.rpc[0].args.p_data.vat_pence, 2000);
  assert.match(f.rpc[0].args.p_pdf_sha256, /^[a-f0-9]{64}$/);
  assert.equal(f.renders[0].amountPence, 10000);
  assert.equal(f.renders[0].vatPence, 2000);
  f.existing = {
    origin:"native_gbp",currency:"GBP",amount:"120.00",
    id: body.invoiceId,
    number: "SAVED-1",
    net_pence: 10000,
    vat_enabled: true,
    vat_rate_bps: 2000,
    vat_number_snapshot: "GB-SYNTHETIC",
    updated_at: "2026-01-01T00:00:00Z",
  };
  body.expectedUpdated = "2026-01-01T00:00:00Z";
  f.credits = [{ id: "prior-credit" }];
  const beforeCredit = f.uploads.length;
  assert.equal((await post()).status, 409);
  assert.equal(f.uploads.length, beforeCredit);
  f.credits = [];
  f.settings.vat_rate = 25;
  assert.equal(
    (await post({ expectedUpdated: "2026-01-01T00:00:00Z" })).status,
    200,
  );
  assert.equal(f.rpc.at(-1).args.p_data.vat_rate_bps, 2000);
  f.settings.bank_details = "Changed after review";
  const beforeStaleSeller = f.uploads.length;
  assert.equal((await post()).status, 409);
  assert.equal(f.uploads.length, beforeStaleSeller);
  f.settings.bank_details = "";
  f.failUpload = true;
  const before = f.rpc.length;
  assert.equal((await post()).status, 503);
  assert.equal(f.rpc.length, before);
  f.failUpload = false;
  f.failSave = true;
  assert.equal((await post()).status, 409);
  f.failSave = false;
  f.existing = {
    origin:"native_gbp",currency:"GBP",amount:"120.00",
    id: body.invoiceId,
    number: "LEGACY-1",
    net_pence: null,
    status: "finalised",
    updated_at: body.expectedUpdated,
  };
  assert.equal((await post()).status, 400);
  assert.equal(
    (await post({ legacyConfirmed: true, reason: "Checked original" })).status,
    200,
  );
  const previous = f.rpc.at(-1).args.p_data;
  f.prior = {
    origin:"native_gbp",invoice_id:body.invoiceId.toLowerCase(),
    snapshot: { ...previous, currency:"GBP", confirmed_updated_at: "2026-01-02T00:00:00Z" },
    pdf_path: f.uploads.at(-1).path,
    pdf_sha256: f.rpc.at(-1).args.p_pdf_sha256,
  };
  f.settings.legal_name = "Changed after saved revision";
  f.settings.vat_number = "GB-CHANGED";
  f.settings.vat_rate = 90;
  const nativeExisting=structuredClone(f.existing),nativePrior=structuredClone(f.prior),rendersAtBoundary=f.renders.length,uploadsAtBoundary=f.uploads.length;
  for(const patch of [{origin:'preserved_external',currency:'USD',amount:null},{origin:'preserved_external',currency:'GBP',amount:'120.00'},{origin:undefined},{currency:'JPY'},{amount:null}]){
    f.existing={...nativeExisting,...patch};
    assert.equal((await post({legacyConfirmed:true,reason:'Checked original'})).status,409);
    const req=new Request('http://localhost/api/invoices/download?id='+body.invoiceId);
    assert.equal((await m.download(req)).status,409);assert.equal((await m.share(req)).status,409);
  }
  f.existing=nativeExisting;f.prior={...nativePrior,origin:'preserved_external'};
  assert.equal((await post({legacyConfirmed:true,reason:'Checked original'})).status,409);
  f.prior=nativePrior;assert.equal(f.renders.length,rendersAtBoundary);assert.equal(f.uploads.length,uploadsAtBoundary);
  const beforeRetry = f.uploads.length,
    rendersBeforeRetry = f.renders.length;
  assert.equal(
    (await post({ legacyConfirmed: true, reason: "Checked original" })).status,
    200,
  );
  assert.equal(f.uploads.length, beforeRetry);
  assert.equal(f.renders.length, rendersBeforeRetry);
  assert.equal(
    (await post({ legacyConfirmed: true, reason: "Different request" })).status,
    409,
  );
  f.prior = null;
  f.existing = {
    origin:"native_gbp",currency:"GBP",amount:"120.00", id: body.invoiceId, number: "MISSING-PDF", pdf_path: null };
  const renders = f.renders.length;
  const get = new Request(
    "http://localhost/api/invoices/download?id=" + body.invoiceId,
  );
  assert.equal((await m.download(get)).status, 409);
  assert.equal((await m.share(get)).status, 409);
  assert.equal(f.renders.length, renders);
});
