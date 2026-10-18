import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
test("reminder sending checks explicit confirmation and durable claim before provider calls", async (t) => {
  const originalKey = process.env.RESEND_API_KEY,
    originalFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "synthetic-test-only";
  process.env.RESEND_FROM_EMAIL = "synthetic@example.invalid";
  t.after(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
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
      contents: `export {sendApprovedReminder} from './app/dashboard/invoices/actions.ts';export {fixture} from 'test:db';`,
    },
    plugins: [
      {
        name: "inert-reminder-transport",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(next\/navigation|next\/cache|resend|@\/lib\/supabase\/(server|admin)|test:db)$/,
            },
            (args) => ({
              path:
                args.path.startsWith("@/lib/supabase/") ? "test:db" : args.path,
              namespace: "test",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            loader: "js",
            contents:
              args.path === "next/navigation"
                ? `export function redirect(path){throw new Error('REDIRECT '+path)}`
                : args.path === "next/cache"
                  ? `export function revalidatePath(){}`
                  : args.path === "resend"
                    ? `import {fixture} from 'test:db';export class Resend{emails={send:async(payload,options)=>{fixture.sends.push({payload,options});return {data:{id:'synthetic-provider-id'},error:null}}}}`
                    : `
export const fixture={signedIn:true,claimError:false,claimed:true,outcomeError:false,sends:[],claims:[],writes:[]};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null}})}}}
export function createAdminClient(){return {rpc:async(name,args)=>{
if(name==='claim_reminder_send'){fixture.claims.push(args);return {error:fixture.claimError?{}:null,data:fixture.claimed?{claimed:true,attempt_id:'attempt',provider_key:'invoice-reminder-reminder',payload:{from:'from@example.invalid',to:'customer@example.invalid',subject:'Reviewed balance',text:'Amount due £750'}}:{claimed:false,status:'sending'}}}
fixture.writes.push(args);return {error:fixture.outcomeError?{}:null};
}}}
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
  const form = new FormData();
  form.set("reminderId", "reminder");
  form.set("redirectTo", "/dashboard");
  f.signedIn = false;
  await assert.rejects(m.sendApprovedReminder(form), /REDIRECT \/login/);
  f.signedIn = true;
  await assert.rejects(m.sendApprovedReminder(form), /Confirm/);
  assert.equal(f.claims.length,0);assert.equal(f.sends.length,0);
  form.set('humanConfirmed','yes');form.set('reviewedAt','reviewed-stamp');
  f.claimError=true;
  await assert.rejects(m.sendApprovedReminder(form),/changed.*unavailable/);assert.equal(f.sends.length,0);
  f.claimError=false;f.claimed=false;
  await assert.rejects(m.sendApprovedReminder(form),/already.*attempt/);assert.equal(f.sends.length,0);
  f.claimed=true;
  await assert.rejects(m.sendApprovedReminder(form), /reminderSent=1/);
  assert.equal(f.sends.length, 1);
  assert.equal(f.claims.at(-1).p_owner,'owner');assert.equal(f.claims.at(-1).p_updated_at,'reviewed-stamp');
  assert.equal(f.sends[0].options.idempotencyKey, "invoice-reminder-reminder");
  assert.equal(f.sends[0].payload.text, "Amount due £750");
  assert.deepEqual(f.sends[0].payload.tags,[{name:"vibecount_attempt",value:"attempt"}]);
  assert.equal(f.writes.at(-1).p_outcome,'accepted');
  f.outcomeError=true;
  await assert.rejects(m.sendApprovedReminder(form),/outcome.*checking/);
});
