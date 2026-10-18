import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { readForeignClassificationReview } from '@/lib/records/foreign-classification-review';
import ForeignClassificationReview from './ForeignClassificationReview';
export default async function ClassificationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');
 const params=await searchParams;let context=null;
 if(typeof params.transaction==='string')try{context=await readForeignClassificationReview(db,user.id,params.transaction);}catch{}
 return <main className="mx-auto max-w-4xl space-y-5 p-5"><h1 className="text-2xl font-semibold">Review foreign transaction classification</h1>
  <p>Review business use separately from valuation. The original observation and previous decisions remain in the audit history.</p>
  <nav className="flex gap-4"><Link data-testid="foreign-classification-imports" href="/dashboard/imports">Imports</Link>{context&&<Link data-testid="foreign-classification-valuation" href={'/dashboard/imports/valuation?transaction='+context.valuation.transaction.id}>Valuation evidence and corrections</Link>}</nav>
  {params.error&&<p role="alert">The classification was not confirmed. Reload, review the current amounts and evidence, and confirm again.</p>}
  {params.result==='saved'&&<p role="status">Classification saved with its exact valuation ancestry and accounting effect.</p>}
  {context?<ForeignClassificationReview context={context} requestId={randomUUID()}/>:<p role="status">Choose an owned foreign transaction from Imports. Complete review data is required.</p>}
 </main>;
}
