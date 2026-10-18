import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
test('deletion impact page is authenticated, metadata-only and cannot confirm or delete',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(root,'.deletion-preview-test-'));
 try {
 const bundle=await build({absWorkingDir:root,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server'],stdin:{resolveDir:root,contents:`import {renderToStaticMarkup} from 'react-dom/server';import Page from './app/dashboard/imports/deletion/page.tsx';export async function render(params={kind:'document',id:'11111111-1111-4111-8111-111111111111'}){return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}))}export {fixture} from 'test:db';`},plugins:[{name:'inert-deletion-preview',setup(b){
 b.onResolve({filter:/^next\/(navigation|link)$|^@\/lib\/supabase\/server$|^test:db$/},a=>({path:a.path==='@/lib/supabase/server'?'test:db':a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='next/navigation'?`export function redirect(url){throw new Error('REDIRECT '+url)}`:a.path==='next/link'?`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`:`
export const fixture={signedIn:true,authError:false,readError:false,pending:0,calls:[]};
export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:fixture.authError?{}:null})},rpc:async(name,args)=>{fixture.calls.push({name,args});return {error:fixture.readError?{}:null,data:{preview_only:true,retained_material:'Normalized records and saved snapshots remain.',inventory_sha256:'a'.repeat(64),counts:{unresolved_upload_operations:fixture.pending,registered_documents:4,document_name_copies:13},direct_references:{financial_records:2},owner_saved_material:{filing_packs:3},accounts:[],documents:[],tax_years:[2025],content_hashes:['b'.repeat(64)]}}}}}
`}));
 }}]});const path=join(dir,'fixture.mjs');await writeFile(path,bundle.outputFiles[0].text);const m=await import(pathToFileURL(path).href),f=m.fixture;
 const html=await m.render();assert.match(html,/Preview only/);assert.match(html,/whole account/);assert.match(html,/No request has been created/);assert.match(html,/Encrypted filename copies/);assert.match(html,/deletion-retained-material/);assert.match(html,/saved snapshots remain/);assert.doesNotMatch(html,/<form|<button|raw_encrypted|key_id|object_path/);assert.equal(f.calls[0].name,'review_evidence_deletion');assert.equal(f.calls[0].args.p_kind,'document');
 f.pending=1;const blocked=await m.render();assert.match(blocked,/deletion-upload-blocker/);assert.match(blocked,/Deletion must wait/);assert.doesNotMatch(blocked,/<form|<button/);f.pending=0;
 const count=f.calls.length;assert.match(await m.render({kind:'document',id:'invalid'}),/could not be loaded/);assert.equal(f.calls.length,count);
 f.readError=true;assert.match(await m.render(),/could not be loaded/);f.authError=true;await assert.rejects(m.render(),/REDIRECT \/login/);f.authError=false;f.signedIn=false;await assert.rejects(m.render(),/REDIRECT \/login/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
