"use client";

import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import {
  type MerchantCluster,
  type ClusterableTransaction,
  clusterSourceTransactions,
} from "@/lib/records/merchant-clusters";
import { classifyMerchantCluster } from "./actions";

type CategoryOption = {
  id: string;
  name: string;
  record_type: "income" | "expense";
};

type Props = {
  transactions: ClusterableTransaction[];
  categories: CategoryOption[];
  importId?: string | null;
};

export default function MerchantClusterReview({
  transactions,
  categories,
  importId,
}: Props) {
  const [clusters, setClusters] = useState<MerchantCluster[]>(() =>
    clusterSourceTransactions(transactions, { onlyUnreviewed: true }),
  );

  if (clusters.length === 0) {
    return (
      <div
        className="rounded-xl border border-[#86efac] bg-[#f0fdf4] p-6 text-center"
        data-testid="merchant-clusters-empty"
      >
        <p className="text-base font-semibold text-[#14532d]">
          All caught up! 🎉
        </p>
        <p className="mt-1 text-sm text-[#166534]">
          There are no unreviewed merchant clusters left in this batch.
        </p>
      </div>
    );
  }

  const multiClusters = clusters.filter((c) => c.count > 1);
  const singleClusters = clusters.filter((c) => c.count === 1);
  const totalUnreviewedItems = clusters.reduce((sum, c) => sum + c.count, 0);

  return (
    <section className="space-y-6" data-testid="merchant-cluster-section">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#14532d]">
            Fast Merchant Sort (Clustered)
          </h2>
          <p className="text-sm text-[#4b8068]">
            {totalUnreviewedItems} unreviewed payment{totalUnreviewedItems === 1 ? "" : "s"} grouped into {clusters.length} merchant{clusters.length === 1 ? "" : "s"}. Review grouped payments together to save time.
          </p>
        </div>
      </div>

      {multiClusters.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[#166534]">
            Recurring & Multiple Payments ({multiClusters.length} merchants)
          </h3>
          <div className="grid gap-4">
            {multiClusters.map((cluster) => (
              <ClusterCard
                key={cluster.key}
                cluster={cluster}
                categories={categories}
                importId={importId}
              />
            ))}
          </div>
        </div>
      )}

      {singleClusters.length > 0 && (
        <details className="rounded-xl border border-[#c8d4cb] bg-white p-4">
          <summary className="cursor-pointer font-semibold text-[#14532d]">
            One-off payments ({singleClusters.length} single items)
          </summary>
          <div className="mt-4 grid gap-4">
            {singleClusters.map((cluster) => (
              <ClusterCard
                key={cluster.key}
                cluster={cluster}
                categories={categories}
                importId={importId}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ClusterCard({
  cluster,
  categories,
  importId,
}: {
  cluster: MerchantCluster;
  categories: CategoryOption[];
  importId?: string | null;
}) {
  const [classification, setClassification] = useState<"Business" | "Personal" | "Mixed">(
    cluster.suggestedClassification,
  );
  const [percent, setPercent] = useState("30");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Match default category if available
  const matchingCat = categories.find(
    (c) =>
      c.record_type === cluster.kind &&
      c.name.toLowerCase().includes((cluster.suggestedCategoryName ?? "").toLowerCase()),
  );
  const [selectedCatId, setSelectedCatId] = useState<string>(
    matchingCat?.id ??
      categories.find((c) => c.record_type === cluster.kind)?.id ??
      "",
  );

  const totalWords = amountToWords(cluster.totalPence);
  const totalFormatted = formatPounds(cluster.totalPence);

  const itemsPayload = JSON.stringify(
    cluster.transactions.map((t) => ({
      id: t.id,
      version: t.decision_version,
    })),
  );

  return (
    <div
      className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-xs transition hover:border-[#86efac]"
      data-testid={`merchant-cluster-${cluster.key}`}
    >
      <form
        action={classifyMerchantCluster}
        onSubmit={() => setBusy(true)}
        className="space-y-4"
      >
        <input type="hidden" name="items" value={itemsPayload} />
        <input type="hidden" name="clusterName" value={cluster.name} />
        <input type="hidden" name="importId" value={importId ?? ""} />
        <input type="hidden" name="classification" value={classification} />

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0fdf4] pb-3">
          <div>
            <span className="text-base font-bold text-[#14532d]">
              {cluster.name}
            </span>
            <span className="ml-3 inline-block rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-xs font-semibold text-[#15803d]">
              {cluster.count} {cluster.count === 1 ? "payment" : "payments"}
            </span>
            <p className="mt-0.5 text-xs text-[#4b8068]">
              {cluster.earliestDate} to {cluster.latestDate}
            </p>
          </div>

          <div className="text-right">
            <p className="text-base font-bold text-[#14532d]">
              {cluster.kind === "income" ? "In: " : "Out: "}
              {totalFormatted}
            </p>
            <p className="text-xs text-[#4b8068] italic">
              {totalWords}
            </p>
          </div>
        </div>

        {/* Binary / 3-way choice */}
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              classification === "Business"
                ? "border-[#15803d] bg-[#dcfce7] text-[#14532d]"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={`choice-${cluster.key}`}
              value="Business"
              checked={classification === "Business"}
              onChange={() => {
                setClassification("Business");
                setConfirmed(false);
              }}
              className="sr-only"
            />
            ✓ Business Cost
          </label>

          <label
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              classification === "Personal"
                ? "border-[#15803d] bg-[#dcfce7] text-[#14532d]"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={`choice-${cluster.key}`}
              value="Personal"
              checked={classification === "Personal"}
              onChange={() => {
                setClassification("Personal");
                setConfirmed(false);
              }}
              className="sr-only"
            />
            ✕ Personal / Ignore
          </label>

          <label
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              classification === "Mixed"
                ? "border-[#15803d] bg-[#dcfce7] text-[#14532d]"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={`choice-${cluster.key}`}
              value="Mixed"
              checked={classification === "Mixed"}
              onChange={() => {
                setClassification("Mixed");
                setConfirmed(false);
              }}
              className="sr-only"
            />
            % Split (Mixed Use)
          </label>
        </div>

        {/* Business Category Picker */}
        {classification === "Business" && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#14532d]">
              Category:
            </label>
            <select
              name="categoryId"
              value={selectedCatId}
              onChange={(e) => {
                setSelectedCatId(e.target.value);
                setConfirmed(false);
              }}
              data-testid={`cluster-category-${cluster.key}`}
              className="rounded-md border border-[#c8d4cb] bg-white px-2 py-1 text-sm text-[#14532d]"
            >
              {categories
                .filter((c) => c.record_type === cluster.kind)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Mixed Split percentage */}
        {classification === "Mixed" && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#14532d]">
              Business %:
            </label>
            <input
              type="number"
              name="percent"
              min="1"
              max="99"
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value);
                setConfirmed(false);
              }}
              className="w-16 rounded-md border border-[#c8d4cb] p-1 text-sm text-[#14532d]"
            />
            <span className="text-xs text-[#4b8068]">% business use</span>
          </div>
        )}

        {/* Collapsible preview of individual payments */}
        <details className="text-xs text-[#4b8068]">
          <summary className="cursor-pointer font-medium text-[#166534] underline">
            See {cluster.count} individual payment{cluster.count === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 divide-y divide-[#f0fdf4] rounded border border-[#e2e8f0] bg-[#fafafa] p-2">
            {cluster.transactions.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between py-1 text-xs"
              >
                <span>
                  {tx.transaction_date} · {tx.description}
                </span>
                <span className="font-semibold">
                  {formatPounds(Math.abs(Number(tx.signed_amount_pence)))}
                </span>
              </li>
            ))}
          </ul>
        </details>

        {/* Explicit confirmation gate */}
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2 text-xs font-medium text-[#14532d]">
            <input
              type="checkbox"
              name="humanConfirmed"
              value="yes"
              checked={confirmed}
              required
              data-testid={`cluster-confirm-${cluster.key}`}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded text-[#15803d]"
            />
            I confirm these {cluster.count} {cluster.count === 1 ? "payment is" : "payments are"}{" "}
            {classification === "Personal" ? "Personal (excluded)" : classification}.
          </label>

          <button
            type="submit"
            disabled={busy || !confirmed}
            data-testid={`cluster-submit-${cluster.key}`}
            className="rounded-lg bg-[#15803d] px-4 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#166534] disabled:opacity-40"
          >
            {busy
              ? "Saving…"
              : `Approve ${cluster.count} ${cluster.count === 1 ? "Payment" : "Payments"}`}
          </button>
        </div>
      </form>
    </div>
  );
}
