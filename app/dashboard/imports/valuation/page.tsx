import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { readBankValuationReview } from '@/lib/records/bank-valuation-review';
import BankValuationReview from './BankValuationReview';
export default async function ValuationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');
  const params=await searchParams;let context=null;
  if(typeof params.transaction==='string')try{context=await readBankValuationReview(db,user.id,params.transaction);}catch{}
  return <main className="mx-auto max-w-4xl space-y-5 p-5">
    <h1 className="text-2xl font-semibold">Review a bank valuation</h1>
    <p>Keep the original currency amount and review a documented GBP valuation. Classification and tax treatment require separate review.</p>
    <nav className="flex gap-4"><Link data-testid="bank-valuation-imports" href="/dashboard/imports">Imports</Link><Link data-testid="bank-valuation-documents" href="/dashboard/imports#document-evidence-heading">Preserved documents</Link></nav>
    {params.error&&<p role="alert">The review could not be saved. Reload the current source, check the original evidence and confirm again.</p>}
    {params.result==='saved'&&<p role="status">Valuation history saved. No income or expense was approved.</p>}
    {context&&<Link className="underline" data-testid="bank-valuation-classification" href={`/dashboard/imports/classification?transaction=${encodeURIComponent(context.transaction.id)}`}>Review classification and accounting amount</Link>}
    {context?<BankValuationReview context={context} requestId={randomUUID()}/>:<p role="status">Choose an owned foreign transaction from Imports. Its complete valuation review must be available before continuing.</p>}
  </main>;
}
