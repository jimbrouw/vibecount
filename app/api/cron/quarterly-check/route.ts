import { NextResponse } from 'next/server';
import { readAllExportRows } from '@/lib/records/export-pages';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentTaxYearStart,getQuarterDates,type TaxQuarter } from '@/lib/records/tax-periods';
import { FINANCIAL_REVIEW_VERSION } from '@/lib/records/financial-review';
export const runtime='nodejs';
export async function GET(request:Request){return POST(request)}
function currentQuarter(today:Date):TaxQuarter{const year=getCurrentTaxYearStart(today);return([4,3,2,1] as TaxQuarter[]).find(q=>today>=getQuarterDates(year,q).start)!}
export async function POST(request:Request){
 const secret=process.env.CRON_SECRET;if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized.'},{status:401});
 const db=createAdminClient();if(!db)return NextResponse.json({error:'Database not configured.'},{status:500});
 const now=new Date(),year=getCurrentTaxYearStart(now),quarter=currentQuarter(now),asOf=now.toISOString().slice(0,10);
 let owners:string[];
 try{
  const rows=await Promise.all(['financial_records','invoices','bank_transactions'].map(table=>readAllExportRows<{id:string;user_id:string}>(async after=>{
   let q=db.from(table).select('id,user_id').order('id').limit(500);
   if(table==='invoices')q=q.eq('status','finalised');else q=q.eq('tax_year_start',year);
   if(after)q=q.gt('id',after);return await q;
  })));
  owners=[...new Set(rows.flat().map(r=>{if(typeof r.user_id!=='string'||!r.user_id)throw new Error();return r.user_id}))];
 }catch{return NextResponse.json({error:'Could not list complete readiness scope.'},{status:500})}
 const result={checked:owners.length,saved:0,failed:0};
 for(const owner of owners){
  try{
   const r=await db.rpc('capture_quarter_readiness',{p_owner:owner,p_year:year,p_quarter:quarter,p_as_of:asOf}),data=r.data;
   if(r.error||!data||data.owner_id!==owner||data.tax_year_start!==year||data.tax_quarter!==quarter||data.coverage_version!==FINANCIAL_REVIEW_VERSION||!['ok','needs_attention'].includes(data.status))throw new Error();
   result.saved++;
  }catch{result.failed++}
 }
 return NextResponse.json({ok:result.failed===0,...result},{status:result.failed?503:200,headers:{'Cache-Control':'private, no-store'}});
}
