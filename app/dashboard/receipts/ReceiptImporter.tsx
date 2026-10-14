"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAmountToPence } from "@/lib/invoices/money";
import { formatReceiptMoney, receiptAmountWords, type ReceiptDraft, type ReceiptCategory, type ConfirmReceipt } from "@/lib/records/receipts";

type Receipt = { id: string; original_filename: string; content_type: string; receipt_state: string;
  extraction: ReceiptDraft | null; reviewed: ConfirmReceipt | null; receipt_error: string | null; record_id: string | null; extraction_method: string | null };
type Expense = { id: string; description: string; record_date: string; amount: number | string; source_type: string; status: string; payment_status: string; expense_kind: string };
type ReviewData = { receipts: Receipt[]; categories: ReceiptCategory[]; expenses: Expense[]; awaitingReview: number };
const inputStyle = "mt-1 min-h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-base text-[#14532d]";
const buttonStyle = "min-h-11 rounded-lg border border-[#bbf7d0] bg-white px-4 py-2 text-sm font-semibold text-[#14532d] hover:bg-[#f0fdf4]";
const stateLabel = (state: string) => ({ reading: "Reading", review: "Needs review", saved: "Saved", failed: "Failed", excluded: "Excluded" }[state] ?? state);

export default function ReceiptImporter() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [failedUploads, setFailedUploads] = useState<{ file: File; error: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/receipts", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load receipts. Retry."); }
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/receipts", { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (active) setData(result);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load receipts. Retry."); });
    return () => { active = false; };
  }, []);

  async function upload(files: File[]) {
    if (busy) return;
    setBusy(true); setNotice("");
    setReading(files.map(f => f.name));
    for (const file of files) {
      setFailedUploads(previous => previous.filter(f => f.file !== file));
      try {
        const form = new FormData(); form.set("file", file);
        const response = await fetch("/api/receipts", { method: "POST", body: form });
        const result = await response.json();
        if (result.id && !result.error?.startsWith("This looks")) setSelected(result.id);
        if (!response.ok) {
          if (!result.id || result.error?.startsWith("This looks")) setFailedUploads(previous => [...previous, { file, error: result.error }]);
          else setNotice(result.error);
        } else if (result.duplicate) setNotice("Already uploaded — opened the existing receipt. No second expense was created.");
      } catch { setFailedUploads(previous => [...previous, { file, error: "Upload failed. Retry this file." }]); }
      setReading(previous => previous.slice(1)); await load();
    }
    setBusy(false); router.refresh();
    if (fileInput.current) fileInput.current.value = "";
  }

  async function retry(receipt: Receipt) {
    if (busy) return;
    setBusy(true); setReading([receipt.original_filename]);
    try {
      const response = await fetch(`/api/receipts/${receipt.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry" }) });
      const result = await response.json();
      setNotice(response.ok ? "Details are ready for review." : result.error); setSelected(receipt.id);
    } catch { setNotice("Reading failed. You can enter the details yourself."); }
    setReading([]); setBusy(false); await load(); router.refresh();
  }

  const receipt = data?.receipts.find(r => r.id === selected);
  return (
    <section className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm ph-no-capture" data-ph-no-capture data-testid="receipt-import-panel" aria-labelledby="receipt-import-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 id="receipt-import-heading" className="text-lg font-semibold text-[#14532d]">Expenses</h2>
          <p className="mt-1 text-sm text-[#4b8068]">AI drafts. You check the document and confirm each expense.</p></div>
        <Link href="/dashboard/records?tab=records" className={buttonStyle} data-testid="receipt-manual-entry">Manual entry</Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Import mode">
        <span className="rounded-lg bg-[#15803d] px-4 py-3 text-sm font-semibold text-white">Receipt or supplier invoice</span>
        <Link href="/dashboard/records?tab=bank" className={buttonStyle} data-testid="receipt-bank-mode">Bank statement</Link>
      </div>
      <div className="mt-4 rounded-xl border-2 border-dashed border-[#86a88e] bg-[#f7fef9] p-6 text-center"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); }} data-testid="receipt-drop-zone">
        <p className="font-semibold text-[#14532d]">Drop receipts or PDFs here</p>
        <p className="mt-1 text-sm text-[#4b8068]">PDF (up to 10 pages), JPEG or PNG · under 3 MB each · scans and photographs supported.</p>
        <p className="mt-2 text-xs text-[#4b8068]">Receipts are stored privately. Their text or image is sent to Anthropic to draft details. Use Bank statement mode for statements.</p>
        <input ref={fileInput} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label="Open receipt files" data-testid="receipt-file-input"
          onChange={e => void upload(Array.from(e.target.files ?? []))} disabled={busy} />
        <button type="button" onClick={() => fileInput.current?.click()} className={`${buttonStyle} mt-4`} disabled={busy} data-testid="receipt-open-files">Open files</button>
      </div>
      <div role="status" aria-live="polite" className="mt-3 space-y-2 text-sm text-[#166534]">
        {reading.map((name, i) => <p key={`${name}-${i}`}>{name} — Reading</p>)}
        {notice && <p>{notice}</p>}
        {data && <p data-testid="receipt-awaiting-count">{data.awaitingReview} awaiting review · only approved, paid GBP business expenses count in totals.</p>}
      </div>
      {error && <div role="alert" className="mt-3 text-sm text-red-800">{error} <button className={buttonStyle} onClick={() => void load()}>Retry loading</button></div>}
      {failedUploads.map((f, i) => <div key={i} role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{f.file.name} — Failed: {f.error} <button className={buttonStyle} disabled={busy} onClick={() => void upload([f.file])}>Retry upload</button></div>)}
      {data && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><h3 className="font-semibold text-[#14532d]">Documents needing review and recent receipts</h3>
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">{data.receipts.map(r => <li key={r.id}>
            <button className={`${buttonStyle} w-full text-left ${selected === r.id ? "bg-[#dcfce7]" : ""}`} onClick={() => { setSelected(r.id); setNotice(""); }} data-testid={`receipt-select-${r.id}`}>
              <span className="block break-words">{r.original_filename}</span><span className="block text-xs font-normal">{stateLabel(r.receipt_state)}{r.record_id ? " · linked to Records" : ""}</span>
            </button></li>)}{!data.receipts.length && <li className="text-sm text-[#4b8068]">No receipt imports yet.</li>}</ul>
        </div>
        <div><h3 className="font-semibold text-[#14532d]">Recent expenses</h3><ul className="mt-2 space-y-2 text-sm text-[#4b8068]">
          {data.expenses.slice(0, 5).map(e => <li key={e.id}>{e.description} · {formatReceiptMoney(Math.round(Number(e.amount) * 100), "GBP")} · {e.status}{e.payment_status === "unpaid" ? " · unpaid; excluded from paid totals" : ""}{e.expense_kind === "refund" ? " · refund" : ""}</li>)}
          {!data.expenses.length && <li>No recorded expenses yet.</li>}</ul></div>
      </div>}
      {receipt && data && <div className="mt-5">
        {receipt.receipt_error && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">{receipt.receipt_error}</p>}
        {(receipt.receipt_state === "failed" || receipt.receipt_state === "reading") && <button className={`${buttonStyle} mb-3`} disabled={busy} onClick={() => void retry(receipt)} data-testid="receipt-retry-reading">Retry reading</button>}
        <ReceiptReview key={`${receipt.id}-${JSON.stringify(receipt.reviewed)}-${JSON.stringify(receipt.extraction)}`} receipt={receipt} categories={data.categories} expenses={data.expenses}
          reading={busy} onSaved={async (message) => { await load(); router.refresh(); setNotice(message ?? "Saved. The approved expense is linked to Records. Unpaid bills remain outside paid totals."); }} />
      </div>}
    </section>
  );
}

function ReceiptReview({ receipt, categories, expenses, reading, onSaved }: { receipt: Receipt; categories: ReceiptCategory[]; expenses: Expense[]; reading: boolean; onSaved: (message?: string) => Promise<void> }) {
  const draft = receipt.extraction;
  const reviewed = receipt.reviewed;
  const [amount, setAmount] = useState(reviewed ? (reviewed.grossPence / 100).toFixed(2) : draft?.ambiguous ? "" : draft?.totalPence != null ? (draft.totalPence / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(reviewed?.currency ?? draft?.currency ?? "");
  const [paymentStatus, setPaymentStatus] = useState(reviewed?.paymentStatus ?? draft?.paymentStatus ?? "unknown");
  const [paymentDate, setPaymentDate] = useState(reviewed?.paymentDate ?? draft?.paymentDate ?? "");
  const [kind, setKind] = useState(reviewed?.kind ?? draft?.kind ?? "expense");
  const [allocation, setAllocation] = useState(reviewed?.businessUsePercent ?? 100);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const total = parseAmountToPence(amount);
  const possibleMatches = expenses.filter(e => e.status === "approved" && e.expense_kind === "expense" && e.source_type !== "receipt_document" && e.id !== receipt.record_id &&
    paymentStatus === "paid" && total !== null && (Math.round(Number(e.amount) * 100) === Math.round(total * allocation / 100) || Math.round(Number(e.amount) * 100) === total) && paymentDate && Math.abs(Date.parse(e.record_date) - Date.parse(paymentDate)) <= 3 * 86400000);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || reading) return;
    const form = new FormData(event.currentTarget);
    const body = { merchant: form.get("merchant"), documentDate: form.get("documentDate"), currency, amount, vat: form.get("vat"),
      categoryId: form.get("categoryId"), paymentStatus, paymentDate, businessUsePercent: allocation, kind,
      refundOf: kind === "refund" ? form.get("refundOf") : null, matchRecordId: form.get("matchRecordId") === "new" ? null : form.get("matchRecordId"), amountConfirmed: confirmed };
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/receipts/${receipt.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not confirm. Retry."); }
    finally { setPending(false); }
  }
  async function exclude() {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/receipts/${receipt.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "exclude" }) });
      if (!response.ok) throw new Error((await response.json()).error);
      await onSaved("Excluded from review and business totals. You can reopen the receipt to correct it later.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not exclude."); }
    setPending(false);
  }
  const source = `/api/receipts/${receipt.id}/source`;
  return <div className="grid items-start gap-5 lg:grid-cols-2" data-testid="receipt-review">
    <div className="min-w-0"><h3 className="mb-2 font-semibold text-[#14532d]">Source document</h3>
      <ReceiptSource receipt={receipt} source={source} />
      <a className="mt-2 inline-block text-sm text-[#166534] underline" href={source} target="_blank" rel="noreferrer">Open source document in a new tab</a>
      <p className="mt-1 text-xs text-[#4b8068]">{receipt.extraction_method === "pdf_text" ? "Read embedded PDF text" : receipt.extraction_method === "document_vision" ? "Read with document vision" : "Manual correction available"}. Always check against the source.</p>
    </div>
    <form onSubmit={submit} className="space-y-4 text-sm text-[#14532d]" data-testid="receipt-review-form">
      <h3 className="font-semibold">{receipt.record_id ? "Saved expense — correct details" : "Check the extracted details"}</h3>
      {draft?.ambiguous && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">The final total is ambiguous. Choose the correct total or type a correction before confirming.</p>}
      {draft?.amounts.length ? <ul className="space-y-1 rounded-lg bg-[#f0fdf4] p-3">{draft.amounts.map((a, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2"><span>{a.label} ({a.role}): {formatReceiptMoney(a.pence, currency)}</span>
        {a.role === "total" && <button type="button" className="min-h-11 underline" data-testid={`receipt-choose-total-${i}`} onClick={() => { setAmount((a.pence / 100).toFixed(2)); setConfirmed(false); }}>Choose this final total</button>}</li>)}</ul> : null}
      {draft?.notes.map((n, i) => <p key={i} className="text-amber-900">Review: {n}</p>)}
      <label className="block">Merchant<input name="merchant" required maxLength={200} className={inputStyle} defaultValue={reviewed?.merchant ?? draft?.merchant ?? ""} data-testid="receipt-merchant" /></label>
      <label className="block">Document date<input name="documentDate" type="date" required className={inputStyle} defaultValue={reviewed?.documentDate ?? draft?.documentDate ?? ""} data-testid="receipt-document-date" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label>Currency (ISO code)<input value={currency} onChange={e => { setCurrency(e.target.value.toUpperCase()); setConfirmed(false); }} required maxLength={3} className={inputStyle} data-testid="receipt-currency" /></label>
        <label>Final gross total<input value={amount} onChange={e => { setAmount(e.target.value); setConfirmed(false); }} required inputMode="decimal" className={inputStyle} data-testid="receipt-amount" /></label>
      </div>
      {currency !== "GBP" && <p className="text-amber-900">Only GBP can be confirmed in this version. Keep foreign currency in review; do not convert it by relabelling it.</p>}
      <div className="rounded-lg border border-[#86a88e] bg-[#f7fef9] p-4" data-testid="receipt-amount-readback">
        <p className="text-xl font-semibold">{total !== null ? formatReceiptMoney(total, currency) : "Choose or correct the final total"}</p>
        <p className="mt-1">{total !== null ? receiptAmountWords(total, currency) : "Amount needed"}</p>
        <label className="mt-3 flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="receipt-amount-confirmed" />I checked this final total in figures and words against the document.</label>
      </div>
      <label className="block">VAT explicitly shown (leave blank if unknown)<input name="vat" inputMode="decimal" className={inputStyle} defaultValue={reviewed ? reviewed.vatPence != null ? (reviewed.vatPence / 100).toFixed(2) : "" : draft?.vatPence != null ? (draft.vatPence / 100).toFixed(2) : ""} data-testid="receipt-vat" /></label>
      <label className="block">Expense category {draft?.categoryId && "(suggestion — check it)"}<select name="categoryId" required defaultValue={reviewed?.categoryId ?? draft?.categoryId ?? ""} className={inputStyle} data-testid="receipt-category"><option value="">Choose a category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="block">Business use (%)<input type="number" min={1} max={100} step={1} value={allocation} onChange={e => setAllocation(Number(e.target.value))} required className={inputStyle} data-testid="receipt-business-use" /></label>
      {total !== null && currency === "GBP" && allocation >= 1 && allocation <= 100 && <p className="rounded-lg bg-[#f0fdf4] p-3" data-testid="receipt-business-share">Business share to record: {formatReceiptMoney(Math.round(total * allocation / 100), "GBP")} — {receiptAmountWords(Math.round(total * allocation / 100), "GBP")}</p>}
      <p className="text-xs text-[#4b8068]">Personal spending: exclude this receipt. Mixed use: record only the business share. VAT and equipment treatment still need tax review.</p>
      <label className="block">Payment status<select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value as typeof paymentStatus)} className={inputStyle} data-testid="receipt-payment-status"><option value="unknown">Choose — payment not established</option><option value="paid">Paid</option><option value="unpaid">Unpaid supplier invoice</option></select></label>
      {paymentStatus === "paid" ? <label className="block">Actual payment date<input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required className={inputStyle} data-testid="receipt-payment-date" /></label> : <p className="text-amber-900">A supplier invoice does not prove payment. Unpaid bills are recorded but excluded from paid expense and tax-prep totals.</p>}
      <label className="block">Document kind<select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className={inputStyle} data-testid="receipt-kind"><option value="expense">Expense</option><option value="refund">Refund received</option></select></label>
      {kind === "refund" && <label className="block">Original expense<select name="refundOf" defaultValue={reviewed?.refundOf ?? ""} className={inputStyle} required data-testid="receipt-refund-of"><option value="">Choose original expense</option>{expenses.filter(e => e.status === "approved" && e.expense_kind === "expense" && e.id !== receipt.record_id).map(e => <option value={e.id} key={e.id}>{e.description} · {formatReceiptMoney(Math.round(Number(e.amount) * 100), "GBP")}</option>)}</select></label>}
      {!receipt.record_id && kind === "expense" && possibleMatches.length > 0 && <label className="block rounded-lg bg-amber-50 p-3">Possible existing expenses — check before creating another<select name="matchRecordId" required defaultValue="" className={inputStyle} data-testid="receipt-match-record"><option value="">Choose — attach evidence or record a different cost</option><option value="new">Create a new expense — these are different costs</option>{possibleMatches.map(e => <option key={e.id} value={e.id}>Attach evidence: {e.description} · {e.record_date} · {formatReceiptMoney(Math.round(Number(e.amount) * 100), "GBP")}</option>)}</select><span className="mt-2 block text-xs">A match attaches the receipt to that expense, with no second cost. Your business-use share updates that recorded cost. These are amount/date suggestions, not confirmed matches.</span></label>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={pending || reading || !confirmed || currency !== "GBP" || paymentStatus === "unknown"} className="min-h-12 rounded-lg bg-[#15803d] px-5 py-3 font-semibold text-white disabled:opacity-50" data-testid="receipt-confirm-expense">{pending ? "Saving…" : receipt.record_id ? "Confirm correction" : "Confirm expense"}</button>
        {!receipt.record_id && <button type="button" onClick={() => void exclude()} className={buttonStyle} disabled={pending} data-testid="receipt-exclude">Exclude personal / unwanted</button>}</div>
    </form>
  </div>;
}

function ReceiptSource({ receipt, source }: { receipt: Receipt; source: string }) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isPdf = receipt.content_type === "application/pdf";
  useEffect(() => {
    if (!isPdf) return;
    let active = true;
    fetch(`${source}?info=1`, { cache: "no-store" }).then(r => r.json()).then(info => {
      if (active && Number.isInteger(info.pageCount) && info.pageCount >= 1 && info.pageCount <= 10) setPageCount(info.pageCount);
    }).catch(() => { /* Original PDF link remains available. */ });
    return () => { active = false; };
  }, [source, isPdf]);
  return <div>
    {!failed && !loaded && <p role="status" className="mb-2 text-sm text-[#4b8068]">Reading source page…</p>}
    {failed ? <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Preview unavailable. Open the source document below to check it.</p> :
      // Authenticated images also make PDF pages readable in browsers without an embedded PDF viewer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={isPdf ? `${source}?preview=1&page=${page}` : source} alt={`Source receipt: ${receipt.original_filename}, page ${page}`} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className="max-h-[40rem] w-full rounded-lg border border-[#bbf7d0] object-contain" data-testid="receipt-source-preview" />}
    {isPdf && <div className="mt-2 flex items-center justify-between gap-2 text-sm text-[#14532d]">
      <button type="button" className={buttonStyle} disabled={page <= 1} onClick={() => { setPage(page - 1); setFailed(false); setLoaded(false); }} data-testid="receipt-source-previous">Previous page</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" className={buttonStyle} disabled={page >= pageCount} onClick={() => { setPage(page + 1); setFailed(false); setLoaded(false); }} data-testid="receipt-source-next">Next page</button>
    </div>}
  </div>;
}
