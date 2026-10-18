import { signedAmountToWords } from "@/lib/invoices/money";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureRecordCategories } from "@/lib/records/categories";
import ImportWizard, { type AccountOption } from "./ImportWizard";
import TransactionReview, { type LedgerTransaction } from "./TransactionReview";
import {
  createFinancialAccount,
  reopenSourceImport,
} from "./actions";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import DocumentIntake from "./DocumentIntake";
import BankSourceCoverageReadback from '../BankSourceCoverage';
import { readBankSourceCoverage, type BankSourceCoverage } from '@/lib/records/bank-source-coverage';
import {
  getCurrentTaxYearStart,
  getTaxYearLabel,
} from "@/lib/records/tax-periods";

export const metadata = { title: "Imports — VibeCount" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const control = "mt-1 block w-full rounded-md border border-[#c8d4cb] p-2";

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  let coverage: BankSourceCoverage|null=null;
  try { coverage=await readBankSourceCoverage(db,user.id); } catch {}
  const params = await searchParams;
  const selected =
    typeof params.import === "string" && uuid.test(params.import)
      ? params.import
      : null;
  const after =
    typeof params.after === "string" && uuid.test(params.after)
      ? params.after
      : null;
  const focused = typeof params.transaction === "string" && uuid.test(params.transaction) ? params.transaction : null;
  const page =
    typeof params.importsPage === "string" &&
    /^\d{1,4}$/.test(params.importsPage)
      ? Number(params.importsPage)
      : 0;
  const documentsPage =
    typeof params.documentsPage === "string" &&
    /^\d{1,4}$/.test(params.documentsPage)
      ? Number(params.documentsPage)
      : 0;
  const documents = await db
    .from("document_batches")
    .select(
      "id,tax_year_start,purpose,created_at,document_batch_items(id,ordinal,document:evidence_documents(id,file_hash,media_type,size_bytes))",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(documentsPage * 10, documentsPage * 10 + 10);
  const [accounts, imports, categories] = await Promise.all([
    db
      .from("financial_accounts")
      .select("id,label,provider,masked_identifier,currency")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(100),
    db
      .from("record_imports")
      .select(
        "id,original_filename,file_hash,parser_version,coverage_start,coverage_end,metadata,status",
      )
      .eq("user_id", user.id)
      .not("source_file_id", "is", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * 20, page * 20 + 20),
    ensureRecordCategories(db, user.id),
  ]);
  const available = !accounts.error && !imports.error && coverage!==null;
  const importList = imports.data ?? [];
  let query = db
    .from("refund_source_transactions")
    .select(
      "id,import_id,transaction_date,signed_amount_pence,currency,original_signed_minor,source_units_ruleset,description,reference,classification,decision_version,business_use_bps,category_id,dedupe_status,source_row_id,active_transfer_id,active_refund_id,has_refunds",
    )
    .eq("user_id", user.id)
    .order("id")
    .limit(51);
  if (selected) query = query.eq("import_id", selected);
  if (focused) query = query.eq("id", focused);
  else if (after) query = query.gt("id", after);
  const transactionResult = available ? await query : null;
  const txs = (transactionResult?.data ?? []) as LedgerTransaction[];
  const transactions = txs.slice(0, 50);
  const chosen = selected
    ? await db
        .from("record_imports")
        .select("id,status")
        .eq("id", selected)
        .eq("user_id", user.id)
        .not("source_file_id", "is", null)
        .maybeSingle()
    : null;
  const summary = chosen?.data
    ? await db.rpc("source_import_summary", { p_id: selected })
    : null;
  const selectedCoverage=coverage?.observations.filter(r=>r.import_id===selected);
  const totalsAllowed=selectedCoverage!==undefined&&selectedCoverage.length===Number(summary?.data?.transactions)&&selectedCoverage.every(r=>r.representation==='native_gbp');
  const totals = (totalsAllowed?summary?.data:null) as {
    income_pence: number;
    expense_pence: number;
    transactions: number;
    stamp: string;
    allocation_count: number;
    allocation_pence: number;
    refund_count: number;
    refund_pence: number;
    refund_income_reduction_pence: number;
    refund_expense_reduction_pence: number;
    transfer_count: number;
    transfer_pence: number;
    retained_duplicate_count: number;
    refund_assignment_count: number;
    refund_assignment_pence: number;
  } | null;
  const linkBase = `/dashboard/imports?${selected ? `import=${selected}&` : ""}importsPage=${page}`;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5 text-[#17251d]">
      <header>
        <h1 className="text-2xl font-semibold">
          Import your files
        </h1>
        <p className="mt-2">
          Start with a CSV file. Check the preview, then review your payments.
        </p>
      </header>
      {typeof params.error === "string" && (
        <p
          role="alert"
          data-testid="source-server-error"
          className="rounded border border-red-200 bg-red-50 p-3"
        >
          {params.error.slice(0, 300)}
        </p>
      )}
      {params.result === "existing" && (
        <p role="status" data-testid="source-reimport-status">
          This file already exists for the selected account. No transactions
          were added. Your previous decisions are preserved.
        </p>
      )}
      {params.result === "staged" && (
        <p role="status">
          Source preserved. Transactions are unresolved until you review them.
        </p>
      )}
      {params.result === "reviewed" && (
        <p role="status">
          Decision saved. Previous decisions remain in the audit history.
        </p>
      )}
      {params.result === "reversed" && (
        <p role="status">
          Import reversed. Its financial effects are excluded; the original
          evidence and decision history remain preserved.
        </p>
      )}
      <details className="rounded-xl border bg-white p-4" data-testid="source-tools"><summary className="cursor-pointer font-semibold">Source checks and upload recovery</summary>
      <BankSourceCoverageReadback coverage={coverage}/>
      {focused && <Link data-testid="source-all-transactions" className="block underline" href={selected ? `/dashboard/imports?import=${selected}` : '/dashboard/imports'}>Show all transactions in this source</Link>}
      <Link
        href="/dashboard/imports/recovery"
        data-testid="imports-recovery-link"
        className="block underline"
      >
        Review upload status and recover failed evidence
      </Link>
      </details>
      <details className="rounded-xl border bg-white p-4" data-testid="document-tools"><summary className="cursor-pointer font-semibold">Upload receipts, invoices or other documents</summary>
      <Link href="/dashboard/reconciliation/fx/evidence" data-testid="imports-fx-evidence-link" className="block underline">Review invoice and FX conversion document facts</Link>
      <DocumentIntake currentYear={getCurrentTaxYearStart()} />
      <section
        className="rounded-xl border bg-white p-4"
        aria-labelledby="document-evidence-heading"
      >
        <h2 id="document-evidence-heading" className="font-semibold">
          Preserved document evidence
        </h2>
        <p className="mt-2 text-sm">
          Unresolved — document contents have not been extracted or accepted as
          financial or tax facts.
        </p>
        {documents.error ? (
          <p role="alert" data-testid="document-list-error">
            Document evidence is unavailable. Try again before relying on this
            list.
          </p>
        ) : !documents.data?.length ? (
          <p className="mt-2">No document batches on this page.</p>
        ) : (
          documents.data.slice(0, 10).map((batch) => (
            <details
              key={batch.id}
              className="mt-3 border-t pt-3"
              data-testid={`document-batch-${batch.id}`}
            >
              <summary>
                {batch.purpose} evidence ·{" "}
                {getTaxYearLabel(batch.tax_year_start)} · Unresolved
              </summary>
              <p className="mt-2 text-xs">
                Batch {batch.id}. Original names and contents remain restricted.
              </p>
              <a
                href={`/api/evidence/${batch.id}/manifest`}
                data-testid={`document-manifest-${batch.id}`}
                className="mt-2 block text-sm font-semibold underline"
              >
                Export draft document evidence manifest
              </a>
              <ul className="mt-2 space-y-2 text-sm">
                {[...batch.document_batch_items]
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((item) => {
                    const doc = Array.isArray(item.document)
                      ? item.document[0]
                      : item.document;
                    return (
                      <li key={item.id}>
                        {item.ordinal === 0
                          ? "Original upload"
                          : `Archive member ${item.ordinal}`}{" "}
                        · {doc?.media_type ?? "Evidence unavailable"} ·{" "}
                        {doc?.size_bytes ?? "?"} bytes
                        <br />
                        <span className="break-all text-xs">
                          SHA-256: {doc?.file_hash ?? "Unavailable"}
                        </span>
                        {doc && <form method="post" action={`/api/evidence/documents/${doc.id}/original`} className="mt-2" data-testid={`document-original-${item.id}`}>
                          <label className="block"><input type="checkbox" name="humanConfirmed" value="yes" required data-testid={`document-original-confirm-${item.id}`}/> Download this private original to my device for my own review.</label>
                          <p className="text-xs">The file is verified before download. Its contents are not shown here or accepted as financial facts.</p>
                          <button type="submit" className="underline" data-testid={`document-original-download-${item.id}`}>Download verified original</button>
                        </form>}
                        {doc && <Link href={`/dashboard/imports/deletion?kind=document&id=${doc.id}`} data-testid={`document-deletion-preview-${item.id}`} className="mt-2 inline-block text-sm underline">Preview deletion impact</Link>}
                      </li>
                    );
                  })}
              </ul>
            </details>
          ))
        )}
        <nav aria-label="Document evidence pages" className="mt-3 flex gap-4">
          {documentsPage > 0 && (
            <Link
              href={`/dashboard/imports?documentsPage=${documentsPage - 1}`}
              data-testid="document-page-previous"
            >
              Previous document batches
            </Link>
          )}
          {(documents.data?.length ?? 0) > 10 && (
            <Link
              href={`/dashboard/imports?documentsPage=${documentsPage + 1}`}
              data-testid="document-page-next"
            >
              More document batches
            </Link>
          )}
        </nav>
      </section>
      </details>
      {!available ? (
        <p role="alert">
          Imports are currently unavailable. Your existing records are
          unchanged.
        </p>
      ) : (
        <>
          <details
            className="rounded-xl border bg-white p-4"
            open={!accounts.data?.length}
          >
            <summary className="cursor-pointer font-semibold">
              Add an account label
            </summary>
            <p className="mt-2 text-sm">
              A label identifies the source of an uploaded statement. This does
              not connect to your bank. Use only the last four account/card
              characters.
            </p>
            <form
              action={createFinancialAccount}
              data-testid="source-account-form"
              className="mt-3 grid gap-3 sm:grid-cols-3"
            >
              <label htmlFor="account-label">
                Label
                <input
                  id="account-label"
                  name="label"
                  required
                  maxLength={80}
                  data-testid="source-account-label"
                  className={control}
                />
              </label>
              <label htmlFor="account-provider">
                Provider
                <select
                  id="account-provider"
                  name="provider"
                  data-testid="source-account-provider"
                  className={control}
                >
                  <option value="starling">Starling</option>
                  <option value="nationwide">Nationwide</option>
                  <option value="amex">Amex</option>
                  <option value="generic">Other CSV</option>
                </select>
              </label>
              <label htmlFor="account-mask">
                Last four characters
                <input
                  id="account-mask"
                  name="mask"
                  required
                  maxLength={4}
                  pattern="[A-Za-z0-9]{1,4}"
                  data-testid="source-account-mask"
                  className={control}
                />
              </label>
              <button
                type="submit"
                data-testid="source-account-save"
                className="rounded bg-[#15803d] px-4 py-2 font-semibold text-white"
              >
                Save account label
              </button>
            </form>
          </details>
          <ImportWizard accounts={(accounts.data ?? []).filter(a=>a.currency==='GBP') as AccountOption[]} />
          {chosen?.data&&!totalsAllowed&&<p role="alert" data-testid="source-import-totals-withheld">Complete native GBP totals for this import are unavailable. Foreign or invalid source amounts cannot be included as pounds. <Link className="underline" data-testid="source-foreign-reversal-review" href={`/dashboard/imports/reversal?import=${chosen.data.id}`}>Review original amounts and GBP effects before reversing this import</Link></p>}
          {chosen?.data && totals && !summary?.error && (
            <section
              className="space-y-3 rounded-xl border bg-white p-4"
              data-testid="source-import-totals"
            >
              <h2 className="text-lg font-semibold">Selected import totals</h2>
              <p>
                {totals.transactions} transactions ·{" "}
                {chosen.data.status === "discarded" ? "Reversed" : "In review"}
              </p>
              <p>
                Approved income: {formatPounds(Number(totals.income_pence))} (
                {signedAmountToWords(Number(totals.income_pence))}).
              </p>
              <p>
                Approved expenses: {formatPounds(Number(totals.expense_pence))}{" "}
                ({signedAmountToWords(Number(totals.expense_pence))}).
              </p>
              {Number(totals.refund_count) > 0 && (
                <p data-testid="source-reversal-refund-warning">
                  This reversal removes {totals.refund_count} related refund
                  links across their complete original-payment groups: cash{" "}
                  {formatPounds(Number(totals.refund_pence))}, income reductions{" "}
                  {formatPounds(Number(totals.refund_income_reduction_pence))},
                  expense reductions{" "}
                  {formatPounds(Number(totals.refund_expense_reduction_pence))}.
                  All related refund observations, including other imports,
                  become Unknown. Original payments outside this import keep
                  their classification. Review refunds before continuing.
                </p>
              )}
              {Number(totals.transfer_count) > 0 && (
                <p data-testid="source-import-transfers">
                  This import supports {totals.transfer_count}{" "}
                  transfer/card-repayment pairs totalling{" "}
                  {formatPounds(Number(totals.transfer_pence))} (
                  {amountToWords(Number(totals.transfer_pence))}). Reversing it
                  will break these pairs and return both sides to Unknown,
                  including counterpart transactions in other imports. No
                  previous income or expense amounts will be restored.
                </p>
              )}
              {Number(totals.allocation_count) > 0 && (
                <p data-testid="source-import-allocations">
                  This import supports {totals.allocation_count} invoice matches
                  totalling {formatPounds(Number(totals.allocation_pence))} (
                  {amountToWords(Number(totals.allocation_pence))}). Reversing
                  it will also reverse those matches and recalculate invoice
                  outstanding using preserved credits. Linked refund assignments
                  must be reversed first.
                </p>
              )}
              {chosen.data.status === "discarded" ? (
                <form
                  action={reopenSourceImport}
                  data-testid="source-reopen-form"
                >
                  <input type="hidden" name="importId" value={chosen.data.id} />
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      required
                      name="humanConfirmed"
                      value="yes"
                      data-testid="source-reopen-confirm"
                    />
                    Reopen for review. Previous financial amounts will stay
                    excluded until reviewed again.
                  </label>
                  <button
                    type="submit"
                    data-testid="source-reopen-submit"
                    className="mt-2 rounded border px-4 py-2"
                  >
                    Reopen for review
                  </button>
                </form>
              ) : Number(totals.retained_duplicate_count) > 0 ? (
                <p
                  role="alert"
                  data-testid="source-import-duplicate-dependencies"
                >
                  This retained source supports{" "}
                  {totals.retained_duplicate_count} active duplicate verdicts.
                  <Link
                    className="underline"
                    href="/dashboard/reconciliation/duplicates"
                  >
                    {" "}
                    Review and reverse those identity references first
                  </Link>
                  .
                </p>
              ) : Number(totals.refund_assignment_count) > 0 ? (
                <p
                  role="alert"
                  data-testid="source-import-assignment-dependencies"
                >
                  This import or its complete refund group supports{" "}
                  {totals.refund_assignment_count} active invoice refund
                  assignments totalling{" "}
                  {formatPounds(Number(totals.refund_assignment_pence))} (
                  {amountToWords(Number(totals.refund_assignment_pence))}).{" "}
                  <Link
                    className="underline"
                    href="/dashboard/reconciliation/refund-assignments"
                  >
                    Review and reverse those assignments first
                  </Link>
                  . No source reversal is available until their balance effects
                  have been reviewed.
                </p>
              ) : (
                <Link
                  data-testid="source-reverse-review"
                  className="block rounded border border-red-300 p-3 underline"
                  href={`/dashboard/imports/reversal?import=${chosen.data.id}`}
                >
                  Review every connected source and balance before reversing this import
                </Link>
              )}
            </section>
          )}
          <section
            className="rounded-xl border bg-white p-4"
            data-testid="source-import-list"
          >
            <h2 className="text-lg font-semibold">Preserved imports</h2>
            {!importList.length && <p>No preserved imports yet.</p>}
            <ul className="my-3 space-y-3">
              {importList.slice(0, 20).map((item) => (
                <li key={item.id} className="break-words border-b pb-3">
                  <Link
                    href={`/dashboard/imports?import=${item.id}`}
                    data-testid={`source-import-link-${item.id}`}
                    className="font-semibold underline"
                  >
                    {item.original_filename}
                  </Link>
                  <p className="text-sm">
                    {item.coverage_start} to {item.coverage_end} ·{" "}
                    {item.parser_version}
                  </p>
                  <p className="break-all text-xs">SHA-256: {item.file_hash}</p>
                  {item.file_hash && <form method="post" action={`/api/imports/${item.id}/original`} className="mt-2 text-sm" data-testid={`source-original-${item.id}`}>
                    <label className="block"><input type="checkbox" name="humanConfirmed" value="yes" required data-testid={`source-original-confirm-${item.id}`}/> Download this private bank original to my device for my own review.</label>
                    <p className="text-xs">Original CSV bytes download as a text file. Contents stay out of this page. Use the ledger export below for spreadsheet-safe data.</p>
                    <button type="submit" className="underline" data-testid={`source-original-download-${item.id}`}>Download verified bank original</button>
                  </form>}
                  {item.file_hash && <Link href={`/dashboard/imports/deletion?kind=source&id=${item.id}`} data-testid={`source-deletion-preview-${item.id}`} className="mt-2 block text-sm underline">Preview deletion impact</Link>}
                  <a
                    href={`/api/imports/${item.id}/export`}
                    data-testid={`source-export-${item.id}`}
                    className="text-sm underline"
                  >
                    Export draft evidence-linked ledger
                  </a>
                  {" · "}
                  <a
                    href={`/api/imports/${item.id}/export?format=decisions`}
                    data-testid={`source-decisions-export-${item.id}`}
                    className="text-sm underline"
                  >
                    Export decision history
                  </a>
                  <a
                    href={`/api/imports/${item.id}/export?format=identities`}
                    data-testid={`source-identities-export-${item.id}`}
                    className="ml-2 text-sm underline"
                  >
                    Export identity verdicts and source links (JSON)
                  </a>
                  <a
                    href={`/api/imports/${item.id}/export?format=manifest`}
                    data-testid={`source-manifest-export-${item.id}`}
                    className="mt-2 block text-sm font-semibold underline"
                  >
                    Export draft evidence manifest (JSON)
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex gap-4">
              {page > 0 && (
                <Link
                  href={`/dashboard/imports?importsPage=${page - 1}`}
                  data-testid="imports-previous"
                >
                  Newer imports
                </Link>
              )}
              {importList.length > 20 && (
                <Link
                  href={`/dashboard/imports?importsPage=${page + 1}`}
                  data-testid="imports-next"
                >
                  Earlier imports
                </Link>
              )}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Transaction decisions</h2>
            <p className="text-sm">
              Verified source amounts are separate from provisional business
              treatment. Personal and unknown items remain auditable and
              contribute nothing to approved totals.
            </p>
            {transactionResult?.error && (
              <p role="alert">Could not load transactions.</p>
            )}
            {!transactions.length && !transactionResult?.error && (
              <p>No transactions on this page.</p>
            )}
            {transactions.map((tx) => (
              <section key={`${tx.id}-${tx.decision_version}`}>
                <TransactionReview tx={tx} categories={categories} />
                <Link
                  href={`/dashboard/review/memory?year=${getCurrentTaxYearStart(new Date(tx.transaction_date + "T00:00:00Z"))}&transaction=${tx.id}`}
                  data-testid={`remember-merchant-${tx.id}`}
                  className="underline"
                >
                  Remember or override merchant treatment
                </Link>
              </section>
            ))}
            <nav aria-label="Transaction pages" className="flex gap-4">
              {after && (
                <Link href={linkBase} data-testid="transactions-first">
                  First transactions
                </Link>
              )}
              {txs.length > 50 && (
                <Link
                  href={`${linkBase}&after=${transactions.at(-1)!.id}`}
                  data-testid="transactions-next"
                >
                  Next transactions
                </Link>
              )}
            </nav>
          </section>
        </>
      )}
    </main>
  );
}
