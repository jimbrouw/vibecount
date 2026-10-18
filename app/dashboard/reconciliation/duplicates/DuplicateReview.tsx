"use client";
import { useState } from "react";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import {
  duplicateReview,
  type DuplicateChoice,
} from "@/lib/records/duplicates";
import { approveDuplicate, reverseDuplicate } from "./actions";
type Props = {
  subject: DuplicateChoice;
  peers: DuplicateChoice[];
  stamp: string;
  requestId: string;
};
export default function DuplicateReview(props: Props) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({ subject, peers, stamp, requestId }: Props) {
  const reversing = !!subject.active_duplicate_decision_id;
  const [verdict, setVerdict] = useState(""),
    [retained, setRetained] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
  let effects,
    problem = "";
  try {
    if (reversing || verdict)
      effects = duplicateReview(
        subject,
        peers.find((p) => p.id === retained) ?? null,
        reversing ? "reverse" : (verdict as "duplicate" | "distinct"),
      );
  } catch (e) {
    problem = e instanceof Error ? e.message : "Reload the identity evidence.";
  }
  return (
    <form
      action={reversing ? reverseDuplicate : approveDuplicate}
      data-testid="duplicate-review"
      className="space-y-4 rounded border p-4"
    >
      <h2 className="text-xl font-semibold">
        {reversing ? "Reverse identity verdict" : "Review overlapping evidence"}
      </h2>
      <input type="hidden" name="transaction" value={subject.id} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      {reversing ? (
        <input
          type="hidden"
          name="decision"
          value={subject.active_duplicate_decision_id!}
        />
      ) : (
        <>
          <label className="block">
            Identity verdict
            <select
              data-testid="duplicate-verdict"
              name="verdict"
              value={verdict}
              required
              className="ml-2 rounded border p-2"
              onChange={(e) => {
                setVerdict(e.target.value);
                setRetained("");
                setConfirmed(false);
              }}
            >
              <option value="">Choose after checking sources</option>
              <option value="duplicate">
                Duplicate of a retained observation
              </option>
              <option value="distinct">Separate real payment</option>
            </select>
          </label>
          {verdict === "duplicate" ? (
            <label className="block">
              Retain this observation
              <select
                data-testid="duplicate-retained"
                name="retained"
                value={retained}
                required
                className="ml-2 max-w-full rounded border p-2"
                onChange={(e) => {
                  setRetained(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Choose retained source</option>
                {peers
                  .filter(
                    (p) =>
                      p.dedupe_status === "clear" &&
                      p.import_status !== "discarded",
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.transaction_date} · row {p.row_number} · source{" "}
                      {p.file_hash.slice(0, 12)} · {p.classification}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="retained" value="" />
          )}
        </>
      )}
      {problem && <p role="alert">{problem}</p>}
      {effects && (
        <div data-testid="duplicate-readback">
          <p>
            Remove recognised income: {money(effects.removedIncome)}. Remove
            recognised expenses: {money(effects.removedExpense)}.
          </p>
          {reversing ? (
            <p>
              The observation becomes Unresolved / Unknown. Earlier
              classifications and financial relationships are not restored. Both
              source rows and all history remain retained.
            </p>
          ) : verdict === "duplicate" ? (
            <p>
              This observation will be marked Duplicate and excluded. The chosen
              retained observation keeps its current classification and posting.
            </p>
          ) : (
            <p>
              This is a separate real payment. Its current recognised effect
              remains {money(effects.preservedEffect)}. Unknown transactions
              still need classification before inclusion.
            </p>
          )}
        </div>
      )}
      <p>
        Matching date, amount and text are only a review hint. Check the source
        evidence: two identical purchases can both be real. This decision does
        not verify tax eligibility.
      </p>
      <label className="block">
        Evidence and reason
        <input
          data-testid="duplicate-reason"
          name="reason"
          required
          maxLength={1000}
          className="block w-full rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          data-testid="duplicate-confirm"
          type="checkbox"
          name="humanConfirmed"
          value="yes"
          required
          checked={confirmed}
          disabled={!effects}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I checked every observation shown and the exact financial effects.
      </label>
      <button
        data-testid="duplicate-submit"
        disabled={!confirmed || !effects}
        className="rounded border p-2"
      >
        {reversing
          ? "Reverse verdict and leave unresolved"
          : "Confirm identity verdict"}
      </button>
    </form>
  );
}
