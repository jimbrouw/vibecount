import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readFinancialReview, financialReviewPrompt } from '@/lib/records/financial-review';
import { getCurrentTaxYearStart } from '@/lib/records/tax-periods';
export const runtime='nodejs';
const REVIEW_MODEL=process.env.VIBECOUNT_EXTRACTION_MODEL||'claude-sonnet-4-20250514';
export async function POST(request:Request){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();
 if(error||!user)return NextResponse.json({error:'Sign in to review records.'},{status:401});
 let input:{schema_version:string;tax_year_start:number;expected_stamp:string;consent:boolean};
 try{
  const text=await request.text();if(new TextEncoder().encode(text).length>1024)throw new Error();
  input=JSON.parse(text);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='consent,expected_stamp,schema_version,tax_year_start'||input.schema_version!=='financial-review-request/1'||input.tax_year_start!==getCurrentTaxYearStart()||input.consent!==true||typeof input.expected_stamp!=='string'||input.expected_stamp.length!==64||!/^[a-f0-9]{64}$/.test(input.expected_stamp))throw new Error();
 }catch{return NextResponse.json({error:'Review the current summary and give consent before sharing.'},{status:400})}
 let review;
 try{review=await readFinancialReview(db,user.id,input.tax_year_start,new Date().toISOString().slice(0,10))}catch{return NextResponse.json({error:'Complete current review data is unavailable.'},{status:503})}
 if(review.stamp!==input.expected_stamp)return NextResponse.json({error:'Records changed. Reload and review before sharing.'},{status:409});
 const apiKey=process.env.ANTHROPIC_API_KEY;if(!apiKey)return NextResponse.json({error:'AI review is not configured.'},{status:503});
 try{
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:REVIEW_MODEL,max_tokens:1024,system:'You summarise a bounded operational ledger review for a UK freelancer. Counts are complete but may overlap; do not add coverage counters. Examples are explicitly sampled. Currency amounts use the stated integer minor units; GBP ledger pence are separate from original invoice amounts. Do not calculate tax, FX or new totals. Use the supplied deterministic figures. Do not infer missing balances, deductibility, source completeness or filing readiness. Use generated sample labels only. Suggest review steps in plain English; never approve, send, file or change records. Return at most eight short observations.',messages:[{role:'user',content:financialReviewPrompt(review)}]})});
  if(!response.ok)throw new Error();const data=await response.json();
  const suggestion=data?.content?.find((b:{type:string})=>b.type==='text')?.text;
  if(typeof suggestion!=='string'||!suggestion.trim()||suggestion.length>12000)throw new Error();
  return NextResponse.json({suggestion},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'AI review failed. Try again shortly.'},{status:502})}
}
