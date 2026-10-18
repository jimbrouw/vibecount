import BankSourceCoverage from '../../BankSourceCoverage';
import { BankChoiceAmount, BankChoiceWithheld } from '../../BankChoiceReadback';
import { readBankChoiceContext, finishBankChoiceContext, assertBankChoiceAccountTypes } from '@/lib/records/native-choice-store';
import { bankChoiceSource, nativeBankChoice, nativeBankIds } from '@/lib/records/native-choice';
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bankOriginalMinor } from '@/lib/records/bank-source-coverage';
import { minorPence } from "@/lib/records/allocations";
import type { TransferChoice } from "@/lib/records/transfers";
import TransferReview from "./TransferReview";
import ActiveTransferPair, {
  type ActivePairSummary,
} from "./ActiveTransferPair";
export const metadata = { title: "Transfers and card repayments — VibeCount" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const params = await searchParams;
  const id = (key: string) =>
    typeof params[key] === "string" && uuid.test(params[key])
      ? (params[key] as string).toLowerCase()
      : null;
  const out = id("outgoing"),
    incoming = id("incoming"),
    after = id("after"),
    pairAfter = id("pairAfter");
  let choicesQuery = db
    .from("transfer_transaction_choices")
    .select(
      "id,account_id,import_id,currency,decision_version,dedupe_status,import_status,account_label,account_mask,transaction_date,signed_amount_pence,description,active_transfer_id,active_refund_id,has_refunds,classification",
    )
    .eq("user_id", user.id)
    .order("id")
    .limit(51);
  if (after) choicesQuery = choicesQuery.gt("id", after);
  let pairsQuery = db
    .from("active_transfer_pairs")
    .select(
      "id,kind,amount_pence,outgoing_transaction_id,incoming_transaction_id,outgoing:bank_transactions!transfer_pairs_outgoing_owner_fk(id,account_id,transaction_date,currency,signed_amount_pence,description,import_id,financial_accounts(label,masked_identifier)),incoming:bank_transactions!transfer_pairs_incoming_owner_fk(id,account_id,transaction_date,currency,signed_amount_pence,description,import_id,financial_accounts(label,masked_identifier))",
    )
    .eq("user_id", user.id)
    .order("id")
    .limit(21);
  if (pairAfter) pairsQuery = pairsQuery.gt("id", pairAfter);
  let bankContext: Awaited<ReturnType<typeof readBankChoiceContext>> | null=null;
  try{bankContext=await readBankChoiceContext(db,user.id)}catch{}
  const [choices, pairs, selected] = await Promise.all([
    choicesQuery,
    pairsQuery,
    out || incoming
      ? db
          .from("transfer_transaction_choices")
          .select(
            "id,account_id,import_id,transaction_date,signed_amount_pence,currency,description,account_label,account_mask,account_type,classification,decision_version,dedupe_status,active_transfer_id,active_refund_id,has_refunds,import_status,record_status,recognized_pence,invoice_allocated_pence",
          )
          .eq("user_id", user.id)
          .in(
            "id",
            [out, incoming].filter((v): v is string => !!v),
          )
      : Promise.resolve({ data: [], error: null }),
  ]);
  const selectedRows = (selected.data ?? []) as TransferChoice[],
    outRow = selectedRows.find((row) => row.id === out),
    inRow = selectedRows.find((row) => row.id === incoming);
  let coverage=bankContext?.coverage??null,unavailable=!bankContext||!!choices.error||!!pairs.error||!!selected.error;
  const pairEligibility=new Map<string,boolean>();
  try{
    if(!bankContext)throw new Error('Bank context unavailable');
    coverage=await finishBankChoiceContext(db,user.id,bankContext);
    assertBankChoiceAccountTypes(bankContext!.accounts,[...(choices.data??[]),...selectedRows]);
    for(const row of [...(choices.data??[]),...selectedRows])bankChoiceSource(coverage,row);
    for(const id of [out,incoming].filter((v):v is string=>!!v)){
      const source=coverage.observations.find(r=>r.id===id);if(!source||source.representation==='native_gbp'&&!selectedRows.some(r=>r.id===id))throw new Error('Selected source unavailable');
    }
    for(const pair of pairs.data??[]){
      const ids=[pair.outgoing_transaction_id,pair.incoming_transaction_id],native=nativeBankIds(coverage,ids);
      const sides=[pair.outgoing,pair.incoming];
      for(const [index,side]of sides.entries()){const row=Array.isArray(side)?side.length===1?side[0]:null:side;if(!row||row.id!==ids[index])throw new Error('Owned pair source unavailable');bankChoiceSource(coverage,row)}
      if(native){const [o,i]=ids.map(id=>coverage!.observations.find(r=>r.id===id)!);if(bankOriginalMinor(o.signed_amount_pence)!==-minorPence(pair.amount_pence)||bankOriginalMinor(i.signed_amount_pence)!==minorPence(pair.amount_pence))throw new Error('Pair cash differs from owned sources')}
      pairEligibility.set(pair.id,native);
    }
  }catch{unavailable=true;coverage=null}
  const selectedSources=coverage?.observations.filter(r=>r.id===out||r.id===incoming)??[],blockedSelection=selectedSources.some(r=>r.representation!=='native_gbp');
  const link = (extra: Record<string, string>) =>
    `/dashboard/reconciliation/transfers?${new URLSearchParams({ ...(out ? { outgoing: out } : {}), ...(incoming ? { incoming } : {}), ...extra })}`;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">
          Transfers and card repayments
        </h1>
        <p className="mt-2">
          Pair two recorded source transactions after checking both account
          labels, dates and amounts. This does not move money.
        </p>
        <Link href="/dashboard/reconciliation" className="underline">
          Invoice reconciliation and export
        </Link>
      </header>
      <BankSourceCoverage coverage={coverage}/>
      {blockedSelection && <BankChoiceWithheld sources={selectedSources} prefix="transfer"/>}
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 300)}</p>
      )}
      {params.result === "paired" && (
        <p role="status">
          Pair approved. Both sides have zero income and expense effect.
        </p>
      )}
      {params.result === "reversed" && (
        <p role="status">
          Pair reversed. Both sides are unresolved; no previous amounts were
          restored.
        </p>
      )}
      {unavailable || !coverage ? (
        <p role="alert">
          Transfer evidence is unavailable. Reload before reviewing.
        </p>
      ) : (
        <>
          <section className="rounded border bg-white p-4">
            <h2 className="font-semibold">Choose money out and money in</h2>
            <ul className="mt-3 space-y-3">
              {choices.data?.slice(0, 50).map((row) => (
                <li key={row.id}>
                  {row.account_label} ending {row.account_mask} ·{" "}
                  {row.transaction_date} · {row.description} ·{" "}
                  {<BankChoiceAmount source={bankChoiceSource(coverage,row)}/>} ·{" "}
                  {row.classification}
                  {!nativeBankChoice(coverage,row) ? <span> — Native transfer controls withheld</span> : row.active_transfer_id || row.has_refunds ? (
                    " — existing transfer/refund relationship"
                  ) : (
                    <Link
                      className="ml-2 underline"
                      href={link(
                        minorPence(row.signed_amount_pence) < 0
                          ? { outgoing: row.id }
                          : { incoming: row.id },
                      )}
                      data-testid={`transfer-select-${row.id}`}
                    >
                      Select{" "}
                      {minorPence(row.signed_amount_pence) < 0
                        ? "money out"
                        : "money in"}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {(choices.data?.length ?? 0) > 50 && (
              <Link
                href={link({ after: choices.data![49].id })}
                className="underline"
                data-testid="transfer-choices-next"
              >
                More transactions
              </Link>
            )}
            {after && (
              <Link href={link({})} className="ml-3 underline">
                First transactions
              </Link>
            )}
          </section>
          {outRow && inRow && !blockedSelection ? (
            <section className="rounded border bg-white p-4">
              <h2 className="mb-3 font-semibold">Review both sides</h2>
              <TransferReview
                outgoing={outRow}
                incoming={inRow}
                requestId={randomUUID()}
              />
            </section>
          ) : (
            <p>
              Select one outgoing and one incoming transaction. Both stay
              unchanged until confirmed.
            </p>
          )}
          <section className="space-y-3 rounded border bg-white p-4">
            <h2 className="font-semibold">Active pairs</h2>
            {pairs.data?.slice(0, 20).map((pair) => (
              <ActiveTransferPair
                key={pair.id}
                pair={pair as unknown as ActivePairSummary}
                nativeScopeAvailable={pairEligibility.get(pair.id)===true}
              />
            ))}
            {!pairs.data?.length && <p>No active pairs on this page.</p>}
            {pairAfter && (
              <Link
                href={link({})}
                className="underline"
                data-testid="transfer-pairs-first"
              >
                First pairs
              </Link>
            )}
            {(pairs.data?.length ?? 0) > 20 && (
              <Link
                href={link({ pairAfter: pairs.data![19].id })}
                className="underline"
                data-testid="transfer-pairs-next"
              >
                More pairs
              </Link>
            )}
          </section>
        </>
      )}
    </main>
  );
}
