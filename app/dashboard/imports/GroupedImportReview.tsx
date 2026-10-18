"use client";

import { useState } from 'react';
import Link from 'next/link';
import { sourceGroups } from '@/lib/records/source-groups';
import type { CsvMapping } from '@/lib/records/source-csv';
import { amountToWords, formatPounds } from '@/lib/invoices/money';
import { importSourceGroup } from './actions';
import type { AccountOption } from './ImportWizard';

const control='mt-1 block w-full rounded-md border border-[#c8d4cb] bg-white p-2';
export default function GroupedImportReview({ table, mapping, file, accounts }: { table:string[][]; mapping:CsvMapping; file:File; accounts:AccountOption[] }) {
  const groups=sourceGroups(table,mapping);
  const [destinations,setDestinations]=useState<Record<string,string>>({});
  return <section className="space-y-4" data-testid="source-group-review">
    <h3 className="text-lg font-semibold">Your file is split into {groups.length} accounts</h3>
    <p>Review each account below. Import one group at a time, without preparing separate files. Your full original file stays securely preserved; spreadsheet claim labels do not approve expenses.</p>
    {groups.map(group=><GroupCard key={group.scope.value} group={group} file={file} mapping={mapping} accounts={accounts}
      used={Object.entries(destinations).filter(([label])=>label!==group.scope.value).map(([,id])=>id)}
      onChoose={id=>setDestinations(previous=>({...previous,[group.scope.value]:id}))}/>) }
  </section>;
}
function GroupCard({ group,file,mapping,accounts,used,onChoose }: { group:ReturnType<typeof sourceGroups>[number];file:File;mapping:CsvMapping;accounts:AccountOption[];used:string[];onChoose:(id:string)=>void }) {
  const [account,setAccount]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<Awaited<ReturnType<typeof importSourceGroup>>|null>(null);
  const name=group.scope.value;
  const provider=['starling','nationwide','amex'].includes(name.toLowerCase())?name.toLowerCase():'generic';
  const dates=group.rows.map(row=>row.date).sort();
  return <form className="space-y-3 rounded-xl border bg-white p-5" data-testid={`source-group-${name}`}
    onChange={()=>setConfirmed(false)}
    action={async form=>{
      setBusy(true);setResult(null);
      try {
        form.set('sourceFile',file);form.set('mapping',JSON.stringify(mapping));form.set('group',name);
        setResult(await importSourceGroup(form));
      } catch { setResult({error:'Could not finish this import. Check saved imports before retrying; earlier groups remain saved.'}); }
      finally {setBusy(false);setConfirmed(false);}
    }}>
    <h4 className="text-lg font-semibold">{name}</h4>
    <p>{group.rows.length} payments · {dates[0]} to {dates.at(-1)}</p>
    <p>Money paid out: {formatPounds(group.outgoing)} ({amountToWords(group.outgoing)})</p>
    <p>Money received: {formatPounds(group.incoming)} ({amountToWords(group.incoming)})</p>
    <details><summary className="cursor-pointer underline">Check sample payments</summary><ul className="mt-2 space-y-1">{group.rows.slice(0,3).map(row=><li key={row.rowNumber}>{row.date} · {row.description} · {row.signedPence>0?'In':'Out'} {formatPounds(Math.abs(row.signedPence))}</li>)}</ul></details>
    {result?.importId ? <div role="status"><p>{result.created?'Imported for review. Nothing approved.':'Already imported. No duplicate payments added.'}</p><Link className="font-semibold underline" href={`/dashboard/imports?import=${result.importId}`}>Review {name} payments</Link></div> : <>
      <fieldset disabled={busy} className="space-y-3">
      <label className="block">Save these payments under
        <select required name="accountId" data-testid="group-account" className={control} value={account} onChange={event=>{setAccount(event.target.value);onChoose(event.target.value);setConfirmed(false);}}>
          <option value="">Choose an account label</option>
          {accounts.map(a=><option key={a.id} value={a.id} disabled={used.includes(a.id)}>{a.label} · ending {a.masked_identifier}</option>)}
          <option value="new">Add a label for this account</option>
        </select>
      </label>
      {account==='new'&&<>
        <p className="text-sm">This only adds a source label. It does not connect to your bank.</p>
        <label className="block">Account name<input className={control} name="label" defaultValue={name} required maxLength={80}/></label>
        <label className="block">Bank or card<select className={control} name="provider" defaultValue={provider}><option value="starling">Starling</option><option value="nationwide">Nationwide</option><option value="amex">Amex</option><option value="generic">Other</option></select></label>
        <label className="block">Last four account or card characters<input className={control} name="mask" required maxLength={4} pattern="[A-Za-z0-9]{1,4}" autoComplete="off"/></label>
      </>}
      <label className="flex items-start gap-2"><input type="checkbox" name="mappingConfirmed" value="yes" checked={confirmed} required data-testid="group-confirm" onChange={event=>{event.stopPropagation();setConfirmed(event.target.checked);}}/>The account, dates and money in/out look right. Import this group for review.</label>
      </fieldset>
      {result?.error&&<p role="alert" className="text-red-800">{result.error}</p>}
      <button type="submit" disabled={busy||!confirmed||!account||(account!=='new'&&used.includes(account))} className="rounded-md bg-[#15803d] px-4 py-2 font-semibold text-white disabled:opacity-40" data-testid="group-import">{busy?'Importing…':`Import ${name} for review`}</button>
    </>}
  </form>;
}
