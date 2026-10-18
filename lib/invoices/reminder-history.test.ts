import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
test('delivery history renders retained uncertainty beside verified evidence and paginates owned rows',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.reminder-history-test-'));
 try {
  const bundle=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/reminders/page.tsx';export async function render(page='0'){return renderToStaticMarkup(await Page({searchParams:Promise.resolve({page})}))}export {fixture} from 'test:db';`},plugins:[{name:'inert-history',setup(b){
   b.onResolve({filter:/^next\/(navigation|link)$|^@\/lib\/supabase\/server$|^test:db$/},a=>({path:a.path==='@/lib/supabase/server'?'test:db':a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?`export function redirect(url){throw new Error('REDIRECT '+url)}`:a.path==='next/link'?`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`:`
export const fixture={signedIn:true,error:false,reads:[],rows:[{id:'reminder',subject:'Synthetic reminder',recipient_email:'to@example.invalid',status:'sent',provider_delivery_state:'delivered',provider_message_id:'provider'}]};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null}})},from(table){const filters={};let range=null;const q={select(){return q},eq(k,v){filters[k]=v;return q},in(){return q},order(){return q},limit(){return q},range(a,b){range=[a,b];return q},then(ok,fail){fixture.reads.push({table,filters,range});const data=table==='invoice_reminders'?fixture.rows:table==='reminder_send_attempts'?[{id:'attempt',reminder_id:'reminder',created_at:'2026-10-18'}]:table==='reminder_send_outcomes'?[{attempt_id:'attempt',outcome:'unknown'}]:[{event_id:'event',attempt_id:'attempt',event_type:'email.delivered',occurred_at:'2026-10-18'}];return Promise.resolve({data,error:fixture.error?{}:null}).then(ok,fail)}};return q}}}
`}));
  }}]});const path=join(dir,'fixture.mjs');await writeFile(path,bundle.outputFiles[0].text);const m=await import(pathToFileURL(path).href),f=m.fixture;
  const html=await m.render();assert.match(html,/Provider reports delivery/);assert.match(html,/Original outcome: unknown/);assert.match(html,/email.delivered/);assert.doesNotMatch(html,/<form|Send reminder/);assert.ok(f.reads.every((r:{filters:{user_id:string}})=>r.filters.user_id==='owner'));
  f.rows=Array.from({length:26},(_,i)=>({...f.rows[0],id:'reminder'+i}));const paged=await m.render('1');assert.match(paged,/reminders-previous/);assert.match(paged,/reminders-next/);assert.deepEqual(f.reads.findLast((r:{table:string})=>r.table==='invoice_reminders').range,[25,50]);
  f.error=true;assert.match(await m.render(),/history is unavailable/);f.signedIn=false;await assert.rejects(m.render(),/REDIRECT \/login/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
