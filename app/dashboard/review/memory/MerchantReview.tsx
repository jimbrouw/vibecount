"use client";
import { useState } from "react";
import { isNativeBankObservation, nativeBankPence } from '@/lib/records/bank-source-coverage';
import {
  amountToWords,
  formatPounds,
  signedAmountToWords,
} from "@/lib/invoices/money";
import { percentToBasisPoints } from "@/lib/records/merchant-memory";
import {
  merchantBatchEffects,
  merchantUndoEffects,
  merchantEntryEffect,
  type MerchantChoice,
  type MerchantCategory,
  type MerchantEntry,
} from "@/lib/records/merchant-memory";
import {
  saveMerchantRule,
  approveMerchantBatch,
  undoMerchantBatch,
  saveMerchantRollover,
} from "./actions";

export type MerchantRule = {
  id: string;
  rule_id: string;
  ordinal: number;
  match_key: string;
  record_type: string;
  status: string;
  account_id: string | null;
  tax_year_start: number | null;
  effective_from: string;
  expires_on: string | null;
  priority: number;
  classification: string;
  business_use_bps: number;
  category_id: string | null;
  evidence_status: string;
  seed_transaction_id: string;
  category_valid: boolean;
};
type Shared = {
  stamp: string;
  requestId: string;
  categories: MerchantCategory[];
  reviewYear?: number;
};
const money = (n: number) => `${formatPounds(n)} (${signedAmountToWords(n)})`;
const inputClass = "block w-full rounded border p-2";
function Hidden({
  stamp,
  requestId,
  reviewYear,
}: Pick<Shared, "stamp" | "requestId" | "reviewYear">) {
  return (
    <>
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="reviewYear" value={reviewYear ?? ""} />
      <input type="hidden" name="requestId" value={requestId} />
    </>
  );
}
function Gate({
  confirmed,
  setConfirmed,
  label,
  disabled = false,
}: {
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <>
      <label className="block">
        <input
          type="checkbox"
          name="humanConfirmed"
          value="yes"
          required
          checked={confirmed}
          disabled={disabled}
          data-testid="merchant-confirm"
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        {label}
      </label>
      <button
        className="rounded border p-2"
        data-testid="merchant-submit"
        disabled={!confirmed || disabled}
      >
        Confirm reviewed action
      </button>
    </>
  );
}
export function MerchantRuleReview(
  props: Shared & {
    seed: MerchantChoice;
    rule?: MerchantRule;
    accounts: { id: string; label: string; masked_identifier: string }[];
    rollover?: { sourceVersionId: string; targetYear: number; conflicts?: { effective_from: string; expires_on: string | null }[] };
  },
) {
  if(!isNativeBankObservation(props.seed))return <p role="alert" data-testid="merchant-native-rule-withheld">Native merchant rules need a complete actual GBP source. Foreign or missing source amounts cannot be treated as pounds.</p>;
  return <RuleForm key={JSON.stringify(props)} {...props} />;
}
function RuleForm({
  seed,
  rule,
  accounts,
  categories,
  stamp,
  requestId,
  reviewYear,
  rollover,
}: Parameters<typeof MerchantRuleReview>[0]) {
  const [confirmed, confirm] = useState(false),
    [classification, classify] = useState(rule?.classification ?? ""),
    [percent, percentage] = useState(
      rule?.classification === "Mixed"
        ? String(rule.business_use_bps / 100)
        : "",
    ),
    [category, categorize] = useState(rule?.category_id ?? ""),
    [account, scopeAccount] = useState(rule ? (rule.account_id ?? "") : seed.account_id),
    [year, scopeYear] = useState(
      rule ? String(rule.tax_year_start ?? "") : String(seed.tax_year_start),
    ),
    [first, from] = useState(
      rule?.effective_from ?? `${seed.tax_year_start}-04-06`,
    ),
    [last, until] = useState(
      rule ? (rule.expires_on ?? "") : `${seed.tax_year_start + 1}-04-05`,
    ),
    [priority, rank] = useState(String(rule?.priority ?? 50)),
    [status, enable] = useState(rule?.status ?? "active"),
    [evidence, evidenceStatus] = useState(
      rule?.evidence_status ?? "provisional",
    );
  const kind = nativeBankPence(seed) > 0 ? "income" : "expense",
    included = ["Business", "Mixed"].includes(classification);
  let bps = 0,
    problem = "";
  try {
    if (!classification) throw new Error("Choose remembered treatment.");
    bps =
      classification === "Business"
        ? 10000
        : classification === "Mixed"
          ? percentToBasisPoints(percent)
          : 0;
    if (
      classification === "Mixed" &&
      (kind !== "expense" || bps <= 0 || bps >= 10000)
    )
      throw new Error(
        "Mixed expenses need more than 0% and less than 100% business use.",
      );
    if (
      included &&
      !categories.some((c) => c.id === category && c.record_type === kind)
    )
      throw new Error("Choose a category of the correct type.");
    if (
      !first ||
      (last && last < first) ||
      !Number.isInteger(Number(priority)) ||
      Number(priority) < 0 ||
      Number(priority) > 100 ||
      (year &&
        (!Number.isInteger(Number(year)) ||
          Number(year) < 2000 ||
          Number(year) > 2100))
    )
      throw new Error("Review dates, tax year and priority.");
    if (
      year &&
      (first > `${Number(year) + 1}-04-05` || (last && last < `${year}-04-06`))
    )
      throw new Error(
        "The effective dates must overlap the selected tax year.",
      );
    if (rollover && (Number(year) !== rollover.targetYear || first < `${rollover.targetYear}-04-06` || !last || last > `${rollover.targetYear + 1}-04-05`))
      throw new Error("Keep the rollover dates inside its explicit target tax year.");
    if (rollover?.conflicts?.some(r => r.effective_from <= last && (r.expires_on === null || r.expires_on >= first)))
      throw new Error("An existing active rule overlaps these dates. Narrow the proposed window or review the existing rule.");
  } catch (e) {
    problem = e instanceof Error ? e.message : "Review this rule.";
  }
  const definition = {
    seed_id: seed.id,
    status,
    account_id: account || null,
    tax_year_start: year ? Number(year) : null,
    effective_from: first,
    expires_on: last || null,
    priority: Number(priority),
    classification,
    business_use_bps: bps,
    category_id: included ? category : null,
    evidence_status: evidence,
  };
  return (
    <form
      action={rollover ? saveMerchantRollover : saveMerchantRule}
      data-testid="merchant-rule-form"
      className="space-y-3 rounded border p-4"
      onChange={() => confirm(false)}
    >
      <Hidden
        stamp={stamp}
        requestId={requestId}
        reviewYear={reviewYear ?? seed.tax_year_start}
      />
      <input
        type="hidden"
        name="definition"
        value={JSON.stringify(definition)}
      />
      <input type="hidden" name="ruleId" value={rule?.rule_id ?? ""} />
      <input type="hidden" name="version" value={rule?.ordinal ?? 0} />
      {rollover && <><input type="hidden" name="sourceVersionId" value={rollover.sourceVersionId}/><input type="hidden" name="targetYear" value={rollover.targetYear}/></>}
      <h2 className="text-xl font-semibold">
        {rollover ? "Review annual rollover proposal" : rule ? `Revise rule ${rule.ordinal}` : "Remember merchant treatment"}
      </h2>
      {rollover && <p data-testid="merchant-rollover-readback">Create a separate rule family for {rollover.targetYear}/{String(rollover.targetYear + 1).slice(-2)} from source version {rollover.sourceVersionId}. The prior-year family and decisions remain unchanged. Disabled is the default; choosing Active only enables a suggestion, never transaction approval.</p>}
      <p>
        Exact normalized description: <strong>{seed.merchant_key}</strong> ·{" "}
        {kind}. Normalization collapses spaces and ignores case. Redacted
        descriptions can group unrelated payees; inspect every suggestion.
      </p>
      <label className="block">
        Remembered treatment
        <select
          className={inputClass}
          data-testid="merchant-rule-treatment"
          value={classification}
          onChange={(e) => classify(e.target.value)}
        >
          <option value="">Choose treatment</option>
          {[
            "Business",
            "Personal",
            "Mixed",
            "Transfer",
            "Refund",
            "Unknown",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {classification === "Mixed" && (
        <label className="block">
          Business-use percentage
          <input
            className={inputClass}
            data-testid="merchant-rule-percent"
            value={percent}
            inputMode="decimal"
            onChange={(e) => percentage(e.target.value)}
          />
        </label>
      )}
      {included && (
        <label className="block">
          Category
          <select
            className={inputClass}
            data-testid="merchant-rule-category"
            value={category}
            onChange={(e) => categorize(e.target.value)}
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
      <label className="block">
        Account scope
        <select
          className={inputClass}
          data-testid="merchant-rule-account"
          disabled={!!rollover}
          value={account}
          onChange={(e) => scopeAccount(e.target.value)}
        >
          <option value="">All my accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} ending {a.masked_identifier}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Tax-year start (blank means all years)
        <input
          className={inputClass}
          data-testid="merchant-rule-year"
          readOnly={!!rollover}
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => scopeYear(e.target.value)}
        />
      </label>
      <label className="block">
        Effective from transaction date
        <input
          className={inputClass}
          type="date"
          required
          data-testid="merchant-rule-effective"
          value={first}
          onChange={(e) => from(e.target.value)}
        />
      </label>
      <label className="block">
        Expires after transaction date (blank means no expiry)
        <input
          className={inputClass}
          type="date"
          data-testid="merchant-rule-expiry"
          value={last}
          onChange={(e) => until(e.target.value)}
        />
      </label>
      <label className="block">
        Priority (0–100; higher wins)
        <input
          className={inputClass}
          type="number"
          min="0"
          max="100"
          required
          data-testid="merchant-rule-priority"
          value={priority}
          onChange={(e) => rank(e.target.value)}
        />
      </label>
      <label className="block">
        Rule status
        <select
          className={inputClass}
          data-testid="merchant-rule-status"
          value={status}
          onChange={(e) => enable(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>
      <label className="block">
        Evidence state
        <select
          className={inputClass}
          data-testid="merchant-rule-evidence"
          value={evidence}
          onChange={(e) => evidenceStatus(e.target.value)}
        >
          <option value="provisional">Provisional</option>
          <option value="missing">Missing</option>
        </select>
      </label>
      <p data-testid="merchant-rule-readback">
        Save a {status} suggestion for {kind},{" "}
        {classification || "treatment unresolved"}
        {classification === "Mixed" ? ` at ${percent}%` : ""},{" "}
        {account
          ? accounts.find((a) => a.id === account)?.label
          : "all my accounts"}
        , {year ? `tax year starting ${year}` : "all tax years"}, {first}{" "}
        through {last || "no expiry"}, priority {priority}, category{" "}
        {included ? categories.find((c) => c.id === category)?.name : "none"},
        evidence {evidence}. This creates {formatPounds(0)} ({amountToWords(0)})
        of income or expenses. Known decisions remain unchanged.
      </p>
      <p>
        Higher priority wins, then the number of account/year restrictions.
        Equal top ranks require manual review. Transfer and Refund hints still
        require their dedicated relationship review.
      </p>
      {problem && <p role="status">{problem}</p>}
      <label className="block">
        Reason and business-use rationale
        <input
          name="reason"
          className={inputClass}
          required
          maxLength={1000}
          data-testid="merchant-rule-reason"
        />
      </label>
      <div onChange={(e) => e.stopPropagation()}>
        <Gate
          confirmed={confirmed}
          setConfirmed={confirm}
          disabled={!!problem}
          label={rollover ? "I rechecked the new-year eligibility, business use, dates, status and evidence; save this separate suggestion without carrying transaction approvals." : "I reviewed the merchant, scope and provisional treatment; save this suggestion."}
        />
      </div>
    </form>
  );
}

export function MerchantBatchReview(
  props: Shared & {
    rows: MerchantChoice[];
    documents: { id: string; file_hash: string; media_type: string }[];
  },
) {
  if(!props.rows.every(isNativeBankObservation))return <p role="alert" data-testid="merchant-native-batch-withheld">This batch contains unsupported source currency or missing amounts. Native GBP approval is unavailable.</p>;
  return <BatchForm key={JSON.stringify(props)} {...props} />;
}
function BatchForm({
  rows,
  categories,
  documents,
  stamp,
  requestId,
  reviewYear,
}: Parameters<typeof MerchantBatchReview>[0]) {
  const [confirmed, confirm] = useState(false),
    [entries, setEntries] = useState<MerchantEntry[]>([]);
  function select(row: MerchantChoice, checked: boolean) {
    confirm(false);
    setEntries((all) =>
      checked
        ? [
            ...all,
            {
              transaction_id: row.id,
              version: row.decision_version,
              origin:
                row.classification !== "Unknown"
                  ? "override"
                  : row.top_rule_count === 1
                    ? "rule"
                    : "manual",
              rule_version_id:
                row.top_rule_count === 1 ? row.suggested_rule_version_id : null,
              evidence_status: "provisional",
              document_ids: [],
            },
          ]
        : all.filter((e) => e.transaction_id !== row.id),
    );
  }
  function patch(id: string, change: Partial<MerchantEntry>) {
    confirm(false);
    setEntries((all) =>
      all.map((e) => (e.transaction_id === id ? { ...e, ...change } : e)),
    );
  }
  let summary,
    problem = "";
  try {
    summary = merchantBatchEffects(rows, entries, categories);
  } catch (e) {
    problem = e instanceof Error ? e.message : "Review exact selected effects.";
  }
  return (
    <form
      action={approveMerchantBatch}
      data-testid="merchant-batch-form"
      className="space-y-4"
      onChange={() => confirm(false)}
    >
      <Hidden
        stamp={stamp}
        requestId={requestId}
        reviewYear={reviewYear ?? rows[0]?.tax_year_start}
      />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />
      <h2 className="text-xl font-semibold">
        Review selected transaction decisions
      </h2>
      <p>
        Only selected rows are approved. Memory suggests treatment; tax
        eligibility still needs review. Unselected and known decisions stay as
        they are.
      </p>
      {rows.map((row) => {
        const entry = entries.find((e) => e.transaction_id === row.id),
          blocked =
            row.dedupe_status !== "clear" ||
            row.has_financial_dependencies ||
            row.import_status === "discarded";
        const kind = nativeBankPence(row) > 0 ? "income" : "expense";
        let readback = "";
        if (entry)
          try {
            const e = merchantEntryEffect(row, entry, categories);
            readback = `${e.classification}, ${e.bps / 100}% business use: ${kind} changes from ${money(e.before)} to ${money(e.after)}.`;
          } catch (e) {
            readback = e instanceof Error ? e.message : "Review treatment.";
          }
        return (
          <fieldset
            key={row.id}
            className="space-y-3 rounded border p-4"
            data-testid={`merchant-row-${row.id}`}
          >
            <legend className="font-semibold">
              {row.transaction_date} · {row.description}
            </legend>
            <p>
              Observed amount: {money(nativeBankPence(row))} ·{" "}
              {row.account_label} ending {row.account_mask} · Current:{" "}
              {row.classification}.
            </p>
            <p className="break-all">
              File SHA-256 {row.file_hash} · Row {row.row_number} SHA-256{" "}
              {row.row_hash}
            </p>
            <a
              className="underline"
              data-testid={`merchant-source-${row.id}`}
              href={`/dashboard/imports?import=${row.import_id}`}
            >
              Review source
            </a>
            {" · "}
            <a
              className="underline"
              href={`/dashboard/review/memory?year=${row.tax_year_start}&transaction=${row.id}`}
            >
              Remember or override this merchant
            </a>
            {row.rule_candidates.map((r) => (
              <p key={r.id}>
                Rule {r.ordinal}: {r.classification}, {r.business_use_bps / 100}
                % · {r.category_snapshot?.name ?? "no category"} · priority{" "}
                {r.priority}, rank {r.precedence_rank} · {r.evidence_status}
                {!r.category_valid ? " · category changed; revise rule" : ""}
              </p>
            ))}
            {row.top_rule_count > 1 && (
              <p role="status">
                Competing rules: choose manual treatment or revise the rules.
              </p>
            )}
            {blocked ? (
              <p>
                Resolve{" "}
                <a
                  href="/dashboard/reconciliation/duplicates"
                  className="underline"
                >
                  source identity
                </a>{" "}
                or{" "}
                <a href="/dashboard/reconciliation" className="underline">
                  financial relationships
                </a>{" "}
                first.
              </p>
            ) : (
              <label className="block">
                <input
                  type="checkbox"
                  data-testid={`merchant-select-${row.id}`}
                  checked={!!entry}
                  onChange={(e) => select(row, e.target.checked)}
                />{" "}
                {row.classification === "Unknown"
                  ? "Select this row for review"
                  : "Explicitly override this known decision"}
              </label>
            )}
            {entry && (
              <>
                {row.classification === "Unknown" && (
                  <label className="block">
                    Decision source
                    <select
                      className={inputClass}
                      value={entry.origin}
                      data-testid={`merchant-origin-${row.id}`}
                      onChange={(e) =>
                        patch(row.id, {
                          origin: e.target.value as "rule" | "manual",
                        })
                      }
                    >
                      <option value="manual">Manual review</option>
                      {row.top_rule_count === 1 && (
                        <option value="rule">Use remembered suggestion</option>
                      )}
                    </select>
                  </label>
                )}
                {entry.origin !== "rule" && (
                  <>
                    <label className="block">
                      Reviewed treatment
                      <select
                        className={inputClass}
                        data-testid={`merchant-treatment-${row.id}`}
                        value={entry.classification ?? ""}
                        onChange={(e) =>
                          patch(row.id, {
                            classification: e.target.value,
                            business_use_bps:
                              e.target.value === "Business"
                                ? 10000
                                : e.target.value === "Personal"
                                  ? 0
                                  : undefined,
                            category_id: null,
                          })
                        }
                      >
                        <option value="">Choose treatment</option>
                        {["Business", "Personal", "Mixed"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    {entry.classification === "Mixed" && (
                      <label className="block">
                        Business-use percentage
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          data-testid={`merchant-percent-${row.id}`}
                          onChange={(e) => {
                            let bps;
                            try {
                              bps = percentToBasisPoints(e.target.value);
                            } catch {
                              bps = undefined;
                            }
                            patch(row.id, { business_use_bps: bps });
                          }}
                        />
                      </label>
                    )}
                    {["Business", "Mixed"].includes(
                      entry.classification ?? "",
                    ) && (
                      <label className="block">
                        Reviewed category
                        <select
                          className={inputClass}
                          data-testid={`merchant-category-${row.id}`}
                          value={entry.category_id ?? ""}
                          onChange={(e) =>
                            patch(row.id, { category_id: e.target.value })
                          }
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
                  </>
                )}
                <label className="block">
                  Evidence status
                  <select
                    className={inputClass}
                    data-testid={`merchant-evidence-${row.id}`}
                    value={entry.evidence_status}
                    onChange={(e) =>
                      patch(row.id, {
                        evidence_status: e.target
                          .value as MerchantEntry["evidence_status"],
                      })
                    }
                  >
                    <option value="provisional">Provisional</option>
                    <option value="missing">Missing</option>
                    <option value="linked">
                      Linked documents (facts still need review)
                    </option>
                  </select>
                </label>
                <label className="block">
                  Evidence documents on this page (select up to 10)
                  <select
                    multiple
                    className={inputClass}
                    data-testid={`merchant-documents-${row.id}`}
                    value={entry.document_ids}
                    onChange={(e) =>
                      patch(row.id, {
                        document_ids: Array.from(
                          e.target.selectedOptions,
                          (o) => o.value,
                        ),
                      })
                    }
                  >
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.media_type} · {d.file_hash}
                      </option>
                    ))}
                  </select>
                </label>
                <p data-testid={`merchant-readback-${row.id}`}>{readback}</p>
              </>
            )}
          </fieldset>
        );
      })}
      <div data-testid="merchant-batch-readback">
        {summary ? (
          <p>
            {summary.count} selected rows. Income: {money(summary.incomeBefore)}{" "}
            → {money(summary.incomeAfter)}. Expenses:{" "}
            {money(summary.expenseBefore)} → {money(summary.expenseAfter)}.
            These are candidate recognised amounts, not a final tax deduction.
          </p>
        ) : (
          <p role="status">{problem}</p>
        )}
      </div>
      <label className="block">
        Reason and rationale for all selected decisions
        <input
          className={inputClass}
          name="reason"
          required
          maxLength={1000}
          data-testid="merchant-batch-reason"
        />
      </label>
      <div onChange={(e) => e.stopPropagation()}>
        <Gate
          confirmed={confirmed}
          setConfirmed={confirm}
          disabled={!summary}
          label="I reviewed every selected source, percentage, category and exact before/after amount."
        />
      </div>
    </form>
  );
}
export function MerchantBatchUndo(props: {
  batchId: string;
  reviewYear?: number;
  rows: MerchantChoice[];
  versions: { transaction_id: string; after_version: number }[];
  stamp: string;
  requestId: string;
}) {
  if(!props.rows.every(isNativeBankObservation))return <p role="alert" data-testid="merchant-native-undo-withheld">Current native undo amounts are unavailable. Review the retained source currency and history.</p>;
  return <UndoForm key={JSON.stringify(props)} {...props} />;
}
function UndoForm({
  batchId,
  rows,
  versions,
  stamp,
  requestId,
  reviewYear,
}: Parameters<typeof MerchantBatchUndo>[0]) {
  const [confirmed, confirm] = useState(false);
  let summary,
    problem = "";
  try {
    summary = merchantUndoEffects(rows, versions);
  } catch (e) {
    problem = e instanceof Error ? e.message : "Current effects unavailable.";
  }
  return (
    <form
      action={undoMerchantBatch}
      data-testid="merchant-undo-form"
      className="space-y-3 rounded border p-4"
      onChange={() => confirm(false)}
    >
      <Hidden
        stamp={stamp}
        requestId={requestId}
        reviewYear={reviewYear ?? rows[0]?.tax_year_start}
      />
      <input type="hidden" name="batchId" value={batchId} />
      <h3 className="font-semibold">Undo this entire batch</h3>
      {summary ? (
        <p data-testid="merchant-undo-readback">
          Remove income {money(summary.incomeBefore)} and expenses{" "}
          {money(summary.expenseBefore)} across {summary.count} rows. All become
          Unknown with {money(0)} recognised. Previous approvals are not
          restored; evidence and history are retained.
        </p>
      ) : (
        <p role="status">{problem}</p>
      )}
      <label className="block">
        Reason for undo
        <input
          className={inputClass}
          name="reason"
          required
          maxLength={1000}
          data-testid="merchant-undo-reason"
        />
      </label>
      <div onChange={(e) => e.stopPropagation()}>
        <Gate
          confirmed={confirmed}
          setConfirmed={confirm}
          disabled={!summary}
          label="I reviewed every current effect and confirm leaving all batch rows Unknown."
        />
      </div>
    </form>
  );
}
