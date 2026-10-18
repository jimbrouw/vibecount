"use client";
import { useState } from "react";
import { useFormStatus } from 'react-dom';
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { fxAggregateReadback } from '@/lib/fx/readback';
import {
  recoveryReview,
  type RecoveryChoice,
} from "@/lib/records/recovery-review";
import { recoverUpload } from "./actions";
function RecoverySubmit({ id, confirmed }: { id: string; confirmed: boolean }) {
  const { pending } = useFormStatus();
  return <button data-testid={`recovery-submit-${id}`} disabled={!confirmed || pending} className="rounded border p-2">
    {pending ? 'Verifying preserved originals…' : 'Verify originals and retry preservation'}
  </button>;
}
export default function RecoveryReview(props: {
  choice: RecoveryChoice;
  requestId: string;
}) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({
  choice,
  requestId,
}: {
  choice: RecoveryChoice;
  requestId: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  let summary;
  try {
    summary = recoveryReview(choice);
  } catch (e) {
    return (
      <p role="status">
        {e instanceof Error ? e.message : "Recovery scope is unavailable."}
      </p>
    );
  }
  const money = (n: number) => `${formatPounds(n)} (${amountToWords(n)})`;
  return (
    <form
      action={recoverUpload}
      data-testid={`recovery-review-${choice.id}`}
      className="space-y-3 rounded border p-4"
    >
      <input type="hidden" name="attempt" value={choice.id} />
      <input type="hidden" name="kind" value={choice.kind} />
      <input type="hidden" name="stamp" value={choice.stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      <h3 className="font-semibold">Review recovery of this failed upload</h3>
      <p className="break-all">Original SHA-256: {choice.file_hash}</p>
      <div data-testid={`recovery-readback-${choice.id}`}>
        {choice.kind === "source" ? (
          <>
            <p>
              {summary.count} observations for {choice.account_label} ending{" "}
              {choice.account_mask}, from {choice.coverage_start} to{" "}
              {choice.coverage_end}, using the previously confirmed mapping.
            </p>
            <p>
              Observed money in: {summary.currency === 'GBP' ? money(summary.incoming) : fxAggregateReadback(summary.incoming, summary.currency)}. Observed money out:{" "}
              {summary.currency === 'GBP' ? money(summary.outgoing) : fxAggregateReadback(summary.outgoing, summary.currency)}.
            </p>
            {summary.currency !== 'GBP' && <p>These are original {summary.currency} amounts. GBP valuation and financial classification require separate review.</p>}
            <p>
              Recovery approves {money(0)} of new income or expenses. New
              observations remain unclassified; if the original is already
              registered, its existing treatment is retained.
            </p>
          </>
        ) : (
          <p>
            Preserve {summary.count} document objects for {choice.purpose}, tax
            year starting {choice.tax_year_start}, under the original scope.
            Document facts remain unverified. Recovery approves {money(0)} of
            new income or expenses.
          </p>
        )}
      </div>
      <p>
        The server checks the recorded key, original bytes, hashes and complete
        membership. Missing ZIP members may be restored from the verified
        original archive. Existing evidence is retained. No financial approval,
        submission or payment occurs.
      </p>
      <label className="block">
        Reason for retrying
        <input
          name="reason"
          required
          maxLength={1000}
          data-testid={`recovery-reason-${choice.id}`}
          className="block w-full rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          name="humanConfirmed"
          value="yes"
          required
          checked={confirmed}
          data-testid={`recovery-confirm-${choice.id}`}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I checked this original and its preserved scope and confirm retrying
        preservation.
      </label>
      <RecoverySubmit id={choice.id} confirmed={confirmed} />
    </form>
  );
}
