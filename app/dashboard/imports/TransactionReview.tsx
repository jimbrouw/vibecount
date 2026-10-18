"use client";
import { useState } from "react";
import { apportionPence } from "@/lib/money";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import { classifySourceTransaction } from "./actions";
import { bankOriginalMinor, nativeBankPence } from '@/lib/records/bank-source-coverage';
import { fxAmountReadback } from '@/lib/fx/readback';
import { currencyCode } from '@/lib/fx/currency';

export type LedgerTransaction = {
  id: string;
  import_id: string;
  transaction_date: string;
  signed_amount_pence: number | string | null;
  currency?: string;
  original_signed_minor?: number | string | null;
  source_units_ruleset?: string | null;
  description: string;
  reference: string;
  classification: string;
  decision_version: number;
  business_use_bps: number;
  category_id: string | null;
  dedupe_status: string;
  source_row_id: string;
  active_transfer_id?: string | null;
  active_refund_id?: string | null;
  has_refunds?: boolean;
};
export type LedgerCategory = { id: string; name: string; record_type: string };
export default function TransactionReview(props: {
  tx: LedgerTransaction;
  categories: LedgerCategory[];
}) {
  try { nativeBankPence(props.tx); } catch {
    let original='Original amount unavailable.';
    try { original=fxAmountReadback(bankOriginalMinor(props.tx.original_signed_minor),currencyCode(props.tx.currency)); }catch{}
    return <details id={`transaction-${props.tx.id}`} data-testid={`source-transaction-${props.tx.id}`} className="rounded border p-4"><summary>{props.tx.transaction_date} · Unsupported source currency or amount</summary><p>{original}</p><p data-testid="source-native-review-withheld">Native GBP classification is unavailable. Preserve the original source and complete valuation/source review first. No GBP amount is inferred.</p>{original!=='Original amount unavailable.'&&props.tx.currency!=='GBP'&&<><a className="underline" data-testid={`source-valuation-review-${props.tx.id}`} href={`/dashboard/imports/valuation?transaction=${encodeURIComponent(props.tx.id)}`}>Review original evidence and GBP valuation</a><a className="ml-4 underline" data-testid={`source-classification-review-${props.tx.id}`} href={`/dashboard/imports/classification?transaction=${encodeURIComponent(props.tx.id)}`}>Review classification and accounting amount</a></>}</details>;
  }
  return (
    <TransactionForm
      key={JSON.stringify([props.tx, props.categories])}
      {...props}
    />
  );
}
function TransactionForm({
  tx,
  categories,
}: {
  tx: LedgerTransaction;
  categories: LedgerCategory[];
}) {
  const [classification, setClassification] = useState(tx.classification);
  const [percent, setPercent] = useState(
    tx.classification === "Mixed" ? String(tx.business_use_bps / 100) : "30",
  );
  const [confirmed, setConfirmed] = useState(false);
  const signed = nativeBankPence(tx), amount = Math.abs(signed);
  const included = classification === "Business" || classification === "Mixed";
  const validPercent = /^\d{1,2}(\.\d{1,2})?$/.test(percent);
  const [whole, fraction = ""] = percent.split(".");
  const bps =
    classification === "Business"
      ? 10000
      : classification === "Mixed" && validPercent
        ? Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
        : 0;
  const share = apportionPence(amount, bps);
  const kind = signed > 0 ? "income" : "expense";
  const blocked =
    included &&
    (tx.dedupe_status !== "clear" ||
      (classification === "Mixed" &&
        (kind === "income" || bps <= 0 || bps >= 10000)));
  return (
    <details
      id={`transaction-${tx.id}`}
      className="rounded-xl border bg-white p-4"
      data-testid={`source-transaction-${tx.id}`}
    >
      <summary className="cursor-pointer font-semibold">
        {tx.transaction_date} · {tx.description} ·{" "}
        {kind === "income" ? "In" : "Out"} {formatPounds(amount)} ·{" "}
        {tx.classification === "Unknown" ? "Unresolved" : tx.classification}
      </summary>
      <p className="my-2 text-sm">
        Original amount: {formatPounds(amount)} ({amountToWords(amount)}).
        Reference: {tx.reference || "None"}.
      </p>
      {tx.dedupe_status !== "clear" && (
        <p role="status" className="text-amber-900">
          {tx.dedupe_status === "duplicate"
            ? "Reviewed duplicate — excluded from recognised totals."
            : "Possible overlapping statement transaction — unresolved. It cannot be included until identity review."}{" "}
          <a
            className="underline"
            data-testid={`source-duplicate-review-${tx.id}`}
            href={`/dashboard/reconciliation/duplicates?transaction=${tx.id}`}
          >
            Review the source identity and history
          </a>
        </p>
      )}
      {tx.has_refunds || tx.active_refund_id ? (
        <p role="status" data-testid={`source-refund-${tx.id}`}>
          This transaction has reviewed refund relationships.{" "}
          <a className="underline" href="/dashboard/reconciliation/refunds">
            Review the refund group and its signed accounting effects
          </a>{" "}
          before changing classification.
        </p>
      ) : tx.active_transfer_id ? (
        <p role="status" data-testid={`source-paired-transfer-${tx.id}`}>
          This transaction belongs to a reviewed transfer/card-repayment pair
          with zero recognised income/expense.{" "}
          <a
            href="/dashboard/reconciliation/transfers"
            data-testid={`source-transfer-review-${tx.id}`}
            className="underline"
          >
            Review or reverse the pair before changing its classification.
          </a>
        </p>
      ) : (
        <form
          action={classifySourceTransaction}
          className="mt-3 space-y-3"
          data-testid={`source-review-form-${tx.id}`}
        >
          <input type="hidden" name="transactionId" value={tx.id} />
          <input type="hidden" name="importId" value={tx.import_id} />
          <input type="hidden" name="version" value={tx.decision_version} />
          <label className="block" htmlFor={`classification-${tx.id}`}>
            Classification
            <select
              id={`classification-${tx.id}`}
              name="classification"
              value={classification}
              className="ml-2 rounded border p-2"
              data-testid={`source-classification-${tx.id}`}
              onChange={(e) => {
                setClassification(e.target.value);
                setConfirmed(false);
              }}
            >
              {[
                "Unknown",
                "Business",
                "Personal",
                "Mixed",
                "Transfer",
                "Refund",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {classification === "Mixed" && (
            <label className="block" htmlFor={`percent-${tx.id}`}>
              Business use percentage
              <input
                id={`percent-${tx.id}`}
                name="percent"
                value={percent}
                inputMode="decimal"
                required
                className="ml-2 w-24 rounded border p-2"
                data-testid={`source-percent-${tx.id}`}
                onChange={(e) => {
                  setPercent(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
          )}
          {included && (
            <label className="block" htmlFor={`category-${tx.id}`}>
              Record category
              <select
                name="categoryId"
                id={`category-${tx.id}`}
                defaultValue={tx.category_id ?? ""}
                required
                className="ml-2 rounded border p-2"
                data-testid={`source-category-${tx.id}`}
                onChange={() => setConfirmed(false)}
              >
                <option value="">Choose category</option>
                {categories
                  .filter((c) => c.record_type === kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="block" htmlFor={`reason-${tx.id}`}>
            Reason / evidence note
            <input
              id={`reason-${tx.id}`}
              name="rationale"
              required
              maxLength={1000}
              className="mt-1 block w-full rounded border p-2"
              data-testid={`source-rationale-${tx.id}`}
              onChange={() => setConfirmed(false)}
            />
          </label>
          <p data-testid={`source-share-${tx.id}`}>
            {included
              ? "Business record amount"
              : "Included in approved totals"}
            : {formatPounds(share)} ({amountToWords(share)}).
          </p>
          <p className="text-sm">
            {classification === "Refund"
              ? "Refund treatment remains unresolved until linked to the original payment."
              : "Business classification is provisional tax treatment. Vehicle methods, equipment and other eligibility adjustments still need tax review."}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="humanConfirmed"
              value="yes"
              checked={confirmed}
              required
              disabled={blocked}
              data-testid={`source-confirm-${tx.id}`}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed this amount and confirm this classification.
          </label>
          <button
            type="submit"
            data-testid={`source-save-${tx.id}`}
            disabled={blocked || !confirmed}
            className="rounded-md bg-[#15803d] px-4 py-2 font-semibold text-white disabled:opacity-40"
          >
            Confirm decision
          </button>
        </form>
      )}
    </details>
  );
}
