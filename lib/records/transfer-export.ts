type Relation<T> = T | T[] | null;
const one = <T>(value: Relation<T>) =>
  Array.isArray(value) ? (value[0] ?? null) : value;
type TransferSource = {
  id: string;
  signed_amount_pence?: number | string;
  source_row_id: string;
  source_rows: Relation<{ row_number: number; row_hash: string }>;
  record_imports: Relation<{ file_hash: string }>;
  financial_accounts: Relation<{ label: string; masked_identifier: string }>;
};
export type TransferExportPair = {
  id: string;
  kind: string;
  amount_pence: number | string;
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
  outgoing: Relation<TransferSource>;
  incoming: Relation<TransferSource>;
};
export type TransferExportReversal = {
  id: string;
  pair_id: string;
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
};
export const transferExportHeaders = [
  "transfer_pair_id",
  "counterpart_transaction_id",
  "counterpart_source_row_id",
  "counterpart_source_row_number",
  "counterpart_source_row_sha256",
  "counterpart_file_sha256",
  "relationship_kind",
  "outgoing_account_label",
  "incoming_account_label",
];
export function transferExportRows(
  pairs: TransferExportPair[],
  reversals: TransferExportReversal[],
): string[][] {
  function row(
    pair: TransferExportPair,
    event: TransferExportPair | TransferExportReversal,
    reversal: boolean,
  ) {
    const outgoing = one(pair.outgoing),
      incoming = one(pair.incoming),
      outSource = outgoing && one(outgoing.source_rows),
      inSource = incoming && one(incoming.source_rows),
      outFile = outgoing && one(outgoing.record_imports),
      inFile = incoming && one(incoming.record_imports),
      outAccount = outgoing && one(outgoing.financial_accounts),
      inAccount = incoming && one(incoming.financial_accounts);
    if (
      !outgoing ||
      !incoming ||
      !outSource ||
      !inSource ||
      !outFile ||
      !inFile ||
      !outAccount ||
      !inAccount
    )
      throw new Error("Missing paired transfer provenance.");
    return [
      "Draft — not submitted to HMRC",
      "transfer_event",
      "",
      "",
      outgoing.id,
      event.id,
      reversal ? "reversal" : "paired",
      reversal ? pair.id : "",
      String(pair.amount_pence),
      "",
      "",
      outgoing.source_row_id,
      String(outSource.row_number),
      outSource.row_hash,
      outFile.file_hash,
      event.created_at,
      reversal
        ? "Unknown — awaiting review"
        : "Transfer — zero income/expense effect",
      event.author,
      event.rationale,
      event.request_id,
      pair.id,
      incoming.id,
      incoming.source_row_id,
      String(inSource.row_number),
      inSource.row_hash,
      inFile.file_hash,
      pair.kind,
      `${outAccount.label} ending ${outAccount.masked_identifier}`,
      `${inAccount.label} ending ${inAccount.masked_identifier}`,
    ];
  }
  return [
    ...pairs.map((pair) => row(pair, pair, false)),
    ...reversals.map((event) => {
      const pair = pairs.find((p) => p.id === event.pair_id);
      if (!pair) throw new Error("Missing reversed transfer provenance.");
      return row(pair, event, true);
    }),
  ];
}
