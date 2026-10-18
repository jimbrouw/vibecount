import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readAllExportRows } from '@/lib/records/export-pages';
import { ACCOUNT_EXPORT_FIELDS, ACCOUNT_EXPORT_TABLES } from '@/lib/records/account-export-fields';
import { ACCOUNT_EXPORT_SCHEMA, buildAccountExport, parseAccountExportContext, serializeAccountExport, type AccountExportKey, type AccountExportData, type AccountExportRow } from '@/lib/records/account-export';
export const runtime = 'nodejs';
export async function GET() {
  const db=await createClient(),{data:{user},error}=await db.auth.getUser();
  if(error||!user)return NextResponse.json({error:'Sign in to export account data.'},{status:401});
  try {
    const readContext=async()=>{
      const r=await db.rpc('read_partial_account_export_context');
      if(r.error)throw new Error('Account export context unavailable.');
      return parseAccountExportContext(user.id,r.data);
    };
    const before=await readContext();
    const entries=await Promise.all((Object.keys(ACCOUNT_EXPORT_FIELDS) as AccountExportKey[]).map(async key=>{
      const rows=await readAllExportRows<AccountExportRow>(async after=>{
        let q=db.from(ACCOUNT_EXPORT_TABLES[key]).select(ACCOUNT_EXPORT_FIELDS[key].join(',')).eq(key==='settings'?'id':'user_id',user.id).order('id').limit(500);
        if(after)q=q.gt('id',after);
        const r=await q;return{data:r.data as unknown as AccountExportRow[]|null,error:r.error};
      });
      return[key,rows] as const;
    }));
    const after=await readContext();
    if(before.stamp!==after.stamp||JSON.stringify(before.counts)!==JSON.stringify(after.counts))throw new Error('Account export changed.');
    const data=buildAccountExport(user.id,Object.fromEntries(entries) as AccountExportData,before);
    const body=serializeAccountExport(data),date=new Date().toISOString().slice(0,10);
    const audit=await db.from('record_exports').insert({user_id:user.id,export_type:'json',record_count:Object.values(before.counts).reduce((n,v)=>n+v,0),attachment_count:0,completed_at:new Date().toISOString()});
    if(audit.error)throw new Error('Could not record account export.');
    return new NextResponse(body,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="vibecount-partial-account-${date}.json"`,'Cache-Control':'private, no-store','X-VibeCount-Schema':ACCOUNT_EXPORT_SCHEMA}});
  }catch{return NextResponse.json({error:'Could not generate a complete partial account export. No partial download was produced.'},{status:503});}
}
