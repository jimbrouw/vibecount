import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const id=(n:number)=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
async function fixture(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.foreign-reversal-route-'));
 try{
  const bundle=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',stdin:{resolveDir:root,contents:"export {reverseForeignImport} from './app/dashboard/imports/reversal/foreign-actions.ts';export {fixture} from 'test:db';"},plugins:[{name:'boundaries',setup(b){
   b.onResolve({filter:/^(next\/(navigation|cache)|@\/lib\/supabase\/server|test:db)$/},a=>({path:a.path.startsWith('next/')?a.path:'db',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?"export function redirect(url){throw new Error('REDIRECT:'+url)}":a.path==='next/cache'?'export function revalidatePath(){}':`
export const fixture={signedIn:true,prior:false,historyError:false,readError:false,writeError:false,blocked:false,stamp:'a'.repeat(32),calls:[],history:[]};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'${id(1)}'}:null},error:null})},from(name){const q={select(){return q},eq(k,v){fixture.history.push([name,k,v]);return q},async maybeSingle(){return{data:fixture.prior?{request_id:'retained'}:null,error:fixture.historyError?'PRIVATE':null}}};return q},rpc:async(name,args)=>{fixture.calls.push({name,args});return{name,data:name==='read_foreign_import_reversal'?{schema_version:'foreign-import-reversal/1',owner_id:'${id(1)}',import_id:'${id(2)}',import_status:'review',currency:'KWD',blocked:fixture.blocked,stamp:fixture.stamp,sources:[]}:{schema_version:'foreign-import-reversal-result/1',import_id:args.p_import,reviewed_stamp:args.p_stamp},error:(name==='read_foreign_import_reversal'?fixture.readError:fixture.writeError)?'PRIVATE':null}}}}` }));
  }}]});const path=join(dir,'fixture.mjs');await writeFile(path,bundle.outputFiles[0].text);return await import(pathToFileURL(path).href);
 }finally{await rm(dir,{recursive:true,force:true})}
}
function form(){const f=new FormData();for(const[k,v]of Object.entries({importId:id(2),requestId:id(3),stamp:'a'.repeat(32),reason:'Reviewed source effects',humanConfirmed:'yes'}))f.set(k,v);return f;}
test('foreign reversal action authenticates, validates exact confirmation and rejects stale or blocked reviews',async()=>{
 const m=await fixture(),f=m.fixture;f.signedIn=false;await assert.rejects(m.reverseForeignImport(form()),/REDIRECT:\/login/);assert.equal(f.calls.length,0);f.signedIn=true;
 for(const key of ['humanConfirmed','stamp','requestId','reason']){const bad=form();bad.set(key,'');await assert.rejects(m.reverseForeignImport(bad),/Review%20and%20confirm/)}
 const extra=form();extra.set('owner',id(9));await assert.rejects(m.reverseForeignImport(extra),/Review%20and%20confirm/);const duplicate=form();duplicate.append('importId',id(2));await assert.rejects(m.reverseForeignImport(duplicate),/Review%20and%20confirm/);assert.equal(f.calls.length,0);
 for(const mode of ['blocked','readError']){f[mode]=true;await assert.rejects(m.reverseForeignImport(form()),/review%20changed/);f[mode]=false;}f.stamp='b'.repeat(32);await assert.rejects(m.reverseForeignImport(form()),/review%20changed/);f.stamp='a'.repeat(32);
 assert.equal(f.calls.filter((c:{name:string})=>c.name==='reverse_foreign_import_reviewed').length,0);
 await assert.rejects(m.reverseForeignImport(form()),/result=reversed/);assert.ok(f.history.some((h:string[])=>h[1]==='user_id'&&h[2]===id(1)));
 assert.equal(f.calls.at(-1).args.p_import,id(2));
});
test('foreign reversal exact retained request reaches database despite live loss; history or writer errors fail closed',async()=>{
 const m=await fixture(),f=m.fixture;f.historyError=true;await assert.rejects(m.reverseForeignImport(form()),/history%20unavailable/);assert.equal(f.calls.length,0);
 f.historyError=false;f.prior=true;f.readError=true;await assert.rejects(m.reverseForeignImport(form()),/result=reversed/);assert.deepEqual(f.calls.map((c:{name:string})=>c.name),['reverse_foreign_import_reviewed']);
 f.writeError=true;await assert.rejects(m.reverseForeignImport(form()),e=>{assert.match((e as Error).message,/Reversal%20unavailable/);assert.doesNotMatch((e as Error).message,/PRIVATE/);return true});
});
